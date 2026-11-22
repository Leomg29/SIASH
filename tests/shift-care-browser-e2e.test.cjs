"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR99 Chromium: shift warning, closure, immutable history, care and HTTP409 draft",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const {chromium}=require("playwright"),port=18919,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"pr99-browser-isolated-secret-2026-longer-than-32"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);let browser;
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{document.querySelector("#app-view").classList.remove("hidden");document.querySelector("#view-plantao").classList.remove("hidden");normalize();renderAll()});
  let warning="";page.once("dialog",async d=>{warning=d.message();await d.accept()});
  await page.locator("#close-shift").click();
  assert.match(warning,/Checklist pendente:/);assert.match(warning,/Nenhuma tarefa será concluída automaticamente/);
  assert.equal(await page.evaluate(()=>S.shiftHistory.length),1);
  assert.equal(await page.evaluate(()=>S.shiftClosed),true);
  assert.match(await page.locator("#shift-history").innerText(),/Aguardando servidor/);
  page.once("dialog",d=>d.accept());await page.locator("#reset-shift").click();
  assert.equal(await page.evaluate(()=>S.shiftHistory.length),1);
  assert.equal(await page.evaluate(()=>S.shiftClosed),false);
  assert.equal(await page.evaluate(()=>S.checklist.every(x=>x.status==="Pendente")),true);
  assert.equal(await page.evaluate(()=>S.events.length),0);
  await page.evaluate(()=>setCheck(0,"Realizado"));
  assert.equal(await page.evaluate(()=>S.checklistHistory.length),1);
  assert.equal(await page.evaluate(()=>S.shiftHistory[0].checklist[0].status),"Pendente");
  // A new bed episode must be explicitly confirmed, never copied from an earlier RN.
  await page.evaluate(()=>{S.beds[0].status="Ocupado";S.beds[0].rn="RN-ISOLATED";S.care[1]={sae:"Pendente",episodeRn:"RN-OLD"};renderAll()});
  assert.notEqual(await page.evaluate(()=>S.beds[0].rn),await page.evaluate(()=>S.care[1].episodeRn));
  let episodeAlert="";
  page.once("dialog",async d=>{episodeAlert=d.message();await d.dismiss()});
  await page.evaluate(()=>{document.querySelector("#care-bed").value="1";document.querySelector("#care-save").click()});
  assert.match(episodeAlert,/Mudança de ocupação detectada/);
  assert.equal(await page.evaluate(()=>S.care[1].episodeRn),"RN-OLD");
  // Reopening a completed shared task requires explicit confirmation and justification.
  let reopenBody=null;
  await page.route("**/api/pending/99",async route=>{reopenBody=JSON.parse(route.request().postData());await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({item:{id:99,status:"Pendente"}})})});
  await page.route("**/api/pending",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({items:[]})}));
  await page.evaluate(()=>{sharedPending=[{id:99,status:"Concluída",scope:"bed",bed:"1",priority:"Crítica",description:"Rever material",created_by:"qa",created_at:"2026-11-20T12:00:00Z"}];SIASH_CLOUD.token="isolated-browser-token";renderPending()});
  const answers=["accept","Justificativa documental para reabertura"];
  page.on("dialog",async d=>{const answer=answers.shift();if(d.type()==="prompt")await d.accept(answer);else await d.accept()});
  await page.evaluate(()=>changeSharedPending(99,"Pendente"));
  await page.waitForFunction(()=>sharedPending.length===0);
  assert.equal(reopenBody?.confirm_reopen,true);
  assert.match(reopenBody?.reason||"",/Justificativa documental/);
  page.removeAllListeners("dialog");
  // Simulate a real conflict response and assert local draft persistence.
  await page.route("**/api/state",async route=>{
   if(route.request().method()==="PUT")return route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"Conflito entre plantões",conflict:true,current_revision:2})});
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({exists:true,revision:2,payload:{state:{}}})});
  });
  await page.evaluate(()=>{SIASH_CLOUD.enabled=true;SIASH_CLOUD.token="isolated-browser-token";SIASH_CLOUD.revision=1;SIASH_CLOUD.conflict=false;scheduleCloudSave()});
  await page.waitForFunction(()=>SIASH_CLOUD.conflict===true,{timeout:10000});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(STORE)).shiftHistory.length),1);
  assert.equal(await page.evaluate(()=>S.checklistHistory.length),1);
 }finally{await browser?.close();child.kill("SIGTERM")}
});