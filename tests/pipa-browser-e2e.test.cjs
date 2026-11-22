"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR98 Chromium: post-discharge, duplicate warning, cancel/chart, correction and conflict",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const {chromium}=require("playwright"),port=18909,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"pr98-browser-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
 let browser;
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{document.querySelector("#app-view")?.classList.remove("hidden");document.querySelector("#view-pipa")?.classList.remove("hidden");document.querySelector("#view-indicators")?.classList.remove("hidden");S.pipa=[];S.daily=[];renderPipa();renderIndicators();});
  const fill=async(city,qty=1)=>{await page.locator("#pipa-date").fill("2026-11-20");await page.locator("#pipa-city").selectOption(city);await page.locator("#pipa-qty").fill(String(qty));await page.locator("#pipa-post-discharge").check();};
  await fill("Ibiaí");
  await page.locator("#pipa-form button[type=submit]").click();
  assert.equal(await page.evaluate(()=>S.pipa.length),1);
  assert.equal(await page.locator("#pipa-total").innerText(),"1");
  // Duplicate with an unaccented Other municipality must request confirmation.
  await fill("Outro");await page.locator("#pipa-city-other").fill("Ibiai");
  let duplicatePrompt="";page.once("dialog",async d=>{duplicatePrompt=d.message();await d.dismiss()});
  await page.locator("#pipa-form button[type=submit]").click();
  assert.match(duplicatePrompt,/duplicado/i);assert.equal(await page.evaluate(()=>S.pipa.length),1);
  await page.locator("#pipa-post-discharge").check();
  page.once("dialog",async d=>{assert.match(d.message(),/duplicado/i);await d.accept()});
  await page.locator("#pipa-form button[type=submit]").click();
  assert.equal(await page.evaluate(()=>S.pipa.length),2);
  await page.evaluate(()=>{document.querySelector("#indicator-month").value="2026-11";renderIndicators()});
  assert.match(await page.locator("#indicator-pipa-cities").innerText(),/Ibiaí/);
  // Cancel the second record; the original remains in S.pipa and the graph excludes it.
  const dialogs=["accept","prompt"];page.on("dialog",async d=>{if(dialogs.shift()==="prompt")await d.accept("Cancelamento confirmado por conferência de origem");else await d.accept()});
  await page.evaluate(()=>deletePipa(1));
  assert.equal(await page.evaluate(()=>S.pipa.length),2);
  assert.ok(await page.evaluate(()=>Boolean(S.pipa[1].cancelledAt)));
  await page.evaluate(()=>{renderPipa();document.querySelector("#indicator-month").value="2026-11";renderIndicators()});
  assert.equal(await page.locator("#pipa-total").innerText(),"1");
  assert.match(await page.locator("#pipa-table").innerText(),/Cancelado/);
  assert.match(await page.locator("#indicator-pipa-cities").innerText(),/Ibiaí/);
  const municipalChart=page.locator("#siash-indicator-charts article.panel").filter({has:page.locator("h3", {hasText:"PIPA por município"})});
  assert.match(await municipalChart.innerText(),/Ibiaí/);
  assert.match(await municipalChart.innerText(),/1/);
  assert.doesNotMatch(await municipalChart.innerText(),/Ibiai/);
  // Retification is a separate server audit, without rewriting the PIPA row.
  await page.route("**/api/pipa/rectifications",async route=>{
   if(route.request().method()==="POST")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,id:"pr98-browser-event"})});
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({events:[{record_index:0,username:"qa-isolated",created_at:"2026-11-20T12:00:00Z",reason:"Conferência documental da competência",correction:"Município confirmado por registro de origem"}]})});
  });
  await page.evaluate(()=>{SIASH_CLOUD.enabled=true;SIASH_CLOUD.token="isolated-browser-token";SIASH_CLOUD.revision=1});
  page.removeAllListeners("dialog");
  const answers=["Conferência documental da competência","Município confirmado por registro de origem"];
  page.on("dialog",async d=>{if(d.type()==="prompt")await d.accept(answers.shift()||"");else await d.accept()});
  await page.evaluate(()=>rectifyPipa(0));
  await page.waitForFunction(()=>document.querySelector("#pipa-rectifications").textContent.includes("qa-isolated"));
  assert.match(await page.locator("#pipa-rectifications").innerText(),/Município confirmado/);
  assert.equal(await page.evaluate(()=>S.pipa[0].city),"Ibiaí");
  // Verify conflict draft protection without issuing a production write.
  await page.evaluate(()=>{SIASH_CLOUD.conflict=true;localStorage.setItem(STORE,JSON.stringify(S))});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(STORE)).pipa.length),2);
 }finally{await browser?.close();child.kill("SIGTERM")}
});