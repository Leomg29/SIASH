
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
if (!DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("JWT_SECRET deve ter pelo menos 32 caracteres.");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

app.use(express.json({ limit: "25mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "40mb" }));

async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS siash_users(
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','operational')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS siash_state(
      id INTEGER PRIMARY KEY CHECK(id=1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS siash_documents(
      doc_key TEXT PRIMARY KEY,
      file_name TEXT,
      mime_type TEXT,
      file_data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS siash_state_history(
      id BIGSERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      saved_by TEXT,
      reason TEXT
    );
    CREATE TABLE IF NOT EXISTS siash_cloud_audit(
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      username TEXT,
      action TEXT NOT NULL,
      details JSONB
    );
  `);
}
function tokenFor(user){ return jwt.sign({u:user.username,r:user.role}, JWT_SECRET,{expiresIn:"12h"}); }
function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  try{req.user=jwt.verify(token,JWT_SECRET);next()}catch(e){res.status(401).json({error:"Sessão inválida ou expirada."})}
}
async function audit(username,action,details=null){
  try{await pool.query("INSERT INTO siash_cloud_audit(username,action,details) VALUES($1,$2,$3)",[username,action,details])}catch(e){}
}

app.get("/api/health", async (req,res)=>{
  const users = await pool.query("SELECT COUNT(*)::int n FROM siash_users");
  const state = await pool.query("SELECT updated_at,updated_by FROM siash_state WHERE id=1");
  res.json({ok:true,configured:users.rows[0].n>0,state:state.rows[0]||null});
});

app.post("/api/bootstrap", async(req,res)=>{
  const count=await pool.query("SELECT COUNT(*)::int n FROM siash_users");
  if(count.rows[0].n>0) return res.status(409).json({error:"Administrador já configurado."});
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  if(!username || password.length<10) return res.status(400).json({error:"Usuário e senha de pelo menos 10 caracteres são obrigatórios."});
  const hash=await bcrypt.hash(password,12);
  await pool.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,'owner')",[username,hash]);
  await audit(username,"Administrador Proprietário Cloud criado.");
  const user={username,role:"owner"};
  res.json({token:tokenFor(user),role:"owner",user:username});
});

app.post("/api/login", async(req,res)=>{
  const username=String(req.body.username||"").trim(), password=String(req.body.password||"");
  const q=await pool.query("SELECT username,password_hash,role FROM siash_users WHERE username=$1",[username]);
  if(!q.rows.length || !(await bcrypt.compare(password,q.rows[0].password_hash)))
    return res.status(401).json({error:"Usuário ou senha inválidos."});
  const u=q.rows[0]; await audit(username,"Login Cloud.");
  res.json({token:tokenFor(u),role:u.role,user:u.username});
});

app.get("/api/state",auth,async(req,res)=>{
  const q=await pool.query("SELECT payload,updated_at,updated_by FROM siash_state WHERE id=1");
  if(!q.rows.length) return res.json({exists:false});
  res.json({exists:true,payload:q.rows[0].payload,updated_at:q.rows[0].updated_at,updated_by:q.rows[0].updated_by});
});
app.put("/api/state",auth,async(req,res)=>{
  const payload=req.body?.payload;
  if(!payload || typeof payload!=="object") return res.status(400).json({error:"Estado inválido."});
  const client=await pool.connect();try{await client.query("BEGIN");const cur=await client.query("SELECT payload FROM siash_state WHERE id=1 FOR UPDATE");if(cur.rows.length)await client.query("INSERT INTO siash_state_history(payload,saved_by,reason) VALUES($1,$2,$3)",[cur.rows[0].payload,req.user.u,req.body?.reason||"Antes de atualização do estado"]);await client.query(`
    INSERT INTO siash_state(id,payload,updated_at,updated_by) VALUES(1,$1,NOW(),$2)
    ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW(),updated_by=EXCLUDED.updated_by
  `,[payload,req.user.u]);await client.query("COMMIT")}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
  res.json({ok:true,updated_at:new Date().toISOString()});
});
app.put("/api/state/init",auth,async(req,res)=>{
  const exists=await pool.query("SELECT 1 FROM siash_state WHERE id=1");
  if(exists.rows.length) return res.status(409).json({error:"Banco central já possui dados."});
  const payload=req.body?.payload;if(!payload)return res.status(400).json({error:"Estado inválido."});
  await pool.query("INSERT INTO siash_state(id,payload,updated_by) VALUES(1,$1,$2)",[payload,req.user.u]);
  await audit(req.user.u,"Migração inicial para banco central.");
  res.json({ok:true});
});

app.put("/api/doc/:key",auth,async(req,res)=>{
  const key=req.params.key, fileName=decodeURIComponent(req.headers["x-file-name"]||key), mime=req.headers["content-type"]||"application/octet-stream";
  if(!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({error:"Arquivo vazio."});
  await pool.query(`
    INSERT INTO siash_documents(doc_key,file_name,mime_type,file_data,updated_at,updated_by)
    VALUES($1,$2,$3,$4,NOW(),$5)
    ON CONFLICT(doc_key) DO UPDATE SET file_name=EXCLUDED.file_name,mime_type=EXCLUDED.mime_type,file_data=EXCLUDED.file_data,updated_at=NOW(),updated_by=EXCLUDED.updated_by
  `,[key,fileName,mime,req.body,req.user.u]);
  res.json({ok:true});
});
app.get("/api/doc/:key",auth,async(req,res)=>{
  const q=await pool.query("SELECT file_name,mime_type,file_data FROM siash_documents WHERE doc_key=$1",[req.params.key]);
  if(!q.rows.length)return res.status(404).end();
  res.setHeader("Content-Type",q.rows[0].mime_type||"application/octet-stream");
  res.setHeader("X-File-Name",encodeURIComponent(q.rows[0].file_name||req.params.key));
  res.send(q.rows[0].file_data);
});



// v0.14.7 — migração segura de Word legado .doc para .docx.
// A conversão é estritamente de formato: não cria revisão, não muda vigência, workflow,
// aprovação ou histórico. O original só é substituído no vínculo após validação do DOCX gerado.
const LEGACY_DOC_CONVERT_TIMEOUT_MS=Math.max(30000,Number(process.env.LEGACY_DOC_CONVERT_TIMEOUT_MS||120000));
function isLegacyBinaryDocName(name=""){return /\.doc$/i.test(String(name||"").trim())&&!/\.docx$/i.test(String(name||"").trim())}
function hasOleCompoundSignature(buf){return Buffer.isBuffer(buf)&&buf.length>=8&&buf.subarray(0,8).equals(Buffer.from([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]))}
function validateGeneratedDocx(buf){
  try{const z=new AdmZip(buf),e=z.getEntry("word/document.xml");return !!(e&&e.getData().length)}catch(_){return false}
}
async function convertLegacyDocBufferToDocx(inputBuffer,inputName="documento.doc"){
  if(!hasOleCompoundSignature(inputBuffer))throw new Error("O arquivo .doc não possui a assinatura binária esperada do Word antigo; nenhuma conversão foi realizada.");
  const base=String(inputName||"documento.doc").replace(/[\\/:*?"<>|]/g,"_").replace(/\.doc$/i,"")||"documento";
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),"siash-doc-"));
  const inPath=path.join(dir,base+".doc"),outPath=path.join(dir,base+".docx");
  try{
    await fs.promises.writeFile(inPath,inputBuffer);
    const commands=[process.env.LIBREOFFICE_BIN,"libreoffice","soffice"].filter(Boolean);
    let lastErr=null,used="";
    for(const cmd of [...new Set(commands)]){
      try{
        await execFileAsync(cmd,["--headless","--convert-to","docx","--outdir",dir,inPath],{timeout:LEGACY_DOC_CONVERT_TIMEOUT_MS,maxBuffer:1024*1024*4});used=cmd;lastErr=null;break;
      }catch(e){lastErr=e}
    }
    if(lastErr)throw new Error("Conversor LibreOffice indisponível ou falhou ao abrir o .doc legado.");
    let actualOut=outPath;
    try{await fs.promises.access(actualOut)}catch(_){const found=(await fs.promises.readdir(dir)).find(x=>/\.docx$/i.test(x));if(found)actualOut=path.join(dir,found);else throw new Error("O conversor não gerou o arquivo .docx esperado.")}
    const out=await fs.promises.readFile(actualOut);
    if(!validateGeneratedDocx(out))throw new Error("O .docx gerado não passou na validação estrutural OOXML; o original foi preservado.");
    return {buffer:out,fileName:base+".docx",converter:used||"libreoffice"};
  }finally{await fs.promises.rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
app.post("/api/docs/convert-legacy-word",auth,async(req,res)=>{
  if(req.user.r!=="owner")return res.status(403).json({error:"Somente o Administrador Proprietário pode migrar Word legado .doc para .docx."});
  try{
    const {file_name,file_base64}=req.body||{};
    if(!isLegacyBinaryDocName(file_name))return res.status(400).json({error:"Conversão ignorada: somente arquivos Word antigos com extensão .doc são aceitos."});
    const input=Buffer.from(String(file_base64||""),"base64");
    if(!input.length)return res.status(400).json({error:"Arquivo .doc vazio ou ausente."});
    if(input.length>18*1024*1024)return res.status(413).json({error:"Word .doc acima do limite de 18 MB para conversão segura."});
    const converted=await convertLegacyDocBufferToDocx(input,file_name);
    await audit(req.user.u,"SIASH Docs: Word legado .doc convertido para .docx sem criação de revisão.",{original_name:String(file_name),new_name:converted.fileName,converter:converted.converter,bytes_in:input.length,bytes_out:converted.buffer.length});
    res.json({ok:true,file_name:converted.fileName,mime_type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",file_base64:converted.buffer.toString("base64")});
  }catch(e){console.error("Legacy DOC conversion:",e);res.status(500).json({error:"Falha ao converter Word antigo .doc para .docx: "+(e?.message||"erro interno")})}
});

// --- SIASH Docs IA: revisão técnico-científica com preservação do OOXML ---
const OpenAI = require("openai");
const AdmZip = require("adm-zip");
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_SEARCH_MODE = String(process.env.GEMINI_SEARCH_MODE || "off").toLowerCase();
const TAVILY_API_KEY = String(process.env.TAVILY_API_KEY || "").trim();
const AI_DEFAULT_PROVIDER = String(process.env.AI_PROVIDER || "auto").toLowerCase();
const GEMINI_TIMEOUT_MS = Math.max(15000, Number(process.env.GEMINI_TIMEOUT_MS || 90000));
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CLOUDFLARE_AI_MODEL = process.env.CLOUDFLARE_AI_MODEL || "@cf/zai-org/glm-4.7-flash";
// v0.14.22 — prioriza o modelo gratuito que concluiu com sucesso o fluxo Tavily no ambiente real.
const CLOUDFLARE_FREE_MODEL_FALLBACKS = [
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it"
];
const CLOUDFLARE_KNOWN_PAID_MODELS = new Set([
  "@cf/moonshotai/kimi-k2.5",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/moonshotai/kimi-k2.7-code",
  "@cf/zai-org/glm-5.2"
]);
const CLOUDFLARE_TIMEOUT_MS = Math.max(60000, Number(process.env.CLOUDFLARE_TIMEOUT_MS || 240000));
const CLOUDFLARE_MAX_COMPLETION_TOKENS = Math.max(1000, Number(process.env.CLOUDFLARE_MAX_COMPLETION_TOKENS || 5000));
const CLOUDFLARE_REASONING_EFFORT = String(process.env.CLOUDFLARE_REASONING_EFFORT || "low").toLowerCase();
function xmlDecode(s=""){return s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}
function xmlEncode(s=""){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}
function docxParagraphs(buf){
  const zip=new AdmZip(buf),entry=zip.getEntry("word/document.xml");if(!entry)throw new Error("DOCX sem word/document.xml.");
  const xml=entry.getData().toString("utf8"), blocks=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
  return blocks.map((m,index)=>({index,text:[...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x=>xmlDecode(x[1])).join("").trim()})).filter(x=>x.text);
}
function patchDocx(buf,updates){
  const zip=new AdmZip(buf),entry=zip.getEntry("word/document.xml");if(!entry)throw new Error("DOCX sem word/document.xml.");
  const xml=entry.getData().toString("utf8");
  const map=new Map((updates||[]).map(u=>[Number(u.paragraph_index),String(u.new_text||"")]));let idx=-1;
  const patched=xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{
    idx++;if(!map.has(idx))return p;
    const replacement=map.get(idx);let first=true,found=false;
    const out=p.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,(all,a,b,c)=>{found=true;if(first){first=false;return a+xmlEncode(replacement)+c}return a+c});
    if(!found)throw new Error(`Parágrafo ${idx} não possui trecho de texto editável no OOXML.`);
    return out;
  });
  zip.updateFile("word/document.xml",Buffer.from(patched,"utf8"));return zip.toBuffer();
}
function normalizedText(s=""){return String(s||"").replace(/\s+/g," ").trim()}
function normalizeUrl(u=""){try{const x=new URL(String(u||"").trim());return /^https?:$/.test(x.protocol)?x.toString():""}catch(_){return ""}}
function referenceTokens(s=""){
  const stop=new Set(["para","com","sem","das","dos","de","da","do","em","um","uma","e","a","o","as","os","ao","aos","à","às","na","no","nas","nos","por","sobre","the","and","for","of","in","to","on"]);
  return normalizedText(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(x=>x.length>=4&&!stop.has(x));
}
function isGenericReferenceUrl(url=""){
  try{
    const u=new URL(url),path=u.pathname.replace(/\/+$/,""),parts=path.split("/").filter(Boolean);
    const genericLast=new Set(["pt-br","en","home","inicio","index","portal","site"]);
    if(!parts.length)return true;
    if(parts.length===1&&genericLast.has(parts[0].toLowerCase()))return true;
    if(parts.length<=2&&genericLast.has(parts[parts.length-1].toLowerCase()))return true;
    return false;
  }catch(_){return true}
}
function isSpecificBibliographicTitle(title=""){
  const t=normalizedText(title);if(t.length<18)return false;
  const generic=/^(?:ANVISA|Minist[eé]rio da Sa[uú]de|Sociedade Brasileira de Pediatria|SBP|COFEN|COREN|OMS|WHO|CDC)\s*$/i;
  return !generic.test(t);
}
function wordReferenceEligibility(ref){
  const title=String(ref?.title||"").trim(),url=normalizeUrl(ref?.url||"");
  if(!isSpecificBibliographicTitle(title))return {eligible:false,reason:"Título insuficiente para identificar uma publicação técnica específica."};
  if(!url)return {eligible:false,reason:"URL ausente ou inválida; a fonte fica somente na auditoria da SIASH."};
  if(isGenericReferenceUrl(url))return {eligible:false,reason:"Página institucional genérica não é referência bibliográfica e não será inserida no Word."};
  return {eligible:true,reason:"Fonte possui título bibliográfico identificável e endereço específico."};
}
function sourceMatchesChangeReference(ref,source){
  const n=normalizedText(ref).toLowerCase();if(!n)return false;
  const title=normalizedText(source?.title||"").toLowerCase(),url=normalizedText(source?.url||"").toLowerCase();
  return !!((title&&(title===n||title.includes(n)||n.includes(title)))||(url&&(url===n||url.includes(n)||n.includes(url))));
}
function sourceTitleMatches(title,url,htmlTitle="",bodySample=""){
  const tokens=[...new Set(referenceTokens(title))];if(!tokens.length)return false;
  const hay=normalizedText(`${url} ${htmlTitle} ${bodySample}`).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const hits=tokens.filter(t=>hay.includes(t)).length;
  return hits>=Math.min(2,tokens.length);
}
async function classifyReferenceUrls(refs){
  const verified=[],pending=[];
  for(const r of refs||[]){
    const title=String(r?.title||"").trim(),raw=String(r?.url||"").trim(),url=normalizeUrl(raw);
    if(!title)continue;
    if(!url){pending.push({title,url:raw,status:"pending",reason:"URL ausente ou inválida; requer conferência profissional."});continue;}
    if(isGenericReferenceUrl(url)){pending.push({title,url,status:"pending",reason:"O endereço aponta para uma página institucional genérica, não para a publicação citada; requer conferência profissional."});continue;}
    try{
      const c=new AbortController(),t=setTimeout(()=>c.abort(),9000);
      const resp=await fetch(url,{method:"GET",redirect:"follow",signal:c.signal,headers:{"User-Agent":"SIASH-Docs/0.13.6 reference-check","Accept":"text/html,application/pdf;q=0.9,*/*;q=0.5"}});clearTimeout(t);
      if(!resp.ok){pending.push({title,url,status:"pending",reason:`Fonte respondeu HTTP ${resp.status}; requer conferência profissional.`});continue;}
      const finalUrl=resp.url||url,ct=String(resp.headers.get("content-type")||"").toLowerCase();
      if(isGenericReferenceUrl(finalUrl)){pending.push({title,url:finalUrl,status:"pending",reason:"O redirecionamento terminou em página institucional genérica; a publicação específica não foi confirmada."});continue;}
      let evidence="",htmlTitle="";
      if(ct.includes("text/html")){
        const txt=(await resp.text()).slice(0,250000);htmlTitle=((txt.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"").replace(/<[^>]+>/g," ");evidence=txt.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").slice(0,120000);
      }else if(ct.includes("application/pdf")||/\.pdf(?:$|[?#])/i.test(finalUrl)){
        evidence=decodeURIComponent(finalUrl);
      }else evidence=decodeURIComponent(finalUrl);
      if(sourceTitleMatches(title,finalUrl,htmlTitle,evidence))verified.push({title,url:finalUrl,status:"verified",reason:"Publicação específica acessível e título/endereço compatíveis com a referência informada."});
      else pending.push({title,url:finalUrl,status:"pending",reason:"O endereço respondeu, mas a SIASH não confirmou correspondência suficiente entre a publicação acessada e o título citado."});
    }catch(_){pending.push({title,url,status:"pending",reason:"Não foi possível confirmar eletronicamente a publicação específica; requer conferência profissional."});}
  }
  const decorate=x=>{const e=wordReferenceEligibility(x);return {...x,wordEligible:e.eligible,wordEligibilityReason:e.reason}};
  const dedup=a=>[...new Map(a.map(x=>[(x.url||x.title).toLowerCase(),x])).values()].map(decorate);
  return {verified:dedup(verified),pending:dedup(pending)};
}
function isReferenceHeading(text=""){
  const t = normalizedText(text)
    .replace(/\u00a0/g," ")
    .replace(/^[\s\u2022\u25CF\u25AA\u25E6\-–—]+/,"")
    .replace(/\s+/g," ")
    .trim();

  return /^(?:\d{1,2}(?:\.\d{1,2})?\s*[-–—.)]?\s*)?(?:refer[eê]ncias?(?:\s+bibliogr[aá]ficas?)?|bibliografia)\s*:?\s*$/i.test(t);
}

function referenceSectionInfo(paragraphs){
  const headings = paragraphs.filter(p=>isReferenceHeading(p.text));
  if(headings.length !== 1) return null;
  const heading = headings[0];
  const after=paragraphs.filter(p=>p.index>heading.index);
  const stop=after.find(p=>/^\s*(assinatura(?:\s+e\s+carimbo)?|carimbo|anexo(?:s)?|controle\s+hist[oó]rico)\s*:?\s*$/i.test(normalizedText(p.text)));
  const sectionParas=paragraphs.filter(p=>p.index>heading.index&&(!stop||p.index<stop.index));
  return {headingIndex:heading.index,stopIndex:stop?stop.index:null,lastSectionIndex:sectionParas.length?sectionParas[sectionParas.length-1].index:heading.index};
}
function isManagedReferenceText(text=""){
  return /\[(?:FONTE ELETRONICAMENTE VERIFICADA|REQUER CONFERÊNCIA PROFISSIONAL)\]/i.test(normalizedText(text));
}
function paragraphTextFromXml(p=""){
  return [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x=>xmlDecode(x[1])).join("").trim();
}
function extractManagedReferenceTexts(text=""){
  const t=normalizedText(text);if(!isManagedReferenceText(t))return [];
  const parts=t.split(/(?=\[(?:FONTE ELETRONICAMENTE VERIFICADA|REQUER CONFERÊNCIA PROFISSIONAL)\])/i)
    .map(x=>x.replace(/^Refer[eê]ncias?\s+incorporadas?\s+na\s+revis[aã]o\s*:\s*(?:\d+\.\s*)?/i,"").replace(/^\s*(?:\|\s*)?(?:\d+\.\s*)?/i,"").replace(/\s*\|\s*\d+\.\s*$/," ").trim())
    .filter(x=>/^\[(?:FONTE ELETRONICAMENTE VERIFICADA|REQUER CONFERÊNCIA PROFISSIONAL)\]/i.test(x));
  return parts.length?parts:[t];
}
function cleanManagedReferenceText(text=""){
  return normalizedText(text)
    .replace(/^Refer[eê]ncias?\s+incorporadas?\s+na\s+revis[aã]o\s*:\s*(?:\d+\.\s*)?/i,"")
    .replace(/^\[(?:FONTE ELETRONICAMENTE VERIFICADA|REQUER CONFERÊNCIA PROFISSIONAL)\]\s*/i,"")
    .replace(/\s+—\s+(?:Classificação anterior rebaixada:|O endereço aponta|O redirecionamento terminou|Fonte respondeu HTTP|Não foi possível confirmar|O endereço respondeu)[\s\S]*$/i,"")
    .trim();
}
function referenceUrlFromText(text=""){
  const m=normalizedText(text).match(/Disponível em:\s*(https?:\/\/\S+)/i);
  return m?normalizeUrl(m[1].replace(/[),.;]+$/,"")):"";
}
function referenceTitleFromText(text=""){
  let t=cleanManagedReferenceText(text).replace(/\s*Disponível em:\s*https?:\/\/\S+[\s\S]*$/i,"").trim();
  return t.replace(/^\s*\d+\s*[.)-]\s*/,"").trim();
}
function referenceVolume(text=""){
  const t=normalizedText(text).toLowerCase();
  let m=t.match(/\b(?:v(?:ol(?:ume)?)?\.?\s*|volume\s*)(\d+)\b/i);if(m)return m[1];
  m=t.match(/(?:[_\/-])v(\d+)(?:[_.\/?#-]|$)/i);return m?m[1]:"";
}
function referenceWords(text=""){
  const stop=new Set(["brasil","ministerio","saude","secretaria","atencao","departamento","acoes","programaticas","estrategicas","brasilia","disponivel","acesso","fonte","requer","conferencia","profissional","edicao","editora"]);
  return new Set(referenceTokens(referenceTitleFromText(text)).filter(x=>!stop.has(x)));
}
function referenceYears(text=""){
  return new Set(
    normalizedText(text).match(/\b(?:19|20)\d{2}\b/g) || []
  );
}

function referenceSimilarity(a,b){
  const va=referenceVolume(a),vb=referenceVolume(b);

  if(va&&vb&&va!==vb)return 0;
  if((va&&!vb||!va&&vb)&&String(va||vb)!=="1")return 0;

  const A=referenceWords(a),B=referenceWords(b);
  if(!A.size||!B.size)return 0;

  let inter=0;
  for(const x of A)if(B.has(x))inter++;

  const union=new Set([...A,...B]).size;
  return union ? inter/union : 0;
}

function sameBibliographicWork(a,b){
  const ua=referenceUrlFromText(a),ub=referenceUrlFromText(b);

  // Mesma URL específica é evidência forte da mesma obra.
  if(ua&&ub&&ua===ub)return true;

  // Anos bibliográficos explicitamente diferentes indicam obras distintas.
  const ya=referenceYears(a),yb=referenceYears(b);
  if(ya.size&&yb.size){
    let sameYear=false;
    for(const y of ya){
      if(yb.has(y)){
        sameYear=true;
        break;
      }
    }
    if(!sameYear)return false;
  }

  return referenceSimilarity(a,b)>=0.80;
}
function referenceKeyFromText(text=""){
  const url=referenceUrlFromText(text);if(url)return url.toLowerCase();
  const vol=referenceVolume(text),words=[...referenceWords(text)].sort().join(" ");return `${words}|v${vol}`;
}
function cleanReferenceForWord(r){
  const title=referenceTitleFromText(r?.title||"");const url=normalizeUrl(r?.url||"");
  return normalizedText(`${title}${url?`. Disponível em: ${url}`:""}`);
}
function appendReviewedReferences(buf,refs,options={}){
  const allowHygieneOnly=options?.allowHygieneOnly===true;
  if(!refs?.length&&!allowHygieneOnly)throw new Error("Nenhuma referência foi retornada para conferência. A proposta foi bloqueada para evitar atualização técnico-científica sem fonte rastreável.");
  const wordRefs=(refs||[]).filter(r=>r?.wordEligible===true);
  if(!wordRefs.length&&!allowHygieneOnly)throw new Error("Nenhuma fonte bibliográfica específica e elegível foi confirmada para o Word. Páginas institucionais genéricas ficam apenas na auditoria da SIASH; a proposta foi bloqueada.");
  const zip=new AdmZip(buf),entry=zip.getEntry("word/document.xml");if(!entry)throw new Error("DOCX sem word/document.xml.");
  const xml=entry.getData().toString("utf8");
  const blocks=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>m[0]);
  const texts=blocks.map(paragraphTextFromXml);
  const headingCandidates=texts.map((text,index)=>({index,text})).filter(p=>isReferenceHeading(p.text));
  if(headingCandidates.length !== 1){
  throw new Error(
    headingCandidates.length === 0
      ? "A seção de Referências não foi localizada de forma inequívoca no Word. A proposta foi bloqueada para preservar a estrutura institucional."
      : "Foram localizadas múltiplas seções possíveis de Referências no Word. A proposta foi bloqueada para preservar a estrutura institucional."
  );
}
const heading = headingCandidates[0];
  const stopRx=/^\s*(assinatura(?:\s+e\s+carimbo)?|carimbo|anexo(?:s)?|controle\s+hist[oó]rico)\s*:?\s*$/i;
  const stopIndex=texts.findIndex((t,i)=>i>heading.index&&stopRx.test(normalizedText(t)));
  const inSection=(i)=>i>heading.index&&(stopIndex<0||i<stopIndex);

  // Referências institucionais já existentes permanecem como fonte primária da bibliografia.
  const genericBibliography=texts.map((text,index)=>({text:normalizedText(text),index})).filter(x=>inSection(x.index)&&x.text&&!!referenceUrlFromText(x.text)&&isGenericReferenceUrl(referenceUrlFromText(x.text)));
  const genericIndexes=new Set(genericBibliography.map(x=>x.index));
  // A proposta limpa referências que apontam apenas para homepages/portais genéricos. O vigente original não é alterado.
  const institutional=texts.map((text,index)=>({text:normalizedText(text),index})).filter(x=>inSection(x.index)&&x.text&&!isManagedReferenceText(x.text)&&!genericIndexes.has(x.index));
  const managedLegacy=blocks.map((xmlBlock,index)=>({xmlBlock,index,text:texts[index]})).filter(x=>isManagedReferenceText(x.text));
  const candidates=[];
  // Legado SIASH é limpo e migrado, mas passa pela MESMA regra de elegibilidade das fontes atuais.
  // Correção v0.13.5: versões antigas podiam guardar, em um único parágrafo fora da bibliografia,
  // uma homepage genérica + uma fonte específica. A v0.13.4 removia o parágrafo original, porém
  // reintroduzia a homepage ao transformar todo legado em candidato sem reclassificá-lo.
  const legacyRejected=[];
  for(const x of managedLegacy)for(const raw of extractManagedReferenceTexts(x.text)){
    const clean=cleanManagedReferenceText(raw);
    if(!clean)continue;
    const legacyRef={title:referenceTitleFromText(clean),url:referenceUrlFromText(clean)};
    const eligibility=wordReferenceEligibility(legacyRef);
    if(!eligibility.eligible){legacyRejected.push({text:clean,reason:eligibility.reason});continue;}
    candidates.push({text:clean,source:"legacy"});
  }
  // Novas fontes entram no Word sem rótulos de auditoria. O status permanece apenas na tela/JSON da SIASH.
  for(const r of wordRefs){const clean=cleanReferenceForWord(r);if(clean)candidates.push({text:clean,source:"current"});}

  const finalManaged=[];
  const representedByInstitutional=[];
  for(const c of candidates){
    const institutionalMatch=institutional.find(x=>sameBibliographicWork(c.text,x.text));
    if(institutionalMatch){representedByInstitutional.push({candidate:c,matched:institutionalMatch.text});continue;}
    const pos=finalManaged.findIndex(x=>sameBibliographicWork(c.text,x.text));
    if(pos>=0){
      // Prefere a variante com URL específica e, em empate, a referência da revisão atual.
      const old=finalManaged[pos],oldUrl=referenceUrlFromText(old.text),newUrl=referenceUrlFromText(c.text);
      if((!oldUrl&&newUrl)||(c.source==="current"&&old.source!=="current"))finalManaged[pos]=c;
    }else finalManaged.push(c);
  }
  const existingNumbers=institutional.map(x=>{const m=x.text.match(/^\s*(\d+)\s*[.)-]/);return m?Number(m[1]):0}).filter(Boolean);
  const numberedStyle=existingNumbers.length>0;let nextNumber=numberedStyle?Math.max(...existingNumbers)+1:0;
  const managedTexts=finalManaged.map(x=>numberedStyle?`${nextNumber++}. ${x.text}`:x.text);
  // Se a bibliografia usa numeração nativa do Word (w:numPr), replica o pPr da última referência institucional.
  // Assim o Word continua automaticamente 3, 4... sem gravar números artificiais no texto.
  const lastInstitutional=institutional.length?institutional[institutional.length-1]:null;
  const lastInstitutionalBlock=lastInstitutional?blocks[lastInstitutional.index]:"";
  const pPrMatch=lastInstitutionalBlock.match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/i);
  const bibliographyPPr=pPrMatch&&/<w:numPr[\s>]/i.test(pPrMatch[0])?pPrMatch[0]:"";
  const managedParagraphs=managedTexts.map(text=>`<w:p>${bibliographyPPr}<w:r><w:t xml:space="preserve">${xmlEncode(text)}</w:t></w:r></w:p>`).join("");

  let rawIndex=-1,inserted=false;
  const patched=xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{
    rawIndex++;const text=paragraphTextFromXml(p);
    if(isManagedReferenceText(text))return ""; // remove todo legado rotulado, em qualquer posição
    if(genericIndexes.has(rawIndex))return ""; // remove homepage genérica da bibliografia somente na proposta
    if(!inserted&&stopIndex>=0&&rawIndex===stopIndex){inserted=true;return managedParagraphs+p;}
    if(!inserted&&stopIndex<0&&rawIndex===blocks.length-1){inserted=true;return p+managedParagraphs;}
    return p;
  });
  if(!inserted)throw new Error("Não foi possível posicionar as referências dentro da seção bibliográfica do Word.");
  zip.updateFile("word/document.xml",Buffer.from(patched,"utf8"));
  // Se a bibliografia usa números gravados como texto, renumera sequencialmente após remover fontes genéricas.
  // Isso evita lacunas como 1, 2, 4 quando uma referência imprópria (ex.: homepage) é retirada da proposta.
  let normalizedXml=zip.getEntry("word/document.xml").getData().toString("utf8");
  const normBlocks=[...normalizedXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>m[0]);
  const normTexts=normBlocks.map(paragraphTextFromXml);
  const normHeadings=normTexts.map((text,index)=>({text,index})).filter(x=>isReferenceHeading(x.text));
  const normHeading=normHeadings[normHeadings.length-1];
  if(normHeading){
    const normStop=normTexts.findIndex((t,i)=>i>normHeading.index&&stopRx.test(normalizedText(t)));
    const refIndexes=normTexts.map((t,i)=>({t,i})).filter(x=>x.i>normHeading.index&&(normStop<0||x.i<normStop)&&/^\s*\d+\s*[.)-]\s*/.test(x.t)).map(x=>x.i);
    if(refIndexes.length>=2){
      const numberMap=new Map(refIndexes.map((idx,pos)=>[idx,pos+1]));let nidx=-1;
      normalizedXml=normalizedXml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{
        nidx++;if(!numberMap.has(nidx))return p;const n=numberMap.get(nidx);let changed=false;
        return p.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,(all,a,b,c)=>{if(changed)return all;const decoded=xmlDecode(b);if(!/^\s*\d+\s*[.)-]\s*/.test(decoded))return all;changed=true;const replaced=decoded.replace(/^\s*\d+\s*[.)-]\s*/,`${n}. `);return a+xmlEncode(replaced)+c});
      });
      zip.updateFile("word/document.xml",Buffer.from(normalizedXml,"utf8"));
    }
  }
  const out=zip.toBuffer(),outParas=docxParagraphs(out),outSec=referenceSectionInfo(outParas);
  if(!outSec)throw new Error("Falha de integridade: a seção bibliográfica deixou de ser identificável após a normalização.");
  const outTexts=outParas.map(p=>p.text);
  if(outTexts.some(isManagedReferenceText))throw new Error("Falha de integridade: rótulo interno de auditoria permaneceu no Word institucional.");
  const insertedParas=outParas.filter(p=>p.index>outSec.headingIndex&&(outSec.stopIndex==null||p.index<outSec.stopIndex));
  for(const text of managedTexts){if(!insertedParas.some(p=>sameBibliographicWork(text,p.text)))throw new Error("Falha de integridade: referência limpa não foi localizada dentro da seção bibliográfica.");}
  // Auditoria final de duplicidade semântica dentro da bibliografia.
  const bib=insertedParas.map(p=>p.text).filter(Boolean);
  for(let i=0;i<bib.length;i++)for(let j=i+1;j<bib.length;j++)if(sameBibliographicWork(bib[i],bib[j]))throw new Error("Falha de integridade: foram detectadas referências bibliográficas semanticamente duplicadas no Word.");
  // Cada fonte da revisão precisa estar representada na bibliografia, mas não necessariamente com a mesma URL:
  // quando a obra já existe institucionalmente, a deduplicação semântica é intencional e a referência existente é suficiente.
  const cleanInputRefs=wordRefs.map(r=>cleanReferenceForWord(r)).filter(Boolean);
  const finalBibTexts=insertedParas.map(p=>normalizedText(p.text)).filter(Boolean);
  const coverage=cleanInputRefs.map(refText=>{
    const match=finalBibTexts.find(b=>sameBibliographicWork(refText,b));
    return {reference:refText,represented:!!match,matched:match||""};
  });
  const uncovered=coverage.filter(x=>!x.represented);
  if(uncovered.length)throw new Error("Falha de integridade: uma ou mais fontes da revisão não ficaram representadas na seção bibliográfica do Word.");
  const genericRemaining=insertedParas.filter(p=>!!referenceUrlFromText(p.text)&&isGenericReferenceUrl(referenceUrlFromText(p.text)));
  if(genericRemaining.length)throw new Error("Falha de integridade: referência com URL institucional genérica permaneceu na bibliografia do Word.");
  return {buffer:out,added:managedTexts.length,moved:managedLegacy.filter(x=>!inSection(x.index)).length,sectionHeadingIndex:outSec.headingIndex,labelsRemoved:managedLegacy.length,coverage,representedByInstitutional:representedByInstitutional.length,genericReferencesRemoved:genericBibliography.length+legacyRejected.length,legacyGenericReferencesRejected:legacyRejected.length,wordEligibleReferences:wordRefs.length};
}
function bibliographyHygieneState(buf){
  try{
    const paras=docxParagraphs(buf),sec=referenceSectionInfo(paras);if(!sec)return {needsHygiene:false,generic:0,managed:0};
    const generic=paras.filter(p=>p.index>sec.headingIndex&&(sec.stopIndex==null||p.index<sec.stopIndex)&&!!referenceUrlFromText(p.text)&&isGenericReferenceUrl(referenceUrlFromText(p.text))).length;
    const managed=paras.filter(p=>isManagedReferenceText(p.text)).length;
    return {needsHygiene:(generic+managed)>0,generic,managed};
  }catch{return {needsHygiene:false,generic:0,managed:0}}
}
function effectiveAIUpdates(paragraphs,updates,allowed){
  const originalByIndex=new Map(paragraphs.map(p=>[Number(p.index),String(p.text||"")]));
  const dedup=new Map();
  for(const u of updates||[]){
    const index=Number(u?.paragraph_index),newText=String(u?.new_text||"").trim();
    if(!allowed.has(index)||!newText)continue;
    const before=originalByIndex.get(index);if(before==null)continue;
    if(normalizedText(before)===normalizedText(newText))continue;
    dedup.set(index,{paragraph_index:index,before_text:before,new_text:newText,reason:String(u?.reason||"").trim(),references:Array.isArray(u?.references)?u.references.map(String).filter(Boolean):[]});
  }
  return [...dedup.values()];
}
function verifyDocxRevision(original,revised,effective){
  if(!effective.length)throw new Error("A IA não produziu nenhuma alteração real no conteúdo do Word. A proposta foi bloqueada para evitar uma falsa revisão.");
  if(Buffer.compare(original,revised)===0)throw new Error("O arquivo revisado ficou idêntico ao Word vigente. A proposta foi bloqueada.");
  const after=new Map(docxParagraphs(revised).map(p=>[Number(p.index),String(p.text||"")]));
  const failures=[];
  for(const u of effective){
    const got=after.get(Number(u.paragraph_index));
    if(normalizedText(got)!==normalizedText(u.new_text))failures.push(Number(u.paragraph_index));
  }
  if(failures.length)throw new Error(`Falha de integridade ao gravar as alterações no Word (parágrafos: ${failures.join(", ")}). A proposta não foi liberada.`);
  return {verified:true,actualChanges:effective.length,checkedParagraphs:effective.length,documentChanged:true};
}
function collectOpenAISources(response){
  const urls=new Map();for(const item of response.output||[]){if(item.type==="web_search_call"){for(const s of item.action?.sources||[]){if(s?.url)urls.set(s.url,s.title||s.url)}}}
  return [...urls].map(([url,title])=>({title,url}));
}
function modelJsonCandidates(text=""){
  const raw=String(text||"").trim();
  if(!raw)return [];
  const out=[],seen=new Set(),add=value=>{const v=String(value||"").trim();if(v&&!seen.has(v)){seen.add(v);out.push(v)}};
  add(raw);
  add(raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim());
  for(const m of raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi))add(m[1]);
  for(let start=0;start<raw.length;start++){
    if(raw[start]!=="{")continue;
    let depth=0,inString=false,escaped=false;
    for(let i=start;i<raw.length;i++){
      const ch=raw[i];
      if(inString){
        if(escaped)escaped=false;
        else if(ch==="\\")escaped=true;
        else if(ch==='"')inString=false;
        continue;
      }
      if(ch==='"'){inString=true;continue}
      if(ch==="{")depth++;
      else if(ch==="}"&&--depth===0){add(raw.slice(start,i+1));break}
    }
  }
  return out;
}
function validateModelRevisionJson(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("A resposta da IA não contém um objeto JSON de revisão.");
  const candidate=value.summary!==undefined||value.updates!==undefined||value.references!==undefined
    ? value
    : (value.result&&typeof value.result==="object"&&!Array.isArray(value.result)?value.result:null);
  if(!candidate)throw new Error("A resposta da IA não contém as chaves obrigatórias da revisão.");
  if(!Array.isArray(candidate.updates))throw new Error("A resposta da IA não contém updates válido.");
  if(!Array.isArray(candidate.references))throw new Error("A resposta da IA não contém references válido.");
  // summary é metadado descritivo e não altera o POP. Se o modelo omitir somente esse campo,
  // preservamos as validações clínicas/bibliográficas e geramos um resumo neutro determinístico.
  if(typeof candidate.summary!=="string"||!candidate.summary.trim()){
    if(!candidate.updates.length)throw new Error("A resposta da IA não contém summary válido nem alterações estruturadas.");
    candidate.summary=`Proposta técnico-científica com ${candidate.updates.length} alteração(ões) estruturada(s), sujeita(s) à validação científica e aprovação humana do SIASH.`;
    candidate.summaryNormalized=true;
  }
  for(const u of candidate.updates){
    if(!u||typeof u!=="object"||!Number.isInteger(Number(u.paragraph_index))||typeof u.new_text!=="string"||!u.new_text.trim()||typeof u.reason!=="string"||!Array.isArray(u.references))
      throw new Error("A resposta da IA contém uma alteração fora do esquema seguro.");
  }
  for(const ref of candidate.references){
    if(!ref||typeof ref!=="object"||typeof ref.title!=="string"||typeof ref.url!=="string")
      throw new Error("A resposta da IA contém uma referência fora do esquema seguro.");
  }
  return candidate;
}
function parseModelJson(text=""){
  let lastError=null;
  for(const candidate of modelJsonCandidates(text)){
    try{return validateModelRevisionJson(JSON.parse(candidate))}
    catch(e){lastError=e}
  }
  const err=new Error("A IA retornou uma resposta que não pôde ser interpretada com segurança.");
  err.modelJsonParseFailure=true;
  err.parseReason=String(lastError?.message||"Nenhum objeto JSON válido foi encontrado.").slice(0,240);
  throw err;
}
function geminiGroundingSources(data){
  const chunks=data?.candidates?.[0]?.groundingMetadata?.groundingChunks||[];
  return chunks.map(x=>x?.web?.uri?{title:x.web.title||x.web.uri,url:x.web.uri}:null).filter(Boolean);
}
const GEMINI_REVISION_SCHEMA={
  type:"object",
  properties:{
    summary:{type:"string"},
    updates:{type:"array",items:{type:"object",properties:{paragraph_index:{type:"integer"},new_text:{type:"string"},reason:{type:"string"},references:{type:"array",items:{type:"string"}}},required:["paragraph_index","new_text","reason","references"]}},
    references:{type:"array",items:{type:"object",properties:{title:{type:"string"},url:{type:"string"}},required:["title","url"]}}
  },
  required:["summary","updates","references"]
};
function geminiUseSearch(){return GEMINI_SEARCH_MODE==="on"||GEMINI_SEARCH_MODE==="true"||GEMINI_SEARCH_MODE==="enabled"}
async function reviseWithGemini(prompt){
  if(!GEMINI_API_KEY)throw new Error("GEMINI_API_KEY ainda não configurada no servidor.");
  const useSearch=geminiUseSearch();
  const researchRule=useSearch
    ? "Use a Pesquisa Google integrada para verificar referências oficiais e atuais."
    : "A Pesquisa Google integrada está desativada neste ambiente. Não afirme que pesquisou a web. Use conhecimento técnico do modelo apenas para propor ajustes; inclua referências somente quando tiver alta confiança no título e URL, e trate-as como sugestões que exigem conferência profissional.";
  const strictPrompt=prompt+`\n\nMODO DE PESQUISA: ${researchRule}\nFORMATO DE SAÍDA OBRIGATÓRIO: responda SOMENTE com JSON válido nas chaves summary, updates e references. Não inclua markdown nem comentários fora do JSON.`;
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const payload={contents:[{role:"user",parts:[{text:strictPrompt}]}],generationConfig:{maxOutputTokens:16000,responseMimeType:"application/json",responseSchema:GEMINI_REVISION_SCHEMA}};
  if(useSearch)payload.tools=[{google_search:{}}];
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),GEMINI_TIMEOUT_MS);
  let r;
  try{r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":GEMINI_API_KEY},body:JSON.stringify(payload),signal:controller.signal})}
  catch(e){if(e?.name==="AbortError")throw new Error(`Gemini excedeu o tempo limite de ${Math.round(GEMINI_TIMEOUT_MS/1000)} segundos.`);throw e}
  finally{clearTimeout(timer)}
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    const detail=data?.error?.message||`Gemini retornou HTTP ${r.status}.`;
    if(r.status===429)throw new Error(`Gemini atingiu o limite/quota deste projeto. ${detail}`);
    if(r.status===503)throw new Error(`Gemini está temporariamente indisponível. ${detail}`);
    throw new Error(detail);
  }
  const text=(data?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||"").join("").trim();
  if(!text)throw new Error("Gemini não retornou conteúdo utilizável.");
  const result=parseModelJson(text);
  return {result,sources:useSearch?geminiGroundingSources(data):[],model:GEMINI_MODEL,provider:"gemini",researchMode:useSearch?"google_search":"model_knowledge"};
}
async function cloudflareRequest(model,messages,{maxTokens=CLOUDFLARE_MAX_COMPLETION_TOKENS,temperature=0.1}={}){
  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID)}/ai/run/${model}`;
  const revisionSchema={
    type:"object",
    additionalProperties:false,
    properties:{
      summary:{type:"string"},
      updates:{type:"array",items:{type:"object",additionalProperties:false,properties:{
        paragraph_index:{type:"integer"},new_text:{type:"string"},reason:{type:"string"},
        references:{type:"array",minItems:1,items:{type:"string",pattern:"^FONTE_[1-9][0-9]*$"}}
      },required:["paragraph_index","new_text","reason","references"]}},
      references:{type:"array",items:{type:"object",additionalProperties:false,properties:{
        title:{type:"string"},url:{type:"string"}
      },required:["title","url"]}}
    },
    required:["summary","updates","references"]
  };
  const payload={
    messages,
    max_completion_tokens:maxTokens,
    temperature,
    response_format:{type:"json_schema",json_schema:revisionSchema},
    chat_template_kwargs:{enable_thinking:false}
  };
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),CLOUDFLARE_TIMEOUT_MS);
  let r;
  try{r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${CLOUDFLARE_API_TOKEN}`},body:JSON.stringify(payload),signal:controller.signal})}
  catch(e){if(e?.name==="AbortError")throw new Error(`Cloudflare Workers AI excedeu o tempo limite de ${Math.round(CLOUDFLARE_TIMEOUT_MS/1000)} segundos.`);throw e}
  finally{clearTimeout(timer)}
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data?.success===false){
    const detail=(data?.errors||[]).map(x=>x?.message).filter(Boolean).join("; ")||data?.error?.message||`Cloudflare retornou HTTP ${r.status}.`;
    const err=new Error(detail);err.httpStatus=r.status;err.cloudflareErrors=data?.errors||[];err.model=model;throw err;
  }
  const text=extractCloudflareText(data);
  if(!text.trim()){
    const resultShape=data?.result&&typeof data.result==="object"?Object.keys(data.result).slice(0,12).join(",") : typeof data?.result;
    console.warn(`[SIASH AI] Cloudflare resposta sem texto | model=${model} | result_shape=${resultShape||"ausente"}`);
    const err=new Error("Cloudflare Workers AI não retornou conteúdo utilizável.");
    err.cloudflareEmptyContent=true;err.model=model;throw err;
  }
  return text;
}
function cloudflareRepairPrompt(originalPrompt,invalidText,parseReason){
  const safeInvalid=String(invalidText||"").slice(0,12000);
  return [
    "Sua resposta anterior não passou na validação estrutural do SIASH.",
    `MOTIVO DA VALIDAÇÃO: ${String(parseReason||"estrutura JSON inválida").slice(0,300)}`,
    "CORRIJA SOMENTE A ESTRUTURA E COMPLETE OS CAMPOS OBRIGATÓRIOS SEM INVENTAR fatos, fontes, URLs ou recomendações.",
    "Use exclusivamente as evidências e regras contidas no pedido original abaixo.",
    "A saída deve ser APENAS um objeto JSON válido com exatamente estas chaves de nível superior: summary, updates, references.",
    'updates deve ser array de objetos com paragraph_index (inteiro), new_text (texto), reason (texto) e references (array de identificadores exatos FONTE_N fornecidos no pedido original).',
    'references deve ser array de objetos com title e url. Em cada update, use somente identificadores FONTE_N existentes no pedido original. Se uma alteração não puder ser sustentada por eles, não a invente e explique a limitação em summary.',
    "PEDIDO ORIGINAL:",
    originalPrompt,
    "RESPOSTA ANTERIOR PARA REPARO:",
    safeInvalid
  ].join("\n\n");
}
async function cloudflareRunModel(model,prompt){
  const strictPrompt=prompt+`\n\nFORMATO DE SAÍDA OBRIGATÓRIO: responda SOMENTE com JSON válido nas chaves summary, updates e references. Não inclua markdown nem comentários fora do JSON. Em references, forneça título e URL específica do documento quando souber com segurança; nunca invente URL.`;
  const system={role:"system",content:"Você é um revisor técnico-científico hospitalar. Obedeça estritamente às regras do usuário e retorne apenas JSON válido."};
  const text=await cloudflareRequest(model,[system,{role:"user",content:strictPrompt}]);
  try{
    return {result:parseModelJson(text),sources:[],model,provider:"cloudflare",researchMode:"model_knowledge"};
  }catch(e){
    if(!e?.modelJsonParseFailure)throw e;
    console.warn(`[SIASH AI] Cloudflare resposta exige reparo estrutural | model=${model} | parse=${e.parseReason||"não informado"}`);
    const repairPrompt=cloudflareRepairPrompt(prompt,text,e.parseReason);
    const repairedText=await cloudflareRequest(model,[
      {role:"system",content:"Você corrige exclusivamente a estrutura JSON de uma proposta técnico-científica. Não acrescente fatos nem fontes ausentes das evidências fornecidas. Retorne apenas JSON válido."},
      {role:"user",content:repairPrompt}
    ],{temperature:0});
    let result;
    try{result=parseModelJson(repairedText)}
    catch(repairError){
      console.warn(`[SIASH AI] Cloudflare reparo estrutural falhou | model=${model} | parse=${repairError?.parseReason||repairError?.message||"não informado"}`);
      throw repairError;
    }
    console.log(`[SIASH AI] Cloudflare reparo estrutural concluído | model=${model} | summary_normalized=${result?.summaryNormalized===true}`);
    return {result,sources:[],model,provider:"cloudflare",researchMode:"model_knowledge",structuralRepair:true};
  }
}
function cloudflareContentToText(value){
  if(typeof value==="string")return value.trim();
  if(Array.isArray(value))return value.map(item=>{
    if(typeof item==="string")return item;
    if(item&&typeof item==="object")return item.text??item.content??item.value??"";
    return "";
  }).map(String).join("").trim();
  if(value&&typeof value==="object")return JSON.stringify(value);
  return "";
}
function extractCloudflareText(data){
  const r=data?.result;
  const candidates=[
    r?.response, r?.output_text, r?.text,
    r?.choices?.[0]?.message?.content, r?.choices?.[0]?.text,
    r?.output?.[0]?.content?.[0]?.text, r?.output?.[0]?.content,
    data?.choices?.[0]?.message?.content, data?.choices?.[0]?.text,
    data?.response, data?.output_text
  ];
  for(const value of candidates){
    const text=cloudflareContentToText(value);
    if(text)return text;
  }
  // Último recurso seguro: alguns modelos retornam o objeto estruturado diretamente em result.
  if(r&&typeof r==="object"&&!Array.isArray(r)){
    const direct=(Object.hasOwn(r,"updates")&&Object.hasOwn(r,"references"))?r:null;
    if(direct)return JSON.stringify(direct);
  }
  return "";
}
function cloudflareModelCandidates(){
  const configured=String(CLOUDFLARE_AI_MODEL||"").trim();
  const ordered=CLOUDFLARE_KNOWN_PAID_MODELS.has(configured)
    ? [...CLOUDFLARE_FREE_MODEL_FALLBACKS]
    : [configured,...CLOUDFLARE_FREE_MODEL_FALLBACKS];
  return [...new Set(ordered.filter(Boolean))];
}
function cloudflareModelRetryable(e){
  const msg=String(e?.message||"").toLowerCase();
  return e?.httpStatus===403||e?.httpStatus===404||e?.httpStatus===429||e?.cloudflareEmptyContent===true||e?.modelJsonParseFailure===true||msg.includes("tempo limite")||msg.includes("workers free plan")||msg.includes("not available")||msg.includes("out of capacity")||msg.includes("5035")||msg.includes("3040")||msg.includes("não retornou conteúdo utilizável");
}
async function reviseWithCloudflare(prompt){
  if(!CLOUDFLARE_API_TOKEN||!CLOUDFLARE_ACCOUNT_ID)throw new Error("Cloudflare Workers AI ainda não configurada no servidor.");
  const errors=[];
  for(const model of cloudflareModelCandidates()){
    try{
      console.log(`[SIASH AI] Cloudflare tentativa | model=${model} | timeout=${Math.round(CLOUDFLARE_TIMEOUT_MS/1000)}s | max_tokens=${CLOUDFLARE_MAX_COMPLETION_TOKENS} | reasoning=${CLOUDFLARE_REASONING_EFFORT}`);
      const ai=await cloudflareRunModel(model,prompt);
      if(model!==CLOUDFLARE_AI_MODEL)console.log(`[SIASH AI] Cloudflare fallback de modelo concluído | configured=${CLOUDFLARE_AI_MODEL} | active=${model}`);
      return ai;
    }catch(e){
      const msg=String(e?.message||"falha").replace(/\s+/g," ").slice(0,500);
      errors.push(`${model}: ${msg}`);
      console.warn(`[SIASH AI] Cloudflare modelo indisponível | model=${model} | motivo=${msg}${e?.parseReason?` | parse=${e.parseReason}`:""}`);
      if(!cloudflareModelRetryable(e))break;
    }
  }
  throw new Error(`Cloudflare Workers AI indisponível nos modelos testados. ${errors.join(" | ")}`);
}
async function reviseWithOpenAI(prompt){
  if(!openaiClient)throw new Error("OPENAI_API_KEY ainda não configurada no servidor.");
  const response=await openaiClient.responses.create({model:OPENAI_MODEL,tools:[{type:"web_search"}],input:prompt,text:{format:{type:"json_schema",name:"siash_pop_revision",strict:true,schema:{type:"object",additionalProperties:false,properties:{summary:{type:"string"},updates:{type:"array",items:{type:"object",additionalProperties:false,properties:{paragraph_index:{type:"integer"},new_text:{type:"string"},reason:{type:"string"},references:{type:"array",items:{type:"string"}}},required:["paragraph_index","new_text","reason","references"]}},references:{type:"array",items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},url:{type:"string"}},required:["title","url"]}}},required:["summary","updates","references"]}}}});
  return {result:JSON.parse(response.output_text||"{}"),sources:collectOpenAISources(response),model:OPENAI_MODEL,provider:"openai",researchMode:"web_search"};
}
function cloudflareConfigured(){return !!(CLOUDFLARE_API_TOKEN&&CLOUDFLARE_ACCOUNT_ID)}
function availableAIProviders(){const cfCandidates=cloudflareModelCandidates(),cfEffective=cfCandidates[0]||CLOUDFLARE_AI_MODEL;return {gemini:{configured:!!GEMINI_API_KEY,model:GEMINI_MODEL,searchMode:geminiUseSearch()?"google_search":"off"},cloudflare:{configured:cloudflareConfigured(),model:cfEffective,configuredModel:CLOUDFLARE_AI_MODEL,configuredModelIgnored:!!CLOUDFLARE_AI_MODEL&&cfEffective!==CLOUDFLARE_AI_MODEL,freeModelFallbacks:CLOUDFLARE_FREE_MODEL_FALLBACKS,searchMode:"off"},openai:{configured:!!openaiClient,model:OPENAI_MODEL}}}
function providerOrder(requested){
  const p=String(requested||AI_DEFAULT_PROVIDER||"auto").toLowerCase();
  if(p==="gemini")return ["gemini","cloudflare","openai"];
  if(p==="cloudflare")return ["cloudflare","gemini","openai"];
  if(p==="openai")return ["openai","cloudflare","gemini"];
  return ["gemini","cloudflare","openai"];
}

// v0.14.33 — governança científica das fontes: prioriza fontes primárias/oficiais e rejeita redes sociais.
const SCIENTIFIC_PREFERRED_DOMAINS=[
  "gov.br","anvisa.gov.br","saude.gov.br","fiocruz.br",
  "who.int","paho.org","opas.org.br",
  "cofen.gov.br","coren-mg.gov.br","coren-sp.gov.br","coren-rj.gov.br",
  "sbp.com.br"
];
const SCIENTIFIC_BLOCKED_DOMAINS=[
  "instagram.com","facebook.com","tiktok.com","x.com","twitter.com",
  "youtube.com","youtu.be","linkedin.com","pinterest.com",
  "medium.com","blogspot.com","wordpress.com"
];
function sourceHostname(raw=""){try{return new URL(String(raw)).hostname.toLowerCase().replace(/^www\./,"")}catch(_){return ""}}
function domainMatches(host,domain){return host===domain||host.endsWith("."+domain)}
function scientificSourceTier(raw=""){
  const host=sourceHostname(raw);
  if(!host)return 0;
  if(SCIENTIFIC_BLOCKED_DOMAINS.some(d=>domainMatches(host,d)))return -1;
  if(SCIENTIFIC_PREFERRED_DOMAINS.some(d=>domainMatches(host,d)))return 3;
  if(/(?:^|\.)gov\.[a-z.]+$/.test(host)||/(?:^|\.)edu\.[a-z.]+$/.test(host))return 2;
  return 1;
}
function rankScientificSources(results=[]){
  return results
    .filter(r=>r&&/^https?:\/\//i.test(String(r.url||""))&&String(r.content||"").trim())
    .map((r,originalIndex)=>({...r,_tier:scientificSourceTier(r.url),_originalIndex:originalIndex}))
    .filter(r=>r._tier>=0)
    .sort((a,b)=>b._tier-a._tier||a._originalIndex-b._originalIndex);
}
async function tavilySearchRequest(query,extra={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch("https://api.tavily.com/search",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${TAVILY_API_KEY}`},
      body:JSON.stringify({query,search_depth:"basic",topic:"general",max_results:10,include_answer:false,include_raw_content:false,...extra}),
      signal:controller.signal
    });
    if(!response.ok){const detail=await response.text().catch(()=> "");throw new Error(`Tavily indisponível (${response.status}). ${detail.slice(0,200)}`)}
    return await response.json();
  }finally{clearTimeout(timer)}
}
async function researchWithTavily(prompt,queryOverride=""){
  if(!TAVILY_API_KEY)throw new Error("TAVILY_API_KEY não configurada no servidor.");
  const query=String(queryOverride||prompt||"").replace(/\s+/g," ").trim().slice(0,400);
  if(!query)throw new Error("Não foi possível montar a consulta científica para o Tavily.");

  const first=await tavilySearchRequest(query);
  let ranked=rankScientificSources(Array.isArray(first.results)?first.results:[]);
  let official=ranked.filter(r=>r._tier>=2);

  // Se a busca geral não trouxer base oficial suficiente, faz uma segunda busca restrita
  // às instituições técnico-científicas preferenciais, sem aceitar redes sociais como fallback.
  if(official.length<2){
    const second=await tavilySearchRequest(query,{include_domains:SCIENTIFIC_PREFERRED_DOMAINS});
    const merged=[...ranked,...rankScientificSources(Array.isArray(second.results)?second.results:[])];
    const seen=new Set();
    ranked=merged.filter(r=>{const u=normalizeUrl(r.url);if(!u||seen.has(u))return false;seen.add(u);return true})
      .sort((a,b)=>b._tier-a._tier||a._originalIndex-b._originalIndex);
    official=ranked.filter(r=>r._tier>=2);
  }

  // Para POP assistencial, fontes oficiais/primárias formam a base. Fontes secundárias
  // só complementam quando já existem ao menos duas fontes oficiais verificáveis.
  if(official.length<2)throw new Error("Pesquisa científica bloqueada: não foram localizadas pelo menos 2 fontes oficiais/primárias verificáveis.");
  const selected=[...official,...ranked.filter(r=>r._tier===1)].slice(0,5);
  const sources=selected.map((r,i)=>({
    sourceId:`FONTE_${i+1}`,
    title:String(r.title||"Fonte web").trim(),
    url:String(r.url||"").trim(),
    content:String(r.content||"").trim(),
    sourceTier:r._tier
  }));

  const evidence=sources.map(s=>`[${s.sourceId}]\nTítulo: ${s.title}\nURL: ${s.url}\nConteúdo: ${s.content}`).join("\n\n");
  console.log(`[SIASH AI] pesquisa Tavily concluída | fontes=${sources.length} | oficiais=${official.length} | política=scientific_source_governance_v1`);
  return {sources,evidence,researchMode:"tavily_search"};
}
async function runAIRevision(prompt,requested,options={}){
  const errors=[];
  const order=providerOrder(requested);
  const requireWebResearch=options?.requireWebResearch===true;
  const simulatedUnavailable=new Set(Array.isArray(options?.simulateUnavailable)?options.simulateUnavailable.map(x=>String(x).toLowerCase()):[]);
  const diagnostic=options?.diagnostic===true;
  let webResearch=null;
  let revisionPrompt=prompt;
  if(requireWebResearch&&TAVILY_API_KEY){
    try{
      webResearch=await researchWithTavily(prompt,options?.researchQuery||"");
      revisionPrompt=[
        prompt,
        "",
        "PESQUISA WEB ATUAL E VERIFICÁVEL FORNECIDA PELO TAVILY:",
        webResearch.evidence,
        "",
        "REGRA DE EVIDÊNCIA: use somente as fontes acima para sustentar afirmações que dependam de pesquisa web atual. Não invente fontes, títulos, normas, datas ou URLs.",
        "REGRA DE VÍNCULO OBRIGATÓRIO: cada alteração em updates DEVE ter references com pelo menos um identificador exato FONTE_1, FONTE_2, etc. correspondente às evidências acima. Não use referência vazia, abreviada ou criada pelo modelo. O SIASH resolverá esses identificadores para título e URL verificados da Tavily.",
        "REGRA DE AUDITORIA: quando houver AUDITORIA CIENTÍFICA SIASH com REVISÃO NECESSÁRIA, confronte cada achado com as evidências Tavily e com os PARÁGRAFOS EDITÁVEIS. Para todo achado que possua suporte nas fontes, gere alteração técnico-científica rastreável no paragraph_index correspondente e cite o identificador FONTE_N específico. Se algum achado não puder ser corrigido com as fontes retornadas, declare explicitamente no summary qual achado ficou sem suporte; nunca substitua isso por simples renovação de vigência."
      ].join("\n");
      console.log(`[SIASH AI] Tavily habilitou pesquisa web verificável | fontes=${webResearch.sources.length}`);
    }catch(e){
      const msg=String(e?.message||"falha").replace(/\s+/g," ").slice(0,500);
      errors.push(`tavily: ${msg}`);
      console.warn(`[SIASH AI] Tavily indisponível | motivo=${msg}`);
    }
  }
  console.log(`[SIASH AI] início da revisão | ordem=${order.join(">")}`);
  for(const p of order){
    try{
      if(requireWebResearch){
        const webCapable=!!webResearch||(p==="openai"&&!!openaiClient)||(p==="gemini"&&!!GEMINI_API_KEY&&geminiUseSearch());
        if(!webCapable){errors.push(`${p}: pesquisa web atual indisponível`);console.log(`[SIASH AI] provedor ignorado | provider=${p} | motivo=pesquisa_web_obrigatoria`);continue}
      }
      let ai=null;
      if(simulatedUnavailable.has(p)){
        const simulated=new Error(`${p} indisponível por simulação diagnóstica controlada.`);
        simulated.code="SIASH_DIAGNOSTIC_SIMULATION";
        throw simulated;
      }
      if(p==="gemini"&&GEMINI_API_KEY)ai=await reviseWithGemini(revisionPrompt);
      else if(p==="cloudflare"&&cloudflareConfigured())ai=await reviseWithCloudflare(revisionPrompt);
      else if(p==="openai"&&openaiClient)ai=await reviseWithOpenAI(revisionPrompt);
      else {errors.push(`${p}: não configurado`);console.log(`[SIASH AI] provedor ignorado | provider=${p} | motivo=não_configurado`);continue}
      if(webResearch){
        const tavilyById=new Map((webResearch.sources||[]).map(s=>[String(s.sourceId||"").toUpperCase(),s]));
        if(ai?.result&&Array.isArray(ai.result.updates)){
          const usedSourceUrls=new Set();
          ai.result.updates=ai.result.updates.map(update=>({
            ...update,
            references:(Array.isArray(update.references)?update.references:[]).map(ref=>{
              const raw=String(ref||"").trim();
              const exact=raw.toUpperCase().match(/^FONTE_(\d+)$/);
              const src=exact?tavilyById.get(`FONTE_${exact[1]}`):null;
              if(src){usedSourceUrls.add(src.url);return src.url}
              return raw;
            }).filter(Boolean)
          }));
          ai.result.references=(webResearch.sources||[])
            .filter(src=>usedSourceUrls.has(src.url))
            .map(src=>({title:src.title,url:src.url}));
        }
        const merged=[...(webResearch.sources||[]),...(Array.isArray(ai.sources)?ai.sources:[])];
        ai.sources=[...new Map(merged.filter(x=>x&&x.url).map(x=>[String(x.url).trim(),x])).values()];
        ai.researchMode="tavily_search";
      }
      console.log(`[SIASH AI${diagnostic?" TEST":""}] proposta concluída | provider=${ai.provider} | model=${ai.model} | researchMode=${ai.researchMode||"provider_default"}`);
      return ai;
    }catch(e){
      const msg=String(e?.message||"falha").replace(/\s+/g," ").slice(0,500);
      console.warn(`[SIASH AI${diagnostic?" TEST":""}] provedor indisponível | provider=${p} | motivo=${msg}`);
      errors.push(`${p}: ${msg}`);
      const next=order[order.indexOf(p)+1];
      if(next)console.log(`[SIASH AI${diagnostic?" TEST":""}] iniciando fallback | de=${p} | para=${next}`);
    }
  }
  console.error(`[SIASH AI] todos os provedores falharam | ${errors.join(" | ")}`);
  if(requireWebResearch){
    const tavilyOk=!!webResearch;
    const err=new Error(tavilyOk
      ? "A pesquisa web verificável da Tavily foi concluída, porém nenhum modelo de IA disponível conseguiu gerar a proposta dentro dos limites atuais. O POP vigente permanece inalterado."
      : "Esta revisão exige pesquisa web atual, mas a pesquisa verificável não ficou disponível. Verifique Tavily, Gemini com Google Search ou OpenAI com web_search; o POP vigente permanece inalterado.");
    err.code=tavilyOk?"AI_GENERATION_UNAVAILABLE_AFTER_WEB_RESEARCH":"AI_WEB_RESEARCH_REQUIRED";
    throw err
  }
  const err=new Error("Serviço de IA temporariamente indisponível. Nenhuma alteração foi realizada no POP. Tente novamente mais tarde.");
  err.code="AI_PROVIDERS_UNAVAILABLE";
  throw err;
}
app.get("/api/ai/status",auth,(req,res)=>res.json({configured:!!(GEMINI_API_KEY||cloudflareConfigured()||openaiClient),webResearch:{tavilyConfigured:!!TAVILY_API_KEY},defaultProvider:AI_DEFAULT_PROVIDER,providers:availableAIProviders(),privacyNotice:"Não envie dados identificáveis de pacientes aos provedores externos de IA. Toda proposta e referência deve ser conferida pelo profissional antes da publicação."}));

app.post("/api/ai/diagnostic/fallback",auth,async(req,res)=>{
  const startedAt=Date.now();
  try{
    console.log("[SIASH AI TEST] diagnóstico iniciado | cenário=gemini_simulado_indisponível | esperado=cloudflare");
    const diagnosticPrompt=[
      "DIAGNÓSTICO TÉCNICO SIASH. Não há dados de paciente nem documento hospitalar neste teste.",
      "Responda SOMENTE em JSON válido, sem markdown, exatamente com as chaves summary, updates e references.",
      "Use summary como 'SIASH_CLOUDFLARE_DIAGNOSTIC_OK', updates como [] e references como []."
    ].join("\n");
    const ai=await runAIRevision(diagnosticPrompt,"auto",{simulateUnavailable:["gemini"],diagnostic:true});
    const cloudflareOk=ai?.provider==="cloudflare";
    console.log(`[SIASH AI TEST] diagnóstico concluído | ok=${cloudflareOk} | provider=${ai?.provider||"—"} | model=${ai?.model||"—"} | ms=${Date.now()-startedAt}`);
    if(!cloudflareOk)return res.status(502).json({ok:false,expected:"cloudflare",provider:ai?.provider||null,model:ai?.model||null,message:"O fallback respondeu, mas não foi concluído pela Cloudflare Workers AI."});
    res.json({ok:true,scenario:"gemini_simulado_indisponivel",provider:ai.provider,model:ai.model,elapsedMs:Date.now()-startedAt,message:"Teste aprovado: com Gemini simulado como indisponível, a Cloudflare Workers AI assumiu o processamento pelo mesmo fluxo de fallback do SIASH."});
  }catch(e){
    const msg=String(e?.message||"Falha no diagnóstico.").replace(/\s+/g," ").slice(0,500);
    console.error(`[SIASH AI TEST] diagnóstico falhou | motivo=${msg}`);
    res.status(502).json({ok:false,scenario:"gemini_simulado_indisponivel",message:"Teste de fallback não concluído pela Cloudflare Workers AI.",detail:msg});
  }
});

function cleanDuplicateSiashHistoryRows(docxBuffer){
  // v0.13.7: saneia somente duplicatas/intermediárias geradas pelo próprio SIASH no mesmo ciclo.
  // Regra conservadora: preserva a primeira linha SIASH de cada combinação mês/ano + responsáveis
  // e remove apenas linhas SIASH posteriores semanticamente equivalentes no mesmo período.
  // Linhas institucionais humanas/legadas nunca são removidas.
  const zip=new AdmZip(docxBuffer),entry=zip.getEntry("word/document.xml");
  if(!entry)return {buffer:docxBuffer,removed:0};
  let xml=entry.getData().toString("utf8"),removed=0;
  const tblRe=/<w:tbl(?:\s[^>]*)?>[\s\S]*?Controle Hist[óo]rico[\s\S]*?<\/w:tbl>/ig;
  xml=xml.replace(tblRe,table=>{
    const rows=[...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(m=>m[0]);
    const seen=new Set();
    let out=table;
    for(const row of rows){
      const cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(c=>normalizedText([...c[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t=>t[1]).join(" ")));
      if(cells.length<7||!/^\d{1,3}$/.test(cells[0]))continue;
      const elaboracao=cells[4]||"",verificacao=cells[5]||"",aprovacao=cells[6]||"";
      if(!/^SIASH Docs\s*\//i.test(elaboracao))continue;
      const periodo=(cells[1]||"").toLowerCase().replace(/\s+/g,"");
      const key=[periodo,elaboracao.toLowerCase(),verificacao.toLowerCase(),aprovacao.toLowerCase()].join("|");
      if(seen.has(key)){out=out.replace(row,"");removed++;}else seen.add(key);
    }
    return out;
  });
  if(!removed)return {buffer:docxBuffer,removed:0};
  zip.updateFile("word/document.xml",Buffer.from(xml,"utf8"));
  return {buffer:zip.toBuffer(),removed};
}

// v0.14.11 — auditoria científica retroativa dos POPs já avaliados no SIASH Docs.
const SCIENTIFIC_AUDIT_POP={
  "LEG-UTIN-032":{status:"review",label:"Revisão necessária",findings:["Reavaliar critérios fixos de preparo do box por peso/idade gestacional e condição clínica.","Atualizar requisitos de equipamentos e insumos com referências neonatal/institucionais atuais.","Incluir referências técnico-científicas aplicáveis; o documento auditado não possuía bibliografia técnica suficiente."]},
  "LEG-UTIN-031":{status:"review",label:"Revisão necessária",findings:["Resolver a inconsistência entre profundidade/coluna do selo d'água descrita no procedimento.","Atualizar montagem, monitorização, segurança e registros do sistema de drenagem torácica neonatal/pediátrica.","Substituir ou complementar referências antigas por fontes atuais e específicas."]},
  "LEG-UTIN-030":{status:"review",label:"Revisão necessária",findings:["Reavaliar faixas fixas de temperatura ambiente/equipamento e critérios de servo-controle.","Atualizar uso de umidade em incubadora conforme idade gestacional, peso, dias de vida e condição clínica.","Atualizar bibliografia neonatal de termorregulação."]},
  "LEG-UTIN-027":{status:"review",label:"Revisão necessária",findings:["Revisar horários rígidos de manipulação/pesagem e individualizar o cuidado conforme estabilidade e neuroproteção.","Reconciliar metas conflitantes de saturação e alarmes.","Reavaliar regras fixas de posicionamento, acesso vascular, exames e procedimentos nas primeiras 72 horas.","Atualizar referências muito antigas para sustentar o protocolo em 2026."]},
  "LEG-UTIN-026":{status:"review",label:"Revisão necessária",findings:["Reavaliar indicação, contraindicações, volumes e técnica de lavagem gástrica no RN/criança.","Rever materiais e terminologia, incluindo uso de sonda apropriada ao procedimento.","Atualizar referências específicas e contemporâneas."]},
  "LEG-UTIN-024":{status:"review",label:"Revisão necessária",findings:["Atualizar critérios e frequência de banho/higiene conforme idade gestacional e estabilidade clínica.","Reavaliar cuidado do coto umbilical e uso de produtos de limpeza/desinfecção.","Atualizar referências neonatais e de integridade cutânea."]},
  "LEG-UTIN-023":{status:"review",label:"Revisão necessária",findings:["Alinhar o POP à ANVISA vigente e estratégia multimodal.","Reavaliar a regra universal de volume de 3–5 mL e priorizar quantidade suficiente conforme produto/fabricante.","Explicitar os 5 momentos e esclarecer que preparação alcoólica não é mero complemento da lavagem.","Atualizar referências de 2005–2013 com publicações oficiais recentes."]},
  "LEG-UTIN-022":{status:"review",label:"Revisão necessária",findings:["Definir com precisão a solução/produto de higiene oral em vez de solução de escolha.","Reavaliar técnica e volumes em RN/criança intubada.","Atualizar frequência, avaliação da mucosa e referências específicas de higiene oral neonatal/pediátrica."]},
  "LEG-UTIN-020":{status:"review",label:"Revisão necessária",findings:["Vincular produtos desinfetantes e compatibilidade química ao manual do fabricante e protocolo CCIH/SCIRAS.","Reavaliar periodicidade fixa de 7/15 dias.","Atualizar referências de limpeza/desinfecção de incubadoras e equipamentos neonatais."]},
  "LEG-UTIN-018":{status:"review",label:"Revisão necessária",findings:["Atualizar indicação e monitorização da fototerapia conforme diretrizes neonatais atuais.","Evitar distância universal fixa; usar irradiância efetiva e especificação do fabricante.","Atualizar referências concentradas em 1995–2007."]},
  "LEG-UTIN-029":{status:"adjust",label:"Ajuste recomendado",findings:["Atualizar bibliografia e cuidados de pele associados aos eletrodos.","Reavaliar uso de pasta/gel conforme equipamento/fabricante.","Reforçar alarmes individualizados e qualidade do traçado."]},
  "LEG-UTIN-019":{status:"adjust",label:"Ajuste recomendado",findings:["Atualizar fluxo de humanização do luto parental/neonatal e referências normativas vigentes.","Prever exceções para não remoção de dispositivos em situações médico-legais/assistenciais específicas.","Revisar fluxo institucional de identificação, liberação e encaminhamento do corpo."]},
  "LEG-UTIN-017":{status:"adjust",label:"Ajuste recomendado",findings:["Atualizar referências contemporâneas sobre integridade cutânea neonatal.","Revisar antissépticos, adesivos, umidificação, emolientes e prevenção de lesão por dispositivos.","Confirmar tempos/frequências fixas somente quando sustentados por fonte atual ou fabricante."]},
  "LEG-UTIN-021":{status:"confirmed",label:"Confirmado",findings:["Conteúdo técnico auditado como adequado; recomenda-se modernização bibliográfica em futura revisão."]},
  "LEG-UTIN-025":{status:"confirmed",label:"Confirmado",findings:["Revisão ampla auditada como adequada; manter validação profissional."]}
};
function auditPop(code){return SCIENTIFIC_AUDIT_POP[String(code||"").trim()]||null}
function isOfficialScientificReference(ref){try{const host=new URL(String(ref?.url||"")).hostname.toLowerCase().replace(/^www\./,"");return host==="gov.br"||host.endsWith(".gov.br")||host==="cofen.gov.br"||host.endsWith(".cofen.gov.br")||host.includes("coren-")||host==="sbp.com.br"||host.endsWith(".sbp.com.br")||host==="who.int"||host.endsWith(".who.int")||host==="cdc.gov"||host.endsWith(".cdc.gov");}catch{return false}}
function latestReferenceYearInDoc(paragraphs){const sec=referenceSectionInfo(paragraphs);if(!sec)return null;const years=[];for(const p of paragraphs){if(p.index<=sec.headingIndex||(sec.stopIndex!=null&&p.index>=sec.stopIndex))continue;for(const y of normalizedText(p.text).match(/(?:19|20)\d{2}/g)||[])years.push(Number(y));}return years.length?Math.max(...years):null;}
app.post("/api/ai/revise-pop",auth,async(req,res)=>{
  if(req.user.r!=="owner")return res.status(403).json({error:"Somente o Administrador Proprietário pode iniciar revisão com IA."});
  try{
    const {doc_code,doc_title,current_revision,next_revision,file_name,file_base64,provider,correction_request,periodic_review_required,periodic_review_reason}=req.body||{};
    const periodicReviewRequired=periodic_review_required===true;
    const scientificAudit=auditPop(doc_code);
    const requiresCurrentWebResearch=periodicReviewRequired||scientificAudit?.status==="review"||scientificAudit?.status==="adjust";
    if(!doc_code||!file_base64)return res.status(400).json({error:"POP/arquivo não informado."});
    const original=Buffer.from(file_base64,"base64");if(original.length>18*1024*1024)return res.status(413).json({error:"Word acima do limite de 18 MB para revisão automática."});
    const historyCleanup=cleanDuplicateSiashHistoryRows(original),baseDocument=historyCleanup.buffer;
    const paragraphs=docxParagraphs(baseDocument);if(!paragraphs.length)return res.status(400).json({error:"Não foi possível extrair o texto do Word."});const hygieneBefore=bibliographyHygieneState(baseDocument);const latestReferenceYear=latestReferenceYearInDoc(paragraphs);
    const protectedRx=/(FUNDAÇÃO HOSPITALAR|PROCEDIMENTO OPERACIONAL PADRÃO|CÓDIGO|REGISTRO|REVISÃO|ELABORAÇÃO|VERIFICAÇÃO|APROVAÇÃO|ASSINATURA|HISTÓRICO)/i;
    const editable=paragraphs.filter(p=>!protectedRx.test(p.text));
    const prompt=`Você atua como revisor técnico-científico de POP hospitalar neonatal. Revise ${doc_code} — ${doc_title}, revisão atual ${current_revision}, para proposta ${next_revision}.\nREGRAS OBRIGATÓRIAS:\n1) Priorize referências oficiais e tecnicamente reconhecidas (ANVISA, Ministério da Saúde, COFEN/COREN, SBP, OMS/WHO, CDC e literatura revisada por pares quando pertinente). Não invente referências, URLs, normas ou recomendações.\n2) Não altere cabeçalho, identidade institucional, código, tabelas administrativas, histórico, campos de elaboração/verificação/aprovação/assinatura.\n3) Se não houver base suficiente para uma mudança, mantenha o texto.\n4) A saída é apenas PROPOSTA e nunca publicação automática.\n5) Retorne somente alterações técnico-científicas realmente necessárias. Cada paragraph_index deve existir na lista fornecida. Para cada alteração, preencha references com os títulos e/ou URLs das fontes que sustentam aquela alteração; use [] quando não houver fonte específica confiável.\n6) Preserve o sentido e a função de cada parágrafo; não mova seções.\n7) Nunca inclua dados de pacientes.\n8) Toda referência deve ser tratada como apoio à conferência humana; a validação profissional é obrigatória antes da publicação.\n9) NÃO mantenha, crie ou altere periodicidade, concentração, diluição, tempo de contato, compatibilidade de equipamento ou outra recomendação operacional específica sem fonte rastreável que sustente exatamente essa afirmação. Se a fonte disponível não sustentar o detalhe, mantenha o texto vigente e sinalize isso no summary.\n10) Cada alteração proposta DEVE possuir pelo menos uma referência específica em references. As referências gerais devem conter título e URL completos e rastreáveis. Não invente URL.\n11) As referências efetivamente utilizadas serão incorporadas pelo SIASH à seção de Referências Bibliográficas do Word, preservando as referências institucionais anteriores.
12) NUNCA use homepage, portal inicial ou raiz institucional (ex.: gov.br/anvisa/pt-br, sbp.com.br/) como referência bibliográfica. Informe a URL da publicação, diretriz, manual, nota técnica, resolução, artigo ou documento específico. Se não souber a URL específica, não proponha a alteração sustentada apenas por essa homepage.\n13) Se houver PEDIDO DE CORREÇÃO DO PROFISSIONAL abaixo, ele tem prioridade dentro destas regras e deve ser atendido sem criar alterações técnicas não solicitadas.
14) REVISÃO PERIÓDICA / VIGÊNCIA: se o conteúdo técnico permanecer adequado e não houver alteração técnico-científica necessária, NÃO invente mudança apenas para criar uma revisão. Informe isso claramente no summary. A SIASH poderá registrar uma revisão documental periódica sem mudança de conteúdo, sempre com validação humana e sem publicação automática.
15) Quando esta revisão exigir PESQUISA ATUAL, confronte deliberadamente o conteúdo com publicações posteriores ao ano mais recente da bibliografia detectada no POP (${latestReferenceYear||"não identificado"}) e priorize documentos oficiais vigentes.
16) Para concluir que NÃO há alteração técnico-científica necessária em revisão periódica, sustente a conclusão com pelo menos 2 referências específicas elegíveis e ao menos 1 fonte oficial/autoridade reconhecida consultada na pesquisa atual.
17) Se a AUDITORIA CIENTÍFICA SIASH estiver classificada como REVISÃO NECESSÁRIA, trate os achados como pontos obrigatórios de verificação e não encerre a análise como simples renovação de vigência.
18) Em REVISÃO NECESSÁRIA, compare literalmente os PARÁGRAFOS EDITÁVEIS com cada achado. Quando uma fonte atual sustentar correção de um achado, devolva em updates o paragraph_index do parágrafo vigente afetado e um new_text REALMENTE DIFERENTE que incorpore a correção. Repetir o texto vigente não conta como correção.
19) Em REVISÃO NECESSÁRIA, não devolva updates vazio se houver ao menos um achado corrigível pelas fontes fornecidas. Não invente alteração para cumprir esta regra: se nenhum achado puder ser corrigido com segurança pelas fontes disponíveis, mantenha updates vazio e explique objetivamente no summary quais achados ficaram sem evidência suficiente; o SIASH bloqueará a proposta para nova pesquisa.
20) Para LEG-UTIN-023 e outros POPs de higienização das mãos, diferencie explicitamente, quando sustentado pelas fontes fornecidas, preparação alcoólica versus lavagem com água e sabonete, indicação pelos momentos de higiene e quantidade/volume conforme instrução do produto/fabricante, evitando regra universal sem suporte.
MOTIVO DA REVISÃO DOCUMENTAL: ${String(periodic_review_reason||"não informado").trim()||"não informado"}
AUDITORIA CIENTÍFICA SIASH: ${scientificAudit?`${scientificAudit.label}: ${scientificAudit.findings.join(" | ")}`:"Sem apontamento retroativo específico."}\nPEDIDO DE CORREÇÃO DO PROFISSIONAL: ${String(correction_request||"Nenhum").trim()||"Nenhum"}\nPARÁGRAFOS EDITÁVEIS (índice | texto):\n${editable.map(p=>`${p.index} | ${p.text}`).join("\n")}`;
    const researchQuery=[
      doc_title,
      scientificAudit?.status==="review"||scientificAudit?.status==="adjust" ? "revisão técnico-científica hospitalar neonatal" : "",
      ...(scientificAudit?.findings||[]),
      "ANVISA Ministério da Saúde SBP WHO diretriz manual recomendação atual"
    ].filter(Boolean).join(" | ");
    const ai=await runAIRevision(prompt,provider,{requireWebResearch:requiresCurrentWebResearch,researchQuery});
    if(requiresCurrentWebResearch&&!(["web_search","google_search","tavily_search"].includes(String(ai.researchMode||""))))throw new Error("Esta revisão exige pesquisa web atual. Nenhum provedor com pesquisa web verificável concluiu a análise; o POP vigente permanece inalterado.");
    const result=ai.result||{},allowed=new Set(editable.map(p=>p.index));
    const effective=effectiveAIUpdates(paragraphs,result.updates||[],allowed);
    if(scientificAudit?.status==="review"){
      console.log(`[SIASH AI] auditoria obrigatória | code=${doc_code} | updates_recebidos=${Array.isArray(result.updates)?result.updates.length:0} | alteracoes_reais=${effective.length} | achados=${scientificAudit.findings.length}`);
      if(!effective.length)throw new Error("Este POP foi classificado pela auditoria científica como REVISÃO NECESSÁRIA. A IA não produziu alteração real nos parágrafos auditados; a proposta foi bloqueada para evitar simples renovação de vigência.");
    }
    if(effective.some(x=>!Array.isArray(x.references)||!x.references.length))throw new Error("A IA propôs alteração técnico-científica sem referência específica. A proposta foi bloqueada para conferência segura.");
    const candidateSources=[...(result.references||[]),...(ai.sources||[])].filter(x=>x&&(x.title||x.url));
    const norm=s=>normalizedText(s).toLowerCase();
    const sourceKeys=candidateSources.flatMap(x=>[norm(x.title),norm(x.url)]).filter(Boolean);
    const unlinked=effective.filter(ch=>!(ch.references||[]).some(ref=>{const n=norm(ref);return sourceKeys.some(k=>k===n||k.includes(n)||n.includes(k))}));
    if(unlinked.length)throw new Error(`A IA citou referência específica em alteração(ões), mas não forneceu os dados bibliográficos correspondentes para rastreamento (parágrafos: ${unlinked.map(x=>x.paragraph_index).join(", ")}). A proposta foi bloqueada.`);
    const classified=candidateSources.length?await classifyReferenceUrls(candidateSources):{verified:[],pending:[]};
    const references=[...classified.verified,...classified.pending];
    const eligibleReferenceCount=references.filter(x=>x?.wordEligible===true).length;
    const officialEligibleReferenceCount=references.filter(x=>x?.wordEligible===true&&isOfficialScientificReference(x)).length;
    let traceable=[],excludedChanges=[];
    if(effective.length){
      if(!references.length)throw new Error("A IA não retornou referências identificáveis para conferência. A proposta foi bloqueada; o POP vigente permanece inalterado.");
      traceable=effective.filter(ch=>(ch.references||[]).some(ref=>references.some(src=>src.wordEligible===true&&sourceMatchesChangeReference(ref,src))));
      excludedChanges=effective.filter(ch=>!traceable.includes(ch));
      if(!traceable.length)throw new Error("As alterações propostas ficaram sustentadas apenas por fontes genéricas ou não identificáveis. A SIASH não inseriu essas fontes no Word e bloqueou a proposta para proteger a bibliografia institucional.");
    }
    if(periodicReviewRequired&&!traceable.length&&(eligibleReferenceCount<2||officialEligibleReferenceCount<1))throw new Error(`Revisão periódica sem alteração bloqueada: são necessárias pelo menos 2 referências específicas elegíveis e 1 fonte oficial/autoridade reconhecida. Recebidas: ${eligibleReferenceCount} elegível(is), ${officialEligibleReferenceCount} oficial(is).`);
    // v0.14.6 — separa revisão documental periódica de alteração técnico-científica.
    // Se o POP precisa renovar a vigência, a ausência de mudança técnica NÃO é falha: cria-se uma
    // proposta de revisão periódica, preservando integralmente o conteúdo e exigindo a mesma aprovação humana.
    // Fora de um ciclo de revisão documental solicitado, permanece a proteção contra falsa revisão.
    if(!traceable.length&&!hygieneBefore.needsHygiene&&!periodicReviewRequired)throw new Error("A revisão não produziu alteração técnico-científica rastreável nem correção bibliográfica necessária. O POP vigente foi preservado.");
    let contentRevised=baseDocument,verification={verified:true,actualChanges:0};
    if(traceable.length){contentRevised=patchDocx(baseDocument,traceable);verification=verifyDocxRevision(baseDocument,contentRevised,traceable)}
    let withRefs={buffer:contentRevised,added:0,moved:0,coverage:[],representedByInstitutional:0,genericReferencesRemoved:0,legacyLabelsRemoved:0,wordEligibleReferences:0};
    if(traceable.length||hygieneBefore.needsHygiene||(periodicReviewRequired&&eligibleReferenceCount>0)){
      withRefs=appendReviewedReferences(contentRevised,references,{allowHygieneOnly:!traceable.length});
    }
    const hygieneChanges=Number(withRefs.genericReferencesRemoved||0)+Number(withRefs.labelsRemoved||0);
    const periodicReviewOnly=periodicReviewRequired&&!traceable.length&&hygieneChanges<1;
    if(!traceable.length&&!periodicReviewRequired&&hygieneChanges<1)throw new Error("A SIASH não encontrou correção bibliográfica efetiva a aplicar. O POP vigente foi preservado.");
    verification.actualChanges=Number(verification.actualChanges??traceable.length)+hygieneChanges;
    verification.periodicReviewOnly=periodicReviewOnly;
    verification.periodicReviewRequired=periodicReviewRequired;
    verification.periodicReviewReason=String(periodic_review_reason||"").trim();verification.researchMode=ai.researchMode||"provider_default";verification.currentWebResearchRequired=requiresCurrentWebResearch;verification.eligibleReferenceCount=eligibleReferenceCount;verification.officialEligibleReferenceCount=officialEligibleReferenceCount;verification.latestReferenceYear=latestReferenceYear;verification.scientificAuditStatus=scientificAudit?.status||"none";verification.scientificAuditLabel=scientificAudit?.label||"";
    verification.historyRowsCleaned=Number(historyCleanup.removed||0);
    verification.bibliographyHygieneOnly=!traceable.length&&hygieneChanges>0;
    verification.bibliographyHygieneChanges=hygieneChanges;
    verification.genericReferencesRemoved=Number(withRefs.genericReferencesRemoved||0);
    verification.legacyLabelsRemoved=Number(withRefs.labelsRemoved||0);
    const revised=withRefs.buffer;
    // v0.13.3: não exige que toda URL retornada pela IA apareça literalmente no Word.
    // Uma fonte pode já estar representada por uma referência institucional semanticamente equivalente;
    // nesse caso, repetir a URL criaria justamente a duplicidade que a v0.13.2 passou a impedir.
    if(!periodicReviewOnly&&(!withRefs.coverage?.length||withRefs.coverage.some(x=>!x.represented)))throw new Error("Falha de integridade ao consolidar as referências no Word. A proposta não foi liberada.");
    if(periodicReviewOnly&&withRefs.coverage?.some(x=>!x.represented))throw new Error("Falha de integridade ao consolidar as referências da revisão periódica no Word. A proposta não foi liberada.");
    verification.referencesAdded=withRefs.added;
    verification.referencesVerified=classified.verified.length;
    verification.referencesPending=classified.pending.length;verification.referencePlacement="bibliography_section_verified";
    const validatedSummary=traceable.length
  ?`Alterações técnico-científicas efetivamente aplicadas e validadas no Word: ${traceable.map((ch,i)=>{
      const before=String(ch.before_text||"").trim();
      const after=String(ch.new_text||"").trim();
      const reason=String(ch.reason||"").trim();
      return `${i+1}) ${before} → ${after}${reason?` — ${reason}`:""}`;
    }).join(" | ")}`
  :periodicReviewOnly
    ?"Revisão periódica concluída sem alteração técnico-científica do conteúdo. O documento segue para conferência e aprovação profissional."
    :"Nenhuma alteração técnico-científica efetivamente aplicada e validada no Word.";
    await audit(req.user.u,"SIASH Docs: proposta de revisão gerada e validada estruturalmente pela IA.",{doc_code,current_revision,next_revision,provider:ai.provider,model:ai.model,changes:traceable.length,periodic_review_only:periodicReviewOnly,periodic_review_required:periodicReviewRequired,bibliography_hygiene_changes:Number(verification.bibliographyHygieneChanges||0),history_rows_cleaned:Number(historyCleanup.removed||0),changes_excluded_unqualified_sources:excludedChanges.length,verified:true,references_verified:classified.verified.length,references_pending:classified.pending.length});
    res.json({ok:true,provider:ai.provider,model:ai.model,researchMode:ai.researchMode||"provider_default",summary:validatedSummary,changes:traceable,excludedChanges,references,verification,file_name:String(file_name||`${doc_code}_Rev${next_revision}_PROPOSTA_IA.docx`).replace(/\.docx$/i,"")+"_IA.docx",file_base64:revised.toString("base64")});
  }catch(e){console.error("AI revise POP:",e);res.status(500).json({error:"Falha ao gerar proposta com IA: "+(e?.message||"erro interno")})}
});

app.get("/api/users",auth,async(req,res)=>{
  if(req.user.r!=="owner")return res.status(403).json({error:"Somente Administrador Proprietário."});
  const q=await pool.query("SELECT username,role,created_at FROM siash_users ORDER BY username");res.json(q.rows);
});
app.post("/api/users",auth,async(req,res)=>{
  if(req.user.r!=="owner")return res.status(403).json({error:"Somente Administrador Proprietário."});
  const username=String(req.body.username||"").trim(), password=String(req.body.password||""), role=req.body.role==="owner"?"owner":"operational";
  if(!username||password.length<8)return res.status(400).json({error:"Dados inválidos."});
  const hash=await bcrypt.hash(password,12);
  await pool.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,role=EXCLUDED.role",[username,hash,role]);
  await audit(req.user.u,"Usuário Cloud criado/alterado.",{username,role});
  res.json({ok:true});
});

app.use(express.static(__dirname,{extensions:["html"]}));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));

initDb().then(()=>app.listen(PORT,()=>console.log(`SIASH Cloud ativa na porta ${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
