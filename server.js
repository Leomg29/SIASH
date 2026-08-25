
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
  await pool.query(`
    INSERT INTO siash_state(id,payload,updated_at,updated_by) VALUES(1,$1,NOW(),$2)
    ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW(),updated_by=EXCLUDED.updated_by
  `,[payload,req.user.u]);
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
