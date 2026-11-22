"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("Chromium: owner grants supervisor, nurse requests, supervisor decides without owner controls",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 const {Pool}=require("pg"),{chromium}=require("playwright"),bcrypt=require("bcryptjs");
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false}),port=18896,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"siash-clinical-browser-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",x=>logs+=x);child.stderr.on("data",x=>logs+=x);let browser;
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  const prefix="clinui_"+Date.now(),owner=prefix+"_o",nurse=prefix+"_n",supervisor=prefix+"_s",password="ClinicalBrowser!2026";
  const hash=await bcrypt.hash(password,4);
  for(const [username,role] of [[owner,"owner"],[nurse,"operational"]])await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,$3)",[username,hash,role]);
  async function api(method,path,token,body){const r=await fetch(url+path,{method,headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}}
  async function login(username){const r=await api("POST","/api/login",null,{username,password});assert.equal(r.status,200);return r.data.token}
  const ownerToken=await login(owner),nurseToken=await login(nurse);
  browser=await chromium.launch({headless:true});
  async function open(username,role,token){
   const page=await browser.newPage();await page.goto(url,{waitUntil:"domcontentloaded"});
   await page.evaluate(({username,role,token})=>{
    document.querySelector("#app-view")?.classList.remove("hidden");SESSION={authenticated:true,user:username,role};SIASH_CLOUD.token=token;applyPermissions();
   },{username,role,token});return page;
  }
  const ownerPage=await open(owner,"owner",ownerToken);
  await ownerPage.locator("#admin-new-user").fill(supervisor);
  await ownerPage.locator("#admin-new-pass").fill(password);
  await ownerPage.locator("#admin-new-pass-confirm").fill(password);
  await ownerPage.locator("#admin-new-role").selectOption("clinical_supervisor");
  await ownerPage.locator("#admin-user-form button[type=submit]").click();
  await ownerPage.waitForFunction(()=>document.querySelector("#admin-user-feedback")?.textContent?.includes("sucesso"),null,{timeout:10000});
  const supervisorToken=await login(supervisor);
  const state=await db.query("SELECT revision FROM siash_state WHERE id=1"),revision=Number(state.rows[0].revision);
  const referenceDate=new Date(Date.now()-245*86400000).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
  async function censusPage(username,role,token){
   const page=await open(username,role,token);
   await page.evaluate(({referenceDate,revision})=>{SIASH_CLOUD.revision=revision;document.querySelector("#view-lancamento")?.classList.remove("hidden");lateCensusSetStatus({attention:"overdue",referenceDate});},{referenceDate,revision});return page;
  }
  const nursePage=await censusPage(nurse,"operational",nurseToken);
  await nursePage.locator("#census-late-open").click();
  await nursePage.locator("#census-late-date").fill(referenceDate);
  await nursePage.locator("#census-late-count").fill("4");
  await nursePage.locator("#census-late-justification").fill("Registro assistencial retrospectivo do plantão");
  await nursePage.locator("#census-late-evidence").fill("Mapa de leitos e evolução assistencial");
  await nursePage.locator("#census-late-submit").click();
  await nursePage.waitForFunction(()=>document.querySelector("#census-late-form-status")?.textContent?.includes("Protocolo:"),null,{timeout:10000});
  const supervisorPage=await censusPage(supervisor,"clinical_supervisor",supervisorToken);
  assert.equal(await supervisorPage.locator('[data-view="administracao"]').isVisible(),false);
  assert.equal(await supervisorPage.locator('[data-view="configuracoes"]').isVisible(),false);
  await supervisorPage.evaluate(()=>lateCensusLoadRequests());
  await supervisorPage.locator("#census-late-requests button").filter({hasText:"Analisar solicitação"}).first().click();
  await supervisorPage.locator("#census-late-review-reason").fill("Documentação conferida de maneira independente");
  await supervisorPage.locator("#census-late-approve").click();
  await supervisorPage.waitForFunction(()=>document.querySelector("#census-late-events")?.textContent?.includes("regularizacao_aprovada"),null,{timeout:10000});
  const p=await db.query("SELECT protocol FROM siash_census_late_requests WHERE reference_date=$1",[referenceDate]);
  const events=await db.query("SELECT event_type FROM siash_census_late_events WHERE protocol=$1 ORDER BY id",[p.rows[0].protocol]);
  assert.equal(events.rows.at(-1).event_type,"regularizacao_aprovada");
  assert.equal((await api("GET","/api/users",supervisorToken)).status,403);
 }finally{await browser?.close();child.kill("SIGTERM");await db.end()}
});
