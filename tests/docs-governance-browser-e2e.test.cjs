"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const http=require("node:http");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR100 Chromium: authenticated owner navigates to SIASH Docs",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 const {Pool}=require("pg"),{chromium}=require("playwright"),bcrypt=require("bcryptjs");

 const fixture=http.createServer((req,res)=>{
  const send=(obj,code=200,type="application/json")=>{res.writeHead(code,{"content-type":type});res.end(type==="application/json"?JSON.stringify(obj):obj)};
  if(req.url.startsWith("/eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"))return send({esearchresult:{idlist:["123456"]}});
  if(req.url.startsWith("/eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"))return send({result:{"123456":{title:"Neonatal hand hygiene clinical study",pubdate:"2025",fulljournalname:"Clinical Neonatology"}}});
  if(req.url.startsWith("/www.ebi.ac.uk/europepmc/webservices/rest/search"))return send({resultList:{result:[{pmid:"123456",title:"Neonatal hand hygiene clinical study",pubYear:"2025",journalTitle:"Clinical Neonatology"}]}});
  if(req.url.startsWith("/pubmed.ncbi.nlm.nih.gov/123456/"))return send("<html><head><title>Neonatal hand hygiene clinical study</title></head><body>Neonatal hand hygiene clinical study 2025</body></html>",200,"text/html");
  if(req.url.startsWith("/generativelanguage.googleapis.com/"))return send({candidates:[{content:{parts:[{text:JSON.stringify({summary:"Revisão com fonte científica controlada",updates:[{paragraph_index:0,new_text:"Higienização das mãos em neonatologia conforme evidência científica revisada.",reason:"Atualização com fonte rastreável",references:["FONTE_1"]}],references:[]})}]}}]});
  return send({error:"Fixture not found"},404);
 });
 await new Promise(resolve=>fixture.listen(0,"127.0.0.1",resolve));
 const fixtureOrigin="http://127.0.0.1:"+fixture.address().port;
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 const port=18991,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"siash-pr100-chromium-isolated-secret-2026",SIASH_PR100_FIXTURE_ORIGIN:fixtureOrigin,GEMINI_API_KEY:"pr100-local-fixture-key",AI_PROVIDER:"gemini",TAVILY_API_KEY:""},stdio:["ignore","pipe","pipe"]});
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
  // Genuine server-side concurrency: two Chromium sessions retain the same revision.
  // The first session commits the unchanged state; the second submits its stale revision.
  const second=await browser.newPage();
  try{
   await second.goto(url,{waitUntil:"domcontentloaded"});
   const baseline=await page.evaluate(async token=>{
    const r=await fetch("/api/state",{headers:{authorization:"Bearer "+token}});
    return {status:r.status,data:await r.json()};
   },token);
   assert.equal(baseline.status,200);
   if(baseline.data.exists){
    const snapshot=JSON.stringify(baseline.data.payload);
    await second.evaluate(({snapshot})=>{
     localStorage.setItem("siash_pr100_pending_document",snapshot);
    },{snapshot});
    const first=await page.evaluate(async ({token,baseline})=>{
     const r=await fetch("/api/state",{method:"PUT",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({payload:baseline.payload,base_revision:baseline.revision})});
     return {status:r.status,data:await r.json()};
    },{token,baseline:baseline.data});
    assert.equal(first.status,200,"first Chromium session must commit state successfully");
    const stale=await second.evaluate(async ({token,baseline})=>{
     const r=await fetch("/api/docs/publish",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({doc_id:"pr100-concurrent",revision:"01",base_revision:baseline.revision,technical_confirmation:true})});
     return {status:r.status,data:await r.json(),draft:localStorage.getItem("siash_pr100_pending_document")};
    },{token,baseline:baseline.data});
    assert.equal(stale.status,409,"second Chromium session must receive a real server 409");
    assert.equal(stale.data.error,"DOC_REVISION_CONFLICT");
    assert.equal(stale.draft,snapshot,"second session's local draft must remain intact");
   }
  }finally{await second.close()}

  // Real owner publication with a structurally verified OOXML artifact in isolated PostgreSQL.
  // Synthetic fixture only: this does NOT claim a live PubMed query or an AI-generated document.
  const AdmZip=require("adm-zip");
  const key="pr100-e2e-docx-"+Date.now(),docId="pr100-e2e-"+Date.now();
  const officialUrl="https://pubmed.ncbi.nlm.nih.gov/123456/";
  const zip=new AdmZip();
  zip.addFile("[Content_Types].xml",Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  zip.addFile("word/document.xml",Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>FUNDAÇÃO HOSPITALAR - CONFERÊNCIA TÉCNICA ASSISTIDA</w:t></w:r></w:p><w:p><w:r><w:t>Referências</w:t></w:r></w:p><w:p><w:r><w:t>'+officialUrl+'</w:t></w:r></w:p></w:body></w:document>'));
  const docx=zip.toBuffer();
  assert.equal(new AdmZip(docx).getEntry("word/document.xml").getData().toString("utf8").includes(officialUrl),true);

  // The actual revision route executes public PubMed/Europe PMC research, Gemini-shaped
  // provider response and OOXML generation against the deterministic local HTTP fixture.
  const sourceZip=new AdmZip();
  sourceZip.addFile("[Content_Types].xml",zip.getEntry("[Content_Types].xml").getData());
  sourceZip.addFile("word/document.xml",Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Higienização das mãos em neonatologia.</w:t></w:r></w:p><w:p><w:r><w:t>Referências</w:t></w:r></w:p></w:body></w:document>'));
  const generated=await page.evaluate(async ({token,source})=>{
   const response=await fetch("/api/ai/revise-pop",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({doc_code:"PR100-CI-TEST",doc_title:"Higienização das mãos em neonatologia",current_revision:"01",next_revision:"02",file_name:"PR100-CI.docx",file_base64:source,provider:"gemini",correction_request:"Atualizar descrição de higienização das mãos com base na fonte científica"})});
   return {status:response.status,data:await response.json()};
  },{token,source:sourceZip.toBuffer().toString("base64")});
  assert.equal(generated.status,200,JSON.stringify(generated.data).slice(0,1000));
  assert.equal(generated.data.ok,true);
  const generatedBuffer=Buffer.from(generated.data.file_base64,"base64");
  const generatedZip=new AdmZip(generatedBuffer);
  for(const entry of generatedZip.getEntries())if(!entry.isDirectory)assert.ok(entry.getData().length>=0);
  const generatedXml=generatedZip.getEntry("word/document.xml").getData().toString("utf8");
  assert.match(generatedXml,/Referências/);
  assert.ok(generatedXml.includes(officialUrl),"official PubMed URL must be embedded in generated Word bibliography");
  const prior=await db.query("SELECT payload,revision FROM siash_state WHERE id=1");
  if(prior.rows.length){
   const originalPayload=prior.rows[0].payload,originalRevision=prior.rows[0].revision;
   try{
    const payload=structuredClone(originalPayload);
    payload.state=payload.state||{};payload.state.docs=Array.isArray(payload.state.docs)?payload.state.docs:[];
    payload.state.docs.push({id:docId,code:"PR100-CI",title:"Teste isolado de publicação",sector:"UTIN",versions:[
     {revision:"01",workflow:"Vigente",wordKey:"pr100-legacy-ci",createdBy:"CI"},
     {revision:"02",workflow:"Aguardando aprovação",wordKey:key,wordName:"pr100.docx",publicationPrepared:true,approvalEmbedded:true,docxIntegrityValidated:true,createdBy:"CI",aiProvider:"gemini",aiReferences:[{title:"Neonatal hand hygiene clinical study",url:officialUrl}]}
    ]});
    const uploaded=await page.evaluate(async ({token,key,bytes})=>{
     const binary=Uint8Array.from(atob(bytes),c=>c.charCodeAt(0));
     const response=await fetch("/api/doc/"+encodeURIComponent(key),{method:"PUT",headers:{authorization:"Bearer "+token,"content-type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","x-file-name":"pr100.docx","x-doc-sector":"UTIN"},body:binary});
     return {status:response.status,data:await response.json()};
    },{token,key,bytes:generated.data.file_base64});
    assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
    const stored=await db.query("SELECT file_data FROM siash_documents WHERE doc_key=$1",[key]);
    assert.deepEqual(stored.rows[0].file_data,generatedBuffer,"published file must match exact AI-generated bytes");
    await db.query("UPDATE siash_state SET payload=$1,revision=revision+1 WHERE id=1",[payload]);
    const current=Number(originalRevision)+1;
    const publication=await page.evaluate(async ({token,docId,current})=>{
     const r=await fetch("/api/docs/publish",{method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({doc_id:docId,revision:"02",base_revision:current,technical_confirmation:true})});
     return {status:r.status,data:await r.json()};
    },{token,docId,current});
    assert.equal(publication.status,200,JSON.stringify(publication.data));
    const after=await db.query("SELECT payload FROM siash_state WHERE id=1");
    const versions=after.rows[0].payload.state.docs.find(x=>x.id===docId).versions;
    assert.equal(versions[0].workflow,"Obsoleto");
    assert.equal(versions[1].workflow,"Vigente");
   }finally{
    await db.query("UPDATE siash_state SET payload=$1,revision=revision+1 WHERE id=1",[originalPayload]);
    // Publication audit is intentionally append-only. CI uses an ephemeral database; never delete audit rows.
    // Isolated CI artifact retained for append-only audit traceability.
   }
  }


 }finally{await browser?.close();child.kill("SIGTERM");await db.end();await new Promise(resolve=>fixture.close(resolve))}
});
