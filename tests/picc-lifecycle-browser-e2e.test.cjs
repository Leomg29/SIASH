"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR97 Chromium: insertion, withdrawal confirmation, legacy alert, immutable history",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const {chromium}=require("playwright"),port=18899,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"pr97-browser-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
 let browser;
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{document.querySelector("#app-view")?.classList.remove("hidden");document.querySelector("#view-picc")?.classList.remove("hidden");S.picc=[];S.piccEvents=[];S.beds=blankState().beds;renderPicc();populateBedSelects();});
  await page.locator("#picc-date").fill("2026-11-20");
  await page.locator("#picc-bed").selectOption("1");
  await page.locator("#picc-vein").selectOption("Basílica");
  await page.locator("#picc-form button[type=submit]").click();
  assert.equal(await page.evaluate(()=>S.picc.length),1);
  assert.equal(await page.locator("#picc-active-table").locator("button").filter({hasText:"Excluir"}).count(),0);
  assert.match(await page.locator("#picc-reconciliation").innerText(),/alertas informativos/i);
  await page.locator("#picc-active-table").getByText("Registrar retirada").click();
  await page.locator("#picc-removal-date").fill("2026-11-21");
  await page.locator("#picc-removal-reason").selectOption("Programada / suspensão do tratamento");
  let confirmation="";page.on("dialog",async dialog=>{confirmation=dialog.message();await dialog.accept()});
  await page.locator("#picc-removal-form button[type=submit]").click();
  assert.match(confirmation,/Confirmar retirada do PICC/);
  assert.equal(await page.evaluate(()=>S.picc[0].status),"Retirado");
  assert.equal(await page.locator("#picc-history-table").locator("button").filter({hasText:"Excluir"}).count(),0);
  assert.equal(await page.evaluate(()=>S.picc[0].removalReason),"Programada / suspensão do tratamento");
 }finally{await browser?.close();child.kill("SIGTERM")}
});
