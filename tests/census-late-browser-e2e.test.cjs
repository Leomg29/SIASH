"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {setTimeout:delay}=require("node:timers/promises");
const isolated=process.env.SIASH_ISOLATED_CI==="1";
test("Chromium: enfermeiro solicita, preserva formulário em 409, supervisor independente decide e auditoria aparece",{skip:!isolated,timeout:120000},async()=>{
 const {Pool}=require("pg"),{chromium}=require("playwright"),bcrypt=require("bcryptjs");
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 const port=18794,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"siash-late-census-browser-secret-32"},stdio:["ignore","pipe","pipe"]});
 let output="";child.stdout.on("data",d=>output+=d);child.stderr.on("data",d=>output+=d);
 let browser;
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(output);if(i===149)throw Error(output);await delay(100)}
  const prefix="lateui_"+Date.now(),nurse=prefix+"_n",supervisor=prefix+"_s",password="LateBrowser!2026";
  for(const [user,role] of [[nurse,"operational"],[supervisor,"owner"]])await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,$3)",[user,await bcrypt.hash(password,4),role]);
  async function token(user){const r=await fetch(url+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:user,password})});assert.equal(r.status,200);return (await r.json()).token}
  const nurseToken=await token(nurse),superToken=await token(supervisor);
  const state=await db.query("SELECT revision FROM siash_state WHERE id=1");const revision=Number(state.rows[0].revision);
  const referenceDate=new Date(Date.now()-160*86400000).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
  browser=await chromium.launch({headless:true});
  async function open(user,role,authToken){
   const page=await browser.newPage();
   await page.goto(url,{waitUntil:"domcontentloaded"});
   await page.evaluate(({user,role,authToken,revision,referenceDate})=>{
    document.querySelector("#app-view")?.classList.remove("hidden");
    document.querySelector("#view-lancamento")?.classList.remove("hidden");
    SESSION={authenticated:true,user,role};
    SIASH_CLOUD.token=authToken;SIASH_CLOUD.revision=revision;
    lateCensusSetStatus({attention:"overdue",referenceDate});
   },{user,role,authToken,revision,referenceDate});
   return page;
  }
  const nursePage=await open(nurse,"operational",nurseToken);
  assert.equal(await nursePage.locator("#census-late-open").isVisible(),false);
  assert.equal(await nursePage.locator("#census-close").isVisible(),true);
  assert.equal(await nursePage.locator("#census-close").isEnabled(),true);
  assert.equal(await nursePage.locator("#d-internados").isEnabled(),true);
  // Exercise retained historical controls in the isolated fixture only; production keeps them hidden.
  await nursePage.evaluate(()=>document.querySelector("#census-late-section").classList.remove("hidden"));
  await nursePage.locator("#census-late-open").click();
  await nursePage.locator("#census-late-date").fill(referenceDate);
  await nursePage.locator("#census-late-count").fill("4");
  await nursePage.locator("#census-late-justification").fill("Intercorrência assistencial no plantão noturno");
  await nursePage.locator("#census-late-evidence").fill("Registros do plantão e mapa de leitos");
  await nursePage.evaluate(revision=>{SIASH_CLOUD.revision=revision+1},revision);
  await nursePage.locator("#census-late-submit").click();
  await nursePage.waitForFunction(()=>document.querySelector("#census-late-form-status")?.textContent?.includes("409"),null,{timeout:10000});
  assert.equal(await nursePage.locator("#census-late-justification").inputValue(),"Intercorrência assistencial no plantão noturno");
  assert.equal(await nursePage.locator("#census-late-evidence").inputValue(),"Registros do plantão e mapa de leitos");
  await nursePage.evaluate(revision=>{SIASH_CLOUD.revision=revision},revision);
  await nursePage.locator("#census-late-submit").click();
  await nursePage.waitForFunction(()=>document.querySelector("#census-late-form-status")?.textContent?.includes("Protocolo:"),null,{timeout:10000});
  const requests=await db.query("SELECT protocol FROM siash_census_late_requests WHERE reference_date=$1",[referenceDate]);
  assert.equal(requests.rows.length,1);const protocol=requests.rows[0].protocol;
  await nursePage.evaluate(()=>lateCensusLoadRequests());
  await nursePage.waitForFunction(()=>document.querySelector("#census-late-requests")?.textContent?.includes("Autoaprovação proibida"),null,{timeout:10000});
  assert.equal(await nursePage.locator("#census-late-requests button").filter({hasText:"Analisar solicitação"}).count(),0);
  const supervisorPage=await open(supervisor,"owner",superToken);
  assert.equal(await supervisorPage.locator("#census-late-section").isVisible(),false);
  await supervisorPage.evaluate(()=>{document.querySelector("#census-late-section").classList.remove("hidden");return lateCensusLoadRequests()});
  await supervisorPage.locator("#census-late-requests button").filter({hasText:"Analisar solicitação"}).first().click();
  await supervisorPage.locator("#census-late-review-reason").fill("Evidências verificadas por supervisor independente");
  await supervisorPage.locator("#census-late-approve").click();
  await supervisorPage.waitForFunction(()=>document.querySelector("#census-late-events")?.textContent?.includes("regularizacao_aprovada"),null,{timeout:10000});
  assert.match(await supervisorPage.locator("#census-late-events").innerText(),/Tardio \/ Regularização/);
  const events=await db.query("SELECT event_type FROM siash_census_late_events WHERE protocol=$1 ORDER BY id",[protocol]);
  assert.equal(events.rows.at(-1).event_type,"regularizacao_aprovada");
 }finally{await browser?.close();child.kill("SIGTERM");await db.end()}
});
