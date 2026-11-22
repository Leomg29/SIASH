'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const isolated=process.env.SIASH_ISOLATED_CI==='1';
test('Chromium PR81: login limpo, troca de senha e alerta de admissão no censo',{timeout:90000,skip:!isolated},async()=>{
 const {Pool}=require('pg'),{chromium}=require('playwright'),bcrypt=require('bcryptjs');
 const port=18782,url='http://127.0.0.1:'+port,db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),PGSSLMODE:'disable',JWT_SECRET:'siash-pr81-chromium-test-secret-32-chars'},stdio:'pipe'});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 let browser;
 try{
  for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(output);try{if((await fetch(url+'/api/health')).ok)break}catch{}if(i===149)throw Error(output);await delay(100)}
  await db.query('INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash',['pr81_nurse',await bcrypt.hash('LegacyPass123',12),'operational']);
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#login-pass').inputValue(),'');
  assert.equal(await page.locator('#export-local-backup').isVisible(),false);
  assert.equal(await page.locator('#import-local-backup').isVisible(),false);
  await page.locator('#login-user').fill('pr81_nurse');
  await page.locator('#login-pass').fill('LegacyPass123');
  await page.locator('#login-btn').click();
  await page.locator('#app-view').waitFor({state:'visible',timeout:15000});
  await page.locator('#change-password-open').click();
  await page.locator('#change-current-password').fill('LegacyPass123');
  await page.locator('#change-new-password').fill('NovaSenha1234');
  await page.locator('#change-confirm-password').fill('NovaSenha1234');
  await page.locator('#change-password-form button[type=submit]').click();
  await assert.match(await page.locator('#change-password-feedback').innerText(),/especial/);
  await page.locator('#change-new-password').fill('NovaSenha!1234');
  await page.locator('#change-confirm-password').fill('NovaSenha!1234');
  await page.locator('#change-password-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#change-password-feedback')?.textContent?.includes('Nova senha: mínimo 10 caracteres'),null,{timeout:15000});
  assert.match(await page.locator('#change-password-feedback').innerText(),/Senha alterada com sucesso\./);
  // Simulate a previous-day admission in isolated DB; the actual panel must show a warning.
  const {dateInBrazil,previousDate}=require('../census-midnight.cjs');
  const day=previousDate(dateInBrazil(new Date()));
  const payload={state:{daily:[{date:day,internados:3,admissoes:1}]}};
  await db.query('INSERT INTO siash_state(id,payload,revision) VALUES(1,$1,1) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,revision=1',[payload]);
  await db.query('INSERT INTO siash_daily_admission_records(reference_date,admission_count,ever_admitted,recorded_by) VALUES($1,1,TRUE,$2) ON CONFLICT(reference_date) DO UPDATE SET admission_count=1,ever_admitted=TRUE',[day,'pr81-test']);
  const windowStatus=await page.evaluate(()=>cloudJson('/api/census/window-status'));
  assert.equal(windowStatus.referenceDate,day);
  assert.equal(windowStatus.attention,'overdue');
  await page.evaluate(()=>refreshMidnightCensusStatus());
  await page.waitForFunction(()=>{const b=document.querySelector('#census-pending-attention');return b&&!b.classList.contains('hidden')&&!b.disabled},null,{timeout:10000});
  await page.locator('[data-view="lancamento"]').click();
  assert.equal(await page.locator('#census-midnight-alert').isVisible(),true);
 }finally{if(browser)await browser.close();child.kill('SIGTERM');await db.end()}
});
