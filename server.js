
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

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


// --- SIASH Docs IA: revisão técnico-científica com preservação do OOXML ---
const OpenAI = require("openai");
const AdmZip = require("adm-zip");
const aiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const AI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
function xmlDecode(s=""){return s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}
function xmlEncode(s=""){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}
function docxParagraphs(buf){
  const zip=new AdmZip(buf),entry=zip.getEntry("word/document.xml");if(!entry)throw new Error("DOCX sem word/document.xml.");
  const xml=entry.getData().toString("utf8"), blocks=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
  return blocks.map((m,index)=>({index,text:[...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x=>xmlDecode(x[1])).join("").trim()})).filter(x=>x.text);
}
function patchDocx(buf,updates){
  const zip=new AdmZip(buf),entry=zip.getEntry("word/document.xml"),xml=entry.getData().toString("utf8");
  const map=new Map((updates||[]).map(u=>[Number(u.paragraph_index),String(u.new_text||"")]));let idx=-1;
  const patched=xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{idx++;if(!map.has(idx))return p;let first=true;return p.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,(all,a,b,c)=>{if(first){first=false;return a+xmlEncode(map.get(idx))+c}return a+c})});
  zip.updateFile("word/document.xml",Buffer.from(patched,"utf8"));return zip.toBuffer();
}
function collectWebSources(response){
  const urls=new Map();for(const item of response.output||[]){if(item.type==="web_search_call"){for(const s of item.action?.sources||[]){if(s?.url)urls.set(s.url,s.title||s.url)}}}
  return [...urls].map(([url,title])=>({title,url}));
}
app.get("/api/ai/status",auth,(req,res)=>res.json({configured:!!aiClient,model:AI_MODEL}));
app.post("/api/ai/revise-pop",auth,async(req,res)=>{
  if(req.user.r!=="owner")return res.status(403).json({error:"Somente o Administrador Proprietário pode iniciar revisão com IA."});
  if(!aiClient)return res.status(503).json({error:"OPENAI_API_KEY ainda não configurada no servidor."});
  try{
    const {doc_code,doc_title,current_revision,next_revision,file_name,file_base64}=req.body||{};
    if(!doc_code||!file_base64)return res.status(400).json({error:"POP/arquivo não informado."});
    const original=Buffer.from(file_base64,"base64");if(original.length>18*1024*1024)return res.status(413).json({error:"Word acima do limite de 18 MB para revisão automática."});
    const paragraphs=docxParagraphs(original);if(!paragraphs.length)return res.status(400).json({error:"Não foi possível extrair o texto do Word."});
    const protectedRx=/(FUNDAÇÃO HOSPITALAR|PROCEDIMENTO OPERACIONAL PADRÃO|CÓDIGO|REGISTRO|REVISÃO|ELABORAÇÃO|VERIFICAÇÃO|APROVAÇÃO|ASSINATURA|HISTÓRICO)/i;
    const editable=paragraphs.filter(p=>!protectedRx.test(p.text));
    const prompt=`Você atua como revisor técnico-científico de POP hospitalar neonatal. Revise ${doc_code} — ${doc_title}, revisão atual ${current_revision}, para proposta ${next_revision}.\nREGRAS OBRIGATÓRIAS:\n1) Pesquise na web referências oficiais e atuais, priorizando ANVISA, Ministério da Saúde, COFEN/COREN, SBP e órgãos oficiais; complemente com diretrizes e literatura revisada por pares somente quando necessário.\n2) Não altere cabeçalho, identidade institucional, código, tabelas administrativas, histórico, campos de elaboração/verificação/aprovação/assinatura.\n3) Não invente recomendações nem referências. Se não houver base suficiente, mantenha o texto.\n4) A saída é apenas PROPOSTA e nunca publicação automática.\n5) Retorne somente alterações técnico-científicas realmente necessárias. Cada paragraph_index deve existir na lista fornecida.\n6) Preserve o sentido e a função de cada parágrafo; não mova seções.\nPARÁGRAFOS EDITÁVEIS (índice | texto):\n${editable.map(p=>`${p.index} | ${p.text}`).join("\n")}`;
    const response=await aiClient.responses.create({model:AI_MODEL,tools:[{type:"web_search"}],input:prompt,text:{format:{type:"json_schema",name:"siash_pop_revision",strict:true,schema:{type:"object",additionalProperties:false,properties:{summary:{type:"string"},updates:{type:"array",items:{type:"object",additionalProperties:false,properties:{paragraph_index:{type:"integer"},new_text:{type:"string"},reason:{type:"string"}},required:["paragraph_index","new_text","reason"]}},references:{type:"array",items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},url:{type:"string"}},required:["title","url"]}}},required:["summary","updates","references"]}}}});
    const result=JSON.parse(response.output_text||"{}");const allowed=new Set(editable.map(p=>p.index));result.updates=(result.updates||[]).filter(u=>allowed.has(Number(u.paragraph_index))&&String(u.new_text||"").trim());
    const revised=patchDocx(original,result.updates),sources=[...(result.references||[]),...collectWebSources(response)].filter(x=>x&&x.url);const unique=[...new Map(sources.map(x=>[x.url,x])).values()];
    await audit(req.user.u,"SIASH Docs: proposta de revisão gerada por IA.",{doc_code,current_revision,next_revision,model:AI_MODEL,changes:result.updates.length});
    res.json({ok:true,model:AI_MODEL,summary:result.summary||"",changes:result.updates,references:unique,file_name:String(file_name||`${doc_code}_Rev${next_revision}_PROPOSTA_IA.docx`).replace(/\.docx$/i,"")+"_IA.docx",file_base64:revised.toString("base64")});
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
