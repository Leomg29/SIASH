"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),http=require("node:http");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR102 Chromium UI: real AI update click, privacy, metadata, draft reconciliation",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 const {Pool}=require("pg"),{chromium}=require("playwright"),bcrypt=require("bcryptjs"),AdmZip=require("adm-zip");
 const fixture=http.createServer((req,res)=>{
  const send=(obj,code=200,type="application/json")=>{res.writeHead(code,{"content-type":type});res.end(type==="application/json"?JSON.stringify(obj):obj)};
  if(req.url.startsWith("/eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"))return send({esearchresult:{idlist:["123456"]}});
  if(req.url.startsWith("/eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"))return send({result:{"123456":{title:"Neonatal hand hygiene clinical study",pubdate:"2025",fulljournalname:"Clinical Neonatology"}}});
  if(req.url.startsWith("/www.ebi.ac.uk/europepmc/webservices/rest/search"))return send({resultList:{result:[{pmid:"123456",title:"Neonatal hand hygiene clinical study",pubYear:"2025",journalTitle:"Clinical Neonatology"}]}});
  if(req.url.startsWith("/pubmed.ncbi.nlm.nih.gov/123456/"))return send("<html><head><title>Neonatal hand hygiene clinical study</title></head><body>Neonatal hand hygiene clinical study 2025</body></html>",200,"text/html");
  if(req.url.startsWith("/generativelanguage.googleapis.com/"))return send({candidates:[{content:{parts:[{text:JSON.stringify({summary:"Revisão com fonte científica controlada",updates:[{paragraph_index:0,new_text:"Higienização das mãos em neonatologia conforme evidência científica revisada.",reason:"Atualização com fonte rastreável",references:["https://pubmed.ncbi.nlm.nih.gov/123456/"]}],references:[]})}]}}]});
  return send({error:"Fixture not found"},404);
 });
 await new Promise(resolve=>fixture.listen(0,"127.0.0.1",resolve));
 const fixtureOrigin="http://127.0.0.1:"+fixture.address().port;
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 const port=18992,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"siash-pr100-chromium-isolated-secret-2026",SIASH_PR100_FIXTURE_ORIGIN:fixtureOrigin,GEMINI_API_KEY:"pr100-local-fixture-key",AI_PROVIDER:"gemini",TAVILY_API_KEY:""},stdio:["ignore","pipe","pipe"]});
 let logs="",browser;
 child.stdout.on("data",x=>logs+=x);child.stderr.on("data",x=>logs+=x);
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}

  const username="pr102_owner_"+Date.now(),password="PR102-Owner-2026!";
  await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,'owner')",[username,await bcrypt.hash(password,4)]);
  const login=await fetch(url+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password})});
  assert.equal(login.status,200);const {token}=await login.json();
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error"&&/ReferenceError/.test(m.text()))errors.push(m.text())});
  page.on("dialog",d=>d.accept());
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.evaluate(({username,token})=>{
   document.querySelector("#app-view")?.classList.remove("hidden");
   SESSION={authenticated:true,user:username,role:"owner"};SIASH_CLOUD.token=token;applyPermissions();
  },{username,token});
  await page.locator('.nav-item[data-view="docs"]').click();
  const privacy=await page.evaluate(async()=>({
   clean:await window.localDocPrivacyCheck("Procedimento institucional de higienização neonatal."),
   patient:await window.localDocPrivacyCheck("Paciente: Maria Silva"),
   lower:await window.localDocPrivacyCheck("paciente: Maria Silva"),
   upper:await window.localDocPrivacyCheck("PACIENTE: MARIA SILVA")
  }));
  assert.deepEqual(privacy.clean,[]);
  for(const k of ["patient","lower","upper"])assert.ok(privacy[k].includes("NOME_CLINICO"),k);
  const officialUrl="https://pubmed.ncbi.nlm.nih.gov/123456/";
  const zip=new AdmZip();
  zip.addFile("[Content_Types].xml",Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  zip.addFile("_rels/.rels",Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  zip.addFile("word/document.xml",Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>FUNDAÇÃO HOSPITALAR - CONFERÊNCIA TÉCNICA ASSISTIDA</w:t></w:r></w:p><w:p><w:r><w:t>Referências</w:t></w:r></w:p><w:p><w:r><w:t>'+officialUrl+'</w:t></w:r></w:p></w:body></w:document>'));

  const code="PR102-UI-"+Date.now(),key="pr102-source-"+Date.now();
  await page.evaluate(async ({code,key,bytes})=>{
   SIASH_CLOUD.conflict=true;
   S.docs.push({id:code,code,title:"Higienização das mãos em neonatologia",sector:"UTIN",period:24,seed:true,versions:[{revision:"01",workflow:"Vigente",reviewDate:"2026-01-01",wordKey:key,wordName:"PR102-CI.docx"}]});
   const db=await docsDb();
   await new Promise((resolve,reject)=>{const tx=db.transaction(DOCS_DB_STORE,"readwrite");tx.objectStore(DOCS_DB_STORE).put(new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))]),key);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)});
   renderDocs();
  },{code,key,bytes:zip.toBuffer().toString("base64")});
  const row=page.locator("#view-docs tr").filter({hasText:code});
  await row.getByRole("button",{name:/Atualizar com IA/i}).click();
  assert.equal(await page.locator("#doc-send-ai").isVisible(),true);
  await page.locator("#doc-send-ai").click();
  await page.waitForFunction(code=>S.docs.find(d=>d.code===code)?.versions?.some(v=>v.aiProvider&&v.aiResearchMode&&v.docxPreparedIntegrity),code,{timeout:60000});
  const panel=await page.locator("#doc-revision-panel").innerText();
  assert.match(panel,/Conferência Técnica Assistida/);
  assert.match(panel,/Referências científicas verificadas/);
  assert.match(panel,/DOCX.*ZIP.*CRC32.*Íntegro/i);
  const meta=await page.evaluate(code=>{
   const v=S.docs.find(d=>d.code===code).versions.find(v=>v.aiProvider);
   return {provider:v.aiProvider,model:v.aiModel,research:v.aiResearchMode,refs:v.aiReferences,crc:v.docxPreparedIntegrity};
  },code);
  assert.ok(meta.provider&&meta.model);assert.match(meta.research,/pubmed|europe|tavily|cache/i);
  assert.ok(meta.refs.some(x=>x.url===officialUrl));assert.equal(meta.crc,true);
  await page.evaluate(()=>{localStorage.setItem("siash_cloud_pending_v1",JSON.stringify({user:SESSION.user,revision:1,state:{docs:[]}}));document.querySelector("#cloud-conflict-panel").hidden=false});
  await page.locator("#cloud-conflict-close").click();
  assert.ok(await page.evaluate(()=>localStorage.getItem("siash_cloud_pending_v1")));
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();child.kill("SIGTERM");await db.end();await new Promise(resolve=>fixture.close(resolve))}
});
