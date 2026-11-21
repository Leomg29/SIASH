'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {Pool}=require('pg');
const {chromium}=require('playwright');
const URL='http://127.0.0.1:18781';
const DB='postgres://siash_ci:siash_ci@127.0.0.1:5432/siash_ci';
const pool=new Pool({connectionString:DB,ssl:false});
const initial={beds:[{n:1,patient:'BASE'},{n:4,patient:'BASE4'}],picc:[],pipa:[]};
test('Chromium real: dois plantoes, 409, resolucao e persistencia apos reload',{timeout:120000},async()=>{
 assert.equal(process.env.SIASH_ISOLATED_CI,'1');
 assert.equal(process.env.DATABASE_URL,DB);
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'18781',DATABASE_URL:DB,PGSSLMODE:'disable',JWT_SECRET:'siash-ci-isolated-browser-secret-32-chars'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 let browser;
 try{
  for(let i=0;i<150;i++){
   if(child.exitCode!==null)throw Error(logs);
   try{if((await fetch(URL+'/api/health')).ok)break}catch{}
   if(i===149)throw Error('Server startup: '+logs);
   await delay(100);
  }
  const bootstrap=await fetch(URL+'/api/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'isolated_browser',password:'isolated-browser-password'})});
  assert.equal(bootstrap.status,200);const token=(await bootstrap.json()).token;
  const init=await fetch(URL+'/api/state/init',{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({payload:{state:initial,security:{}}})});
  assert.equal(init.status,200);
  browser=await chromium.launch({headless:true});
  const a=await browser.newContext(),b=await browser.newContext();
  async function prepare(context,user){
   const page=await context.newPage();
   page.on('dialog',dialog=>dialog.accept());
   await page.goto(URL,{waitUntil:'domcontentloaded'});
   await page.evaluate(({token,user,initial})=>{
    SESSION={authenticated:true,user,role:'owner'};
    SIASH_CLOUD.token=token;SIASH_CLOUD.revision=1;SIASH_CLOUD.conflict=false;
    S=JSON.parse(JSON.stringify(initial));cloudSetBase(initial);
    sessionStorage.setItem('siash_cloud_token',token);
   },{token,user,initial});
   return page;
  }
  const day=await prepare(a,'plantao-diurno'),night=await prepare(b,'plantao-noturno');
  await night.evaluate(()=>{S.beds[0].patient='RN-NOTURNO';scheduleCloudSave()});
  await night.waitForFunction(()=>SIASH_CLOUD.revision===2,null,{timeout:10000});
  await day.evaluate(()=>{S.beds[0].patient='RN-DIURNO';scheduleCloudSave()});
  await day.locator('#cloud-conflict-panel').waitFor({state:'visible',timeout:15000});
  assert.match(await day.locator('#cloud-conflict-local').innerText(),/RN-DIURNO/);
  assert.match(await day.locator('#cloud-conflict-remote').innerText(),/RN-NOTURNO/);
  assert.equal(await day.evaluate(()=>S.beds[0].patient),'RN-DIURNO');
  const confirm=day.locator('#cloud-conflict-confirm');
  assert.equal(await confirm.isDisabled(),true);
  await day.locator('#cloud-conflict-resolutions select').first().selectOption('local');
  assert.equal(await confirm.isEnabled(),true);
  await confirm.click();
  await day.waitForFunction(()=>SIASH_CLOUD.revision===3&&SIASH_CLOUD.conflict===false,null,{timeout:15000});
  const db=await pool.query('SELECT payload,revision FROM siash_state WHERE id=1');
  assert.equal(Number(db.rows[0].revision),3);
  assert.equal(db.rows[0].payload.state.beds[0].patient,'RN-DIURNO');
  await day.reload({waitUntil:'domcontentloaded'});
  await day.evaluate(token=>{SIASH_CLOUD.token=token;SESSION={authenticated:true,user:'plantao-diurno',role:'owner'}},token);
  const reloaded=await day.evaluate(async()=>{await cloudLoadAfterLogin();return S.beds[0].patient});
  assert.equal(reloaded,'RN-DIURNO');
 }finally{
  if(browser)await browser.close();
  child.kill('SIGTERM');
  await pool.end();
 }
});
