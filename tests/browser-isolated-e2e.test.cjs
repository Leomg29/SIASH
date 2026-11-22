'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const isolated=process.env.SIASH_ISOLATED_CI==='1';
const Pool=isolated?require('pg').Pool:null;
const chromium=isolated?require('playwright').chromium:null;
const URL='http://127.0.0.1:18781';
const DB='postgres://siash_ci:siash_ci@127.0.0.1:5432/siash_ci';
const pool=isolated?new Pool({connectionString:DB,ssl:false}):null;
const initial={beds:Array.from({length:10},(_,i)=>({n:i+1,patient:i===3?'BASE4':'BASE'})),picc:[],pipa:[]};
test('Chromium real: dois plantoes, 409, resolucao e persistencia apos reload',{timeout:120000,skip:!isolated},async()=>{
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
  const bootstrap=await fetch(URL+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'siash_ci_owner',password:'isolated-only-password'})});
  assert.equal(bootstrap.status,200);const token=(await bootstrap.json()).token;
  await pool.query('UPDATE siash_state SET payload=$1,revision=1 WHERE id=1',[{state:initial,security:{}}]);
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
  // Conferência: evidência real de DOM/Chromium sem gravar dados clínicos.
  const censusUI=await day.evaluate(async()=>{
   const alert=document.getElementById('census-midnight-alert');
   const button=document.getElementById('census-close');
   const date=document.getElementById('d-date');
   if(!alert||!button||!date)throw Error('Controles do censo ausentes');
   const originalCloudJson=cloudJson;
   const originalDate=date.value;
   const initialDisabled=button.disabled;
   try{
    censusConferencePending={date:'2026-11-21',generation:1};
    censusConferenceFeedback('Salvando conferência… aguardando confirmação do servidor.');
    const saving=button.disabled&&alert.textContent.includes('Salvando conferência');
    censusConferencePending=null;
    censusConferenceFeedback('Conferência salva e sincronizada.');
    const saved=!button.disabled&&alert.textContent.includes('sincronizada');
    date.value='2026-11-22';
    cloudJson=async()=>({attention:'overdue',phase:'expired',referenceDate:'2026-11-21',clinicalStatus:'pending'});
    await refreshMidnightCensusStatus();
    const pending=alert.textContent.includes('21/11/2026')&&alert.textContent.includes('22/11/2026')&&alert.textContent.includes('pendente');
    cloudJson=async()=>({attention:'closed',phase:'expired',referenceDate:'2026-11-21',clinicalStatus:'manual'});
    await refreshMidnightCensusStatus();
    const manual=alert.textContent.includes('Conferência manual')&&!alert.textContent.includes('pendente');
    return {saving,saved,pending,manual};
   }finally{cloudJson=originalCloudJson;date.value=originalDate;censusConferencePending=null;button.disabled=initialDisabled;}
  });
  assert.deepEqual(censusUI,{saving:true,saved:true,pending:true,manual:true});
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
