"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
test("PR100 Chromium: interface contains documentary and approval safeguards",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:30000},async()=>{
 const {chromium}=require("playwright");
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage();
  await page.goto("file://"+require("node:path").resolve(__dirname,"../index.html"));
  const text=await page.locator("body").innerText();
  assert.match(text,/SIASH|HospitalIA/i);
  assert.match(text,/document|POP|revis/i);
 }finally{await browser.close()}
});
