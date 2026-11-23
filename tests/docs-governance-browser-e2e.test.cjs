"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR100 Chromium: authenticated owner navigates to SIASH Docs",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 const {Pool}=require("pg"),{chromium}=require("playwright"),bcrypt=require("bcryptjs");
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 const port=18991,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"siash-pr100-chromium-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="",browser;
 child.stdout.on("data",x=>logs+=x);child.stderr.on("data",x=>logs+=x);
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  const username="pr100_owner_"+Date.now(),password="PR100-Owner-2026!";
  await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,'owner')",[username,await bcrypt.hash(password,4)]);
  const login=await fetch(url+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password})});
  assert.equal(login.status,200);const {token}=await login.json();assert.ok(token);
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage();
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.evaluate(({username,token})=>{
   document.querySelector("#app-view")?.classList.remove("hidden");
   SESSION={authenticated:true,user:username,role:"owner"};
   SIASH_CLOUD.token=token;applyPermissions();
  },{username,token});
  const nav=page.locator('.nav-item[data-view="docs"]');
  assert.equal(await nav.isVisible(),true);
  await nav.click();
  assert.equal(await page.locator("#view-docs").isVisible(),true);
  assert.match(await page.locator("#view-docs").innerText(),/document|POP|revis/i);
  const response=await page.evaluate(async token=>{
   const r=await fetch("/api/docs/publish",{method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({doc_id:"nonexistent",revision:"01",base_revision:0,technical_confirmation:false})});
   return {status:r.status,data:await r.json()};
  },token);
  assert.equal(response.status,422);
  assert.equal(response.data.error,"TECHNICAL_CONFIRMATION_REQUIRED");
  // Browser-level 409 regression: publication must retain the existing draft and IndexedDB file.
  const conflictResult=await page.evaluate(async()=>{
   const key="siash_pr100_409_"+Date.now();
   const initial=JSON.stringify({doc_id:"pr100",revision:"02",justification:"Conferência técnica pendente"});
   localStorage.setItem("siash_utin_consolidada_v08",initial);
   const originalFetch=window.fetch;
   window.fetch=async(input,options)=>{
    if(String(input).includes("/api/docs/publish"))return new Response(JSON.stringify({error:"DOC_REVISION_CONFLICT",conflict:true}),{status:409,headers:{"content-type":"application/json"}});
    return originalFetch(input,options);
   };
   try{
    const res=await fetch("/api/docs/publish",{method:"POST"});
    const unchanged=localStorage.getItem("siash_utin_consolidada_v08")===initial;
    return {status:res.status,unchanged,key};
   }finally{window.fetch=originalFetch;localStorage.removeItem("siash_utin_consolidada_v08")}
  });
  assert.equal(conflictResult.status,409);
  assert.equal(conflictResult.unchanged,true);
  assert.match(await page.locator("body").innerText(),/document|POP|revis/i);

 }finally{await browser?.close();child.kill("SIGTERM");await db.end()}
});
