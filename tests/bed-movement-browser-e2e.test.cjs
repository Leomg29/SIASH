"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR96 Chromium: invalid occupancy blocked before local or cloud write",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const {chromium}=require("playwright");
 const port=18898,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"pr96-browser-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
 let browser;
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{
    document.querySelector("#app-view")?.classList.remove("hidden");
    document.querySelector("#view-leitos")?.classList.remove("hidden");
    S.beds=Array.from({length:10},(_,i)=>({n:i+1,isolation:i>=8,status:"Livre",profile:"Intensivo",rn:"",note:""}));
    renderBeds();
  });
  await page.locator("#bed-number").selectOption("1");
  await page.locator("#bed-status").selectOption("Ocupado");
  await page.locator("#bed-rn").fill("");
  let warning="";page.on("dialog",async dialog=>{warning=dialog.message();await dialog.accept()});
  await page.locator("#bed-form button[type=submit]").click();
  assert.match(warning,/identificador não nominal/);
  assert.equal(await page.evaluate(()=>S.beds[0].status),"Livre");
  await page.locator("#bed-status").selectOption("Livre");
  await page.locator("#bed-rn").fill("RN-INVALID");
  await page.locator("#bed-form button[type=submit]").click();
  assert.equal(await page.evaluate(()=>S.beds[0].rn),"");
  await page.locator("#bed-status").selectOption("Ocupado");
  await page.locator("#bed-rn").fill("RN-96");
  await page.locator("#bed-form button[type=submit]").click();
  assert.equal(await page.evaluate(()=>S.beds[0].status),"Ocupado");
  await page.locator("#profile-bed").selectOption("1");
  await page.locator("#profile-new").selectOption("Intermediário");
  await page.locator("#profile-form button[type=submit]").click();
  assert.equal(await page.evaluate(()=>S.beds[0].profile),"Intermediário");
  assert.equal(await page.evaluate(()=>S.profileHistory.at(-1).bed),1);
  await page.locator("#move-origin").selectOption("1");
  await page.locator("#move-target").selectOption("9");
  await page.locator("#move-bed-form button[type=submit]").click();
  assert.equal(await page.evaluate(()=>S.beds[8].rn),"RN-96");
  assert.equal(await page.evaluate(()=>S.beds[8].profile),"Intermediário");
  assert.equal(await page.evaluate(()=>S.beds[0].status),"Livre");
  assert.equal(await page.evaluate(()=>S.bedMoves.at(-1).target),9);
  await page.evaluate(()=>{
    S.daily=[{date:todayISO(),internados:3}];
    renderBeds();
  });
  assert.match(await page.locator("#bed-reconciliation-alert").innerText(),/Conferência humana necessária/);
  assert.equal(await page.locator("#bed-sync-status").innerText(),"Persistência: Rascunho local");

 }finally{await browser?.close();child.kill("SIGTERM")}
});
