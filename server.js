
const express = require("express");
const {decideMidnightClosure,dateInBrazil,previousDate,NOTE}=require("./census-midnight.cjs");
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
      role TEXT NOT NULL CHECK(role IN ('owner','operational','clinical_supervisor')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS siash_state(
      id INTEGER PRIMARY KEY CHECK(id=1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
    ALTER TABLE siash_state ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
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
    CREATE TABLE IF NOT EXISTS siash_pending_tasks(
      id BIGSERIAL PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('bed','sector')),
      bed TEXT,
      priority TEXT NOT NULL CHECK(priority IN ('Normal','Alta','Crítica')),
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pendente' CHECK(status IN ('Pendente','Em andamento','Concluída')),
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      legacy_key TEXT UNIQUE
    );
    ALTER TABLE siash_pending_tasks ADD COLUMN IF NOT EXISTS legacy_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS siash_pending_legacy_key_unique ON siash_pending_tasks(legacy_key);
    CREATE TABLE IF NOT EXISTS siash_pending_history(
      id BIGSERIAL PRIMARY KEY,
      task_id BIGINT NOT NULL REFERENCES siash_pending_tasks(id),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS siash_pipa_cancellation_audit(
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      username TEXT NOT NULL,
      record_index INTEGER NOT NULL,
      record_before JSONB NOT NULL,
      reason TEXT NOT NULL,
      state_revision BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS siash_daily_admission_records(
      reference_date DATE PRIMARY KEY,
      admission_count INTEGER NOT NULL CHECK(admission_count>=0),
      ever_admitted BOOLEAN NOT NULL DEFAULT FALSE,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      recorded_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS siash_census_auto_closures(
      reference_date DATE PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      midnight_at TIMESTAMPTZ NOT NULL,
      census_count INTEGER NOT NULL,
      note TEXT NOT NULL,
      state_revision BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS siash_census_late_requests(
      protocol TEXT PRIMARY KEY,
      reference_date DATE NOT NULL,
      requester TEXT NOT NULL REFERENCES siash_users(username),
      midnight_count INTEGER NOT NULL CHECK(midnight_count>=0),
      justification TEXT NOT NULL,
      evidence TEXT NOT NULL,
      state_revision BIGINT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(reference_date)
    );
    CREATE TABLE IF NOT EXISTS siash_census_late_events(
      id BIGSERIAL PRIMARY KEY,
      protocol TEXT NOT NULL REFERENCES siash_census_late_requests(protocol),
      reference_date DATE NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('pendente','regularizacao_solicitada','aguardando_supervisor','regularizacao_aprovada','regularizacao_rejeitada','pendente_validacao_clinica')),
      actor TEXT NOT NULL REFERENCES siash_users(username),
      state_revision BIGINT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      details JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS siash_census_late_events_protocol_idx ON siash_census_late_events(protocol,id);
    CREATE OR REPLACE FUNCTION siash_census_late_no_mutation() RETURNS trigger LANGUAGE plpgsql AS $late$
    BEGIN RAISE EXCEPTION 'Clinical late census audit is append-only'; END $late$;
    DROP TRIGGER IF EXISTS siash_census_late_requests_immutable ON siash_census_late_requests;
    CREATE TRIGGER siash_census_late_requests_immutable BEFORE UPDATE OR DELETE ON siash_census_late_requests FOR EACH ROW EXECUTE FUNCTION siash_census_late_no_mutation();
    DROP TRIGGER IF EXISTS siash_census_late_events_immutable ON siash_census_late_events;
    CREATE TRIGGER siash_census_late_events_immutable BEFORE UPDATE OR DELETE ON siash_census_late_events FOR EACH ROW EXECUTE FUNCTION siash_census_late_no_mutation();
    CREATE TABLE IF NOT EXISTS siash_cloud_audit(
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      username TEXT,
      action TEXT NOT NULL,
      details JSONB
    );
  `);
  await pool.query(`DO $role$ DECLARE item record; BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='siash_users'::regclass
      AND conname='siash_users_role_check'
      AND pg_get_constraintdef(oid) LIKE '%clinical_supervisor%') THEN
      FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='siash_users'::regclass
        AND contype='c' AND pg_get_constraintdef(oid) LIKE '%role%' AND pg_get_constraintdef(oid) LIKE '%operational%'
      LOOP EXECUTE format('ALTER TABLE siash_users DROP CONSTRAINT %I',item.conname); END LOOP;
      ALTER TABLE siash_users ADD CONSTRAINT siash_users_role_check
        CHECK(role IN ('owner','operational','clinical_supervisor'));
    END IF;
  END $role$;`);
}
const STRONG_PASSWORD=/[!@#$%^&*._-]/;
function validNewPassword(password){return typeof password==="string"&&password.length>=10&&password.length<=128&&STRONG_PASSWORD.test(password)}
const CLINICAL_DECISION_ROLES=new Set(["owner","clinical_supervisor"]);
async function databaseRole(username,client=pool){
 const q=await client.query("SELECT role FROM siash_users WHERE username=$1",[username]);
 return q.rows[0]?.role||null;
}
function canDecideClinical(role){return CLINICAL_DECISION_ROLES.has(role)}
function tokenFor(user){ return jwt.sign({u:user.username,r:user.role}, JWT_SECRET,{expiresIn:"12h"}); }
async function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  let identity;
  try{identity=jwt.verify(token,JWT_SECRET)}
  catch(e){return res.status(401).json({error:"Sessão inválida ou expirada."})}
  try{
    const role=await databaseRole(identity.u);
    if(!role)return res.status(401).json({error:"Conta não encontrada."});
    req.user={...identity,r:role};next();
  }catch(e){next(e)}
}
async function audit(username,action,details=null){
  try{await pool.query("INSERT INTO siash_cloud_audit(username,action,details) VALUES($1,$2,$3)",[username,action,details])}catch(e){}
}

app.get("/api/health", async (req,res)=>{
  const users = await pool.query("SELECT COUNT(*)::int n FROM siash_users");
  res.json({ok:true,configured:users.rows[0].n>0});
});

app.post("/api/bootstrap", async(req,res)=>{
  const count=await pool.query("SELECT COUNT(*)::int n FROM siash_users");
  if(count.rows[0].n>0) return res.status(409).json({error:"Administrador já configurado."});
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  if(!username || !validNewPassword(password)) return res.status(400).json({error:"Usuário e senha de 10 a 128 caracteres com pelo menos um especial (!@#$%^&*._-) são obrigatórios."});
  const hash=await bcrypt.hash(password,12);
  await pool.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,'owner')",[username,hash]);
  await audit(username,"Administrador Proprietário Cloud criado.");
  const user={username,role:"owner"};
  res.json({token:tokenFor(user),role:"owner",user:username});
});

app.post("/api/change-password",auth,async(req,res)=>{
 const current=String(req.body?.currentPassword||""),next=String(req.body?.newPassword||"");
 if(!validNewPassword(next))return res.status(400).json({error:"Nova senha: 10 a 128 caracteres e pelo menos um especial (!@#$%^&*._-)."});
 if(req.body?.confirmPassword!==next)return res.status(400).json({error:"Confirmação da nova senha não coincide."});
 if(current===next)return res.status(400).json({error:"A nova senha deve ser diferente da atual."});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const q=await client.query("SELECT password_hash FROM siash_users WHERE username=$1 FOR UPDATE",[req.user.u]);
  if(!q.rows.length||!(await bcrypt.compare(current,q.rows[0].password_hash))){await client.query("ROLLBACK");return res.status(403).json({error:"Senha atual incorreta."});}
  const hash=await bcrypt.hash(next,12);
  await client.query("UPDATE siash_users SET password_hash=$1 WHERE username=$2",[hash,req.user.u]);
  await client.query("INSERT INTO siash_cloud_audit(username,action) VALUES($1,$2)",[req.user.u,"Senha alterada pelo próprio usuário."]);
  await client.query("COMMIT");
  res.json({ok:true});
 }catch(e){try{await client.query("ROLLBACK")}catch(_){}throw e}finally{client.release()}
});
app.post("/api/login", async(req,res)=>{
  const username=String(req.body.username||"").trim(), password=String(req.body.password||"");
  const q=await pool.query("SELECT username,password_hash,role FROM siash_users WHERE username=$1",[username]);
  if(!q.rows.length || !(await bcrypt.compare(password,q.rows[0].password_hash)))
    return res.status(401).json({error:"Usuário ou senha inválidos."});
  const u=q.rows[0]; await audit(username,"Login Cloud.");
  res.json({token:tokenFor(u),role:u.role,user:u.username});
});

async function migrateLegacyPending(){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const state=await client.query('SELECT payload FROM siash_state WHERE id=1 FOR SHARE');
    const legacy=state.rows[0]?.payload?.state?.pending;
    if(Array.isArray(legacy)){
      for(let i=0;i<legacy.length;i++){
        const p=legacy[i];if(!p||typeof p!=='object')continue;
        const description=String(p.text||'').trim().slice(0,2000);
        if(!description)continue;
        const rawBed=String(p.bed||'').trim();
        const match=rawBed.match(/(?:Leito\s*0*)?(\d{1,2})/i);
        const bed=match&&Number(match[1])>=1&&Number(match[1])<=10?String(Number(match[1])):null;
        const priority=['Normal','Alta','Crítica'].includes(p.priority)?p.priority:'Normal';
        const status=p.done?'Concluída':'Pendente';
        const q=await client.query(
          "INSERT INTO siash_pending_tasks(scope,bed,priority,description,status,created_by,updated_by,completed_at,legacy_key) VALUES($1,$2,$3,$4,$5,'Legado SIASH',NULL,CASE WHEN $5='Concluída' THEN NOW() ELSE NULL END,$6) ON CONFLICT(legacy_key) DO NOTHING RETURNING id",
          [bed?'bed':'sector',bed,priority,description,status,'siash-state-pending-'+i]
        );
        if(q.rows.length)await client.query("INSERT INTO siash_pending_history(task_id,actor,action,new_status) VALUES($1,'Migração SIASH','Importada do histórico',$2)",[q.rows[0].id,status]);
      }
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
app.get("/api/pending",auth,async(req,res)=>{
  await migrateLegacyPending();
  const q=await pool.query("SELECT * FROM siash_pending_tasks ORDER BY (status='Concluída'), created_at DESC, id DESC LIMIT 500");
  res.json({items:q.rows});
});
app.post("/api/pending",auth,async(req,res)=>{
  const scope=req.body?.scope==='sector'?'sector':'bed';
  const bed=scope==='bed'?String(req.body?.bed||'').trim():null;
  const priority=String(req.body?.priority||'Normal');
  const description=String(req.body?.description||'').trim();
  if((scope==='bed'&&!/^(?:[1-9]|10)$/.test(bed))||!['Normal','Alta','Crítica'].includes(priority)||!description||description.length>2000)
    return res.status(400).json({error:'Confira leito, prioridade e descrição (máximo 2000 caracteres).'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const q=await client.query("INSERT INTO siash_pending_tasks(scope,bed,priority,description,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",[scope,bed,priority,description,req.user.u]);
    await client.query("INSERT INTO siash_pending_history(task_id,actor,action,new_status) VALUES($1,$2,'Criada','Pendente')",[q.rows[0].id,req.user.u]);
    await client.query('COMMIT');res.status(201).json({item:q.rows[0]});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});
app.patch("/api/pending/:id",auth,async(req,res)=>{
  const id=Number(req.params.id),status=String(req.body?.status||'');
  if(!Number.isSafeInteger(id)||id<1||!['Pendente','Em andamento','Concluída'].includes(status))
    return res.status(400).json({error:'Situação inválida.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const previous=await client.query('SELECT status FROM siash_pending_tasks WHERE id=$1 FOR UPDATE',[id]);
    if(!previous.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Pendência não encontrada.'});}
    const old=previous.rows[0].status;
    const q=await client.query("UPDATE siash_pending_tasks SET status=$2,updated_by=$3,updated_at=NOW(),completed_at=CASE WHEN $2='Concluída' THEN NOW() ELSE NULL END WHERE id=$1 RETURNING *",[id,status,req.user.u]);
    if(old!==status)await client.query("INSERT INTO siash_pending_history(task_id,actor,action,previous_status,new_status) VALUES($1,$2,'Situação alterada',$3,$4)",[id,req.user.u,old,status]);
    await client.query('COMMIT');res.json({item:q.rows[0]});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});
app.get("/api/pending/:id/history",auth,async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Identificador inválido.'});
  const q=await pool.query('SELECT actor,action,previous_status,new_status,created_at FROM siash_pending_history WHERE task_id=$1 ORDER BY id DESC',[id]);res.json({items:q.rows});
});

// Idempotent midnight reconciliation: called on startup and authenticated requests.
// Read-only clinical decision: no new automatic closure or clinical-state mutation.
async function reconcileMidnightCensus(){
 const referenceDate=previousDate(dateInBrazil(new Date()));
 const row=await pool.query("SELECT payload FROM siash_state WHERE id=1");
 if(!row.rows.length)return {status:"pending",referenceDate,reason:"Estado central não inicializado."};
 const daily=row.rows[0].payload?.state?.daily?.find?.(r=>r.date===referenceDate);
 const decision=decideMidnightClosure({daily,referenceDate});
 return decision;
}
// Prévia de janela calculada exclusivamente com o relógio do servidor; sem mutações clínicas.
app.get("/api/census/window-status",auth,async(req,res)=>{
 try{
  const {censusAttention}=require("./census-window.cjs");
  const now=new Date(),window=censusAttention({now});
  const row=await pool.query("SELECT payload FROM siash_state WHERE id=1");
  const daily=row.rows[0]?.payload?.state?.daily?.find?.(r=>r.date===window.referenceDate);
  const decision=decideMidnightClosure({daily,referenceDate:window.referenceDate,now});
  const officiallyClosed=decision.status==="manual";
  const attention=censusAttention({now,officiallyClosed});
  res.json({...attention,serverTime:now.toISOString(),clinicalStatus:decision.status,informationalOnly:true});
 }catch(err){res.status(503).json({status:"unavailable",error:"Não foi possível verificar a janela do censo."})}
});
app.get("/api/census/midnight-status",auth,async(req,res)=>{
 try{
  const referenceDate=previousDate(dateInBrazil(new Date()));
  const result=await reconcileMidnightCensus();
  // Legacy auto closures remain in the database but never count as a manual conference.
  const legacy=await pool.query("SELECT reference_date FROM siash_census_auto_closures WHERE reference_date=$1",[referenceDate]);
  res.json({status:result.status,referenceDate,reason:result.reason||null,legacyAutomaticRecordExists:legacy.rows.length>0,...(result.status==="manual"?{responsible:result.responsible,registeredAt:result.registeredAt}:{})});
 }catch(err){res.status(503).json({status:"unavailable",error:"Não foi possível verificar o fechamento do censo."})}
});
app.get("/api/state",auth,async(req,res)=>{
  await reconcileMidnightCensus();
  const q=await pool.query("SELECT payload,updated_at,updated_by,revision FROM siash_state WHERE id=1");
  if(!q.rows.length) return res.json({exists:false});
  res.json({exists:true,payload:q.rows[0].payload,updated_at:q.rows[0].updated_at,updated_by:q.rows[0].updated_by,revision:Number(q.rows[0].revision)});
});
// Impede remoção, adulteração e cancelamentos falsificados de encaminhamentos PIPA.
// Retorna a carga normalizada e eventos a persistir atomicamente com o estado.
function reconcilePipaAudit(previous,incoming,actor){
 const oldPipa=previous?.state?.pipa,after=incoming?.state?.pipa;
 if(oldPipa===undefined&&after===undefined)return {payload:incoming,events:[]};
 // Bases anteriores à implantação do módulo podem não conter a chave PIPA.
 const before=oldPipa===undefined?[]:oldPipa;
 if(!Array.isArray(before)||!Array.isArray(after))return {error:"Estrutura PIPA inválida."};
 if(after.length<before.length)return {error:"Não é permitido remover registros PIPA existentes."};
 const events=[];
 const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
 const stable=x=>canonical(Object.fromEntries(Object.entries(x).filter(([k])=>!["cancelledAt","cancelledBy","cancelReason","updated"].includes(k))));
 for(let i=0;i<after.length;i++){
  const old=before[i],next=after[i];
  if(!next||typeof next!=="object"||Array.isArray(next))return {error:"Registro PIPA inválido."};
  if(i>=before.length){
   if(next.cancelledAt||next.cancelledBy||next.cancelReason)return {error:"Novo encaminhamento não pode nascer cancelado."};
   // Validar somente inclusões: registros históricos já existentes permanecem intactos.
   if(typeof next.city!=="string"||!next.city.trim()||typeof next.month!=="string"||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(next.month)||!Number.isSafeInteger(next.qty)||next.qty<1)return {error:"Novo encaminhamento PIPA exige município, competência e quantidade válidos."};
   if(next.date!==undefined&&next.date!==null&&next.date!==""){
    if(next.postDischargeConfirmed!==true)return {error:"Confirme que o encaminhamento PIPA ocorreu após a alta da UTIN."};
    if(typeof next.date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(next.date)||Number.isNaN(Date.parse(next.date+"T00:00:00Z"))||next.date.slice(0,7)!==next.month||new Date(next.date+"T00:00:00Z").toISOString().slice(0,10)!==next.date)return {error:"Data do encaminhamento PIPA inválida ou diferente da competência."};
   }
   continue;
  }
  if(!old||typeof old!=="object"||Array.isArray(old))
   return {error:"Registro PIPA anterior alterado ou reordenado; solicite conciliação."};
  if(old.cancelledAt){
   if(canonical(old)!==canonical(next))return {error:"Auditoria PIPA cancelada é imutável."};
   continue;
  }
  if(stable(old)!==stable(next))
   return {error:"Registro PIPA anterior alterado ou reordenado; solicite conciliação."};
  if(!next.cancelledAt){
   if(next.updated!==old.updated)return {error:"Alteração não auditada no registro PIPA."};
   if(next.cancelledBy||next.cancelReason)return {error:"Metadados de cancelamento PIPA inconsistentes."};
   continue;
  }
  if(typeof next.cancelReason!=="string")return {error:"Justificativa PIPA deve ser um texto válido."};
  const reason=next.cancelReason.trim();
  if(reason.length<10||reason.length>1000)return {error:"Justificativa PIPA deve ter entre 10 e 1000 caracteres."};
  if(!next.cancelledBy||!next.cancelledAt)return {error:"Cancelamento PIPA incompleto."};
  // Normalizar a justificativa persistida para coincidir com a trilha de auditoria.
  next.cancelReason=reason;
  // A identidade e o horário são definidos pelo servidor, nunca pelo navegador.
  next.cancelledBy=actor;
  next.cancelledAt=new Date().toISOString();
  events.push({index:i,before:old,reason});
 }
 return {payload:incoming,events};
}
// Preserve each existing daily record occurrence; duplicates are never silently collapsed.
function detectDailyRecordRemoval(previousDaily,incomingDaily){
 if(!Array.isArray(previousDaily)||!Array.isArray(incomingDaily))return {blocked:true,reason:"Estrutura de lançamentos diários inválida."};
 const counts=new Map();
 for(const record of incomingDaily){
  if(!record||typeof record!=="object"||Array.isArray(record)||typeof record.date!=="string"||!record.date)return {blocked:true,reason:"Registro diário sem data válida."};
  counts.set(record.date,(counts.get(record.date)||0)+1);
 }
 for(const record of previousDaily){
  if(!record||typeof record!=="object"||Array.isArray(record)||typeof record.date!=="string"||!record.date)return {blocked:true,reason:"Registro histórico diário inválido: revisão manual necessária."};
  const remaining=counts.get(record.date)||0;
  if(remaining<1)return {blocked:true,reason:"Lançamento clínico anterior ausente ou ocorrência histórica removida.",date:record.date};
  counts.set(record.date,remaining-1);
 }
 return {blocked:false};
}
app.put("/api/state",auth,async(req,res)=>{
  const payload=req.body?.payload,base=Number(req.body?.base_revision);
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return res.status(400).json({error:"Estado inválido."});
  if(!Number.isSafeInteger(base)||base<1)return res.status(428).json({error:"Atualize a sessão para sincronizar a versão dos dados antes de salvar."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const cur=await client.query("SELECT payload,revision FROM siash_state WHERE id=1 FOR UPDATE");
    if(!cur.rows.length){await client.query("ROLLBACK");return res.status(409).json({error:"Estado central não encontrado. Recarregue os dados.",conflict:true});}
    const current=Number(cur.rows[0].revision);
    if(current!==base){await client.query("ROLLBACK");return res.status(409).json({error:"Outro profissional salvou alterações antes de você. Seus dados locais foram preservados; não atualize a página antes de exportar ou conferir seus lançamentos.",conflict:true,current_revision:current});}
    // Authoritative admission-specific timestamp, independent of PICC/SAE/bed edits.
    // A historical positive admission can never be erased by later setting the counter to zero.
    const oldDaily=cur.rows[0].payload?.state?.daily||[];
    const newDaily=payload?.state?.daily??(Array.isArray(oldDaily)&&oldDaily.length===0?[]:undefined);
    const removalAudit=detectDailyRecordRemoval(oldDaily,newDaily);
    if(removalAudit.blocked){await client.query("ROLLBACK");return res.status(422).json({error:"CLINICAL_RECORD_REMOVAL_BLOCKED",message:removalAudit.reason,date:removalAudit.date||null});}
    if(!Array.isArray(newDaily)){await client.query("ROLLBACK");return res.status(422).json({error:"Lançamentos diários inválidos."});}
    // Proteção transacional: nenhuma conferência nova fora da janela oficial,
    // nem substituição ou remoção de conferências históricas existentes.
    const {validateConferenceMutation}=require("./census-window.cjs");
    const serverNow=new Date();
    for(const before of oldDaily){
      if(!before?.censusConference)continue;
      const after=newDaily.find(d=>d?.date===before.date);
      if(!after||JSON.stringify(after.censusConference??null)!==JSON.stringify(before.censusConference)){
        await client.query("ROLLBACK");return res.status(422).json({error:"CENSUS_CONFERENCE_IMMUTABLE",date:before.date,message:"Conferência histórica protegida; use fluxo supervisionado de retificação."});
      }
    }
    for(const after of newDaily){
      if(!after?.censusConference)continue;
      const before=oldDaily.find(d=>d?.date===after.date);
      const verdict=validateConferenceMutation({before,after,referenceDate:after.date,now:serverNow});
      if(!verdict.ok){await client.query("ROLLBACK");return res.status(422).json({error:verdict.code,date:after.date,message:verdict.reason||"Conferência inválida."});}
      if(verdict.changed){after.censusConference.registeredAt=serverNow.toISOString();after.censusConference.registeredBy=req.user.u;}
    }
    for(const daily of newDaily){
      if(!daily||typeof daily.date!=="string"||!/^\\d{4}-\\d{2}-\\d{2}$/.test(daily.date))continue;
      const admissions=Number(daily.admissoes);
      if(!Number.isSafeInteger(admissions)||admissions<0)continue;
      const previous=Array.isArray(oldDaily)?oldDaily.find(d=>d.date===daily.date):null;
      if(previous&&Number(previous.admissoes)===admissions)continue;
      await client.query(`INSERT INTO siash_daily_admission_records(reference_date,admission_count,ever_admitted,recorded_by)
       VALUES($1,$2,$3,$4) ON CONFLICT(reference_date) DO UPDATE
       SET admission_count=EXCLUDED.admission_count,ever_admitted=siash_daily_admission_records.ever_admitted OR EXCLUDED.ever_admitted,
       recorded_at=NOW(),recorded_by=EXCLUDED.recorded_by`,[daily.date,admissions,admissions>0,req.user.u]);
    }
    const pipaAudit=reconcilePipaAudit(cur.rows[0].payload,payload,req.user.u);
    if(pipaAudit.error){await client.query("ROLLBACK");return res.status(422).json({error:pipaAudit.error});}
    for(const event of pipaAudit.events){
      await client.query("INSERT INTO siash_pipa_cancellation_audit(username,record_index,record_before,reason,state_revision) VALUES($1,$2,$3,$4,$5)",[req.user.u,event.index,event.before,event.reason,current+1]);
    }
    await client.query("INSERT INTO siash_state_history(payload,saved_by,reason) VALUES($1,$2,$3)",[cur.rows[0].payload,req.user.u,req.body?.reason||"Antes de atualização do estado"]);
    const updated=await client.query("UPDATE siash_state SET payload=$1,updated_at=NOW(),updated_by=$2,revision=revision+1 WHERE id=1 RETURNING revision,updated_at",[payload,req.user.u]);
    await client.query("COMMIT");
    return res.json({ok:true,revision:Number(updated.rows[0].revision),updated_at:updated.rows[0].updated_at,pipa_cancellations:pipaAudit.events.map(e=>({index:e.index,cancelledAt:payload.state.pipa[e.index].cancelledAt,cancelledBy:req.user.u,cancelReason:payload.state.pipa[e.index].cancelReason}))});
  }catch(e){try{await client.query("ROLLBACK")}catch(_){}throw e}finally{client.release()}
});
app.put("/api/state/init",auth,async(req,res)=>{
  const payload=req.body?.payload;
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
    return res.status(400).json({error:"Estado inválido."});
  // Inicialização atômica: dois usuários não podem criar simultaneamente o estado central.
  const created=await pool.query(
    "INSERT INTO siash_state(id,payload,updated_by) VALUES(1,$1,$2) ON CONFLICT (id) DO NOTHING RETURNING revision",
    [payload,req.user.u]
  );
  if(!created.rows.length)return res.status(409).json({error:"Banco central já possui dados.",conflict:true});
  await audit(req.user.u,"Migração inicial para banco central.");
  res.json({ok:true,revision:Number(created.rows[0].revision)});
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
function normalizeComparableText(s=""){return normalizedText(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/^[✓✔•·\-–—\s]+/,"").replace(/\s*([;,.])\s*/g,"$1")}
function removeDocxParagraphs(buf,indexes=[]){
  const remove=new Set((indexes||[]).map(Number)),zip=new AdmZip(buf),entry=zip.getEntry("word/document.xml");if(!entry||!remove.size)return buf;
  let idx=-1;const xml=entry.getData().toString("utf8"),patched=xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{idx++;return remove.has(idx)?"":p;});
  zip.updateFile("word/document.xml",Buffer.from(patched,"utf8"));return zip.toBuffer();
}
function orphanCheckmarkParagraphIndexes(buf){
  const zip=new AdmZip(buf),entry=zip.getEntry("word/document.xml");if(!entry)return [];
  const blocks=[...entry.getData().toString("utf8").matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m,index)=>({index,xml:m[0],text:[...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x=>xmlDecode(x[1])).join("").replace(/\s+/g," ").trim(),numbered:/<w:numPr>[\s\S]*?<w:numId\s+w:val="\d+"\s*\/>[\s\S]*?<\/w:numPr>/.test(m[0])}));
  const section5=blocks.find(p=>/^5\s*[-.)]?\s*descri[cç][aã]o do procedimento/i.test(p.text)),section6=blocks.find(p=>/^6\s*[-.)]?\s*procedimentos essenciais/i.test(p.text)),section7=blocks.find(p=>/^7\s*[-.)]?\s*n[aã]o conformidade/i.test(p.text));
  const inTargetScope=index=>(section5&&section6&&index>section5.index&&index<section6.index)||(section6&&section7&&index>section6.index&&index<section7.index);
  return blocks.filter(p=>inTargetScope(p.index)&&p.numbered&&!p.text).map(p=>p.index);
}
function targetedFinalWordCleanup(buf){
  const paragraphs=docxParagraphs(buf),removeIndexes=new Set(),repairs=[];
  const sectionStart=paragraphs.findIndex(p=>/^(?:6\s*[-.)]?\s*)?procedimentos essenciais/i.test(String(p.text||"").trim())),sectionEnd=paragraphs.findIndex((p,i)=>i>sectionStart&&/^7\s*[-.)]?\s*/.test(String(p.text||"").trim()));
  if(sectionStart>=0){
    const scope=paragraphs.slice(sectionStart,sectionEnd>sectionStart?sectionEnd:paragraphs.length),complete=scope.find(p=>/antes de tocar o paciente/i.test(p.text)&&/antes de realizar procedimento limpo/i.test(p.text)&&/ap[oó]s risco de exposi[cç][aã]o a fluidos/i.test(p.text)&&/ap[oó]s tocar o paciente/i.test(p.text)&&/ap[oó]s tocar superf[ií]cies pr[oó]ximas/i.test(p.text));
    if(complete){
      let afterComplete=false;
      for(const p of scope){
        if(p.index===complete.index){afterComplete=true;continue}if(!afterComplete)continue;
        const t=String(p.text||"").trim();
        const repeatedMoment=/^[✓✔•·\s]*[a-e]\s*[).:-]/i.test(t)&&/antes de tocar o paciente|antes de realizar procedimento limpo|ap[oó]s risco de exposi[cç][aã]o a fluidos|ap[oó]s tocar o paciente|ap[oó]s tocar superf[ií]cies pr[oó]ximas/i.test(t);
        const repeatedDrying=/friccionar a prepara[cç][aã]o alco[oó]lica em todas as superf[ií]cies das m[aã]os at[eé] a secagem completa/i.test(t);
        if(repeatedMoment||repeatedDrying){removeIndexes.add(p.index);repairs.push(`Removido parágrafo redundante da seção 6: ${p.index}.`);}
      }
    }
  }
  for(const p of paragraphs){
    if(/repetir todo o sequ[eê]ncia para a m[aã]o esquerda/i.test(p.text)){removeIndexes.add(p.index);repairs.push(`Removida integralmente a etapa redundante do parágrafo ${p.index}.`);}
  }
  for(const index of orphanCheckmarkParagraphIndexes(buf)){removeIndexes.add(index);repairs.push(`Removido marcador ✓ órfão do parágrafo ${index}.`);}
  if(!removeIndexes.size)return {buffer:buf,repairs:[]};
  return {buffer:removeDocxParagraphs(buf,[...removeIndexes]),repairs};
}
function advisoryFinalDocumentQuality(buf){
  const paragraphs=docxParagraphs(buf),warnings=[];
  const seen=new Map();
  for(const p of paragraphs){
    const key=normalizeComparableText(p.text);if(key.length<28)continue;
    if(seen.has(key))warnings.push(`Conteúdo textual duplicado para conferência: parágrafos ${seen.get(key)} e ${p.index}.`);else seen.set(key,p.index);
  }
  const fiveMomentLines=paragraphs.filter(p=>/antes de tocar o paciente|antes de realizar procedimento limpo|ap[oó]s risco de exposi[cç][aã]o a fluidos|ap[oó]s tocar o paciente|ap[oó]s tocar superf[ií]cies pr[oó]ximas/i.test(p.text));
  const compact=fiveMomentLines.map(p=>normalizeComparableText(p.text));
  if(compact.length>1){const repeated=compact.filter((x,i,a)=>a.findIndex(y=>y===x)!==i);if(repeated.length)warnings.push("A lista dos 5 Momentos aparece repetida no estado final e deve ser conferida antes da publicação.");}
  return {ok:warnings.length===0,warnings:[...new Set(warnings)]};
}
function appendVerificationWarnings(verification,check){
  if(!verification||check?.ok!==false)return verification;
  verification.validationWarnings=[...new Set([...(verification.validationWarnings||[]),...(check.warnings||[])].filter(Boolean))];
  verification.requiresProfessionalReview=true;return verification;
}
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
function normalizeReferenceHeadingText(text=""){
  return normalizedText(text)
    .replace(/\u00a0/g," ")
    .replace(/[\u200B-\u200D\uFEFF]/g,"")
    .replace(/^[\s\u2022\u25CF\u25AA\u25E6\-–—]+/,"")
    .replace(/\s+/g," ")
    .trim();
}
function isReferenceHeading(text=""){
  const t=normalizeReferenceHeadingText(text);
  // Aceita variações institucionais comuns sem aceitar frases de conteúdo.
  // Exemplos: "8. REFERÊNCIAS", "8 - REFERÊNCIAS BIBLIOGRÁFICAS",
  // "REFERÊNCIAS:", "REFERÊNCIAS BIBLIOGRÁFICAS" e "BIBLIOGRAFIA".
  return /^(?:\d{1,2}(?:\.\d{1,2})*\s*(?:[-–—.):]|\.)?\s*)?(?:refer[eê]ncias?(?:\s+(?:bibliogr[aá]ficas?|t[eé]cnicas?|normativas?))?|bibliografia)\s*[:.;-]?\s*$/i.test(t);
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
  const semanticDuplicatePairs=[];for(let i=0;i<bib.length;i++)for(let j=i+1;j<bib.length;j++)if(sameBibliographicWork(bib[i],bib[j]))semanticDuplicatePairs.push([i,j]);
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
  return {buffer:out,added:managedTexts.length,moved:managedLegacy.filter(x=>!inSection(x.index)).length,sectionHeadingIndex:outSec.headingIndex,labelsRemoved:managedLegacy.length,coverage,representedByInstitutional:representedByInstitutional.length,genericReferencesRemoved:genericBibliography.length+legacyRejected.length,semanticDuplicateReferences:semanticDuplicatePairs.length,legacyGenericReferencesRejected:legacyRejected.length,wordEligibleReferences:wordRefs.length};
}
function bibliographyHygieneState(buf){
  try{
    const paras=docxParagraphs(buf),sec=referenceSectionInfo(paras);if(!sec)return {needsHygiene:false,generic:0,managed:0};
    const generic=paras.filter(p=>p.index>sec.headingIndex&&(sec.stopIndex==null||p.index<sec.stopIndex)&&!!referenceUrlFromText(p.text)&&isGenericReferenceUrl(referenceUrlFromText(p.text))).length;
    const managed=paras.filter(p=>isManagedReferenceText(p.text)).length;
    return {needsHygiene:(generic+managed)>0,generic,managed};
  }catch{return {needsHygiene:false,generic:0,managed:0}}
}
function institutionalStructureProtectedText(text=""){
  const t=normalizedText(text);
  if(!t)return false;
  if(/^(?:\\d+\\s*[-.)–—:]\\s*)?(?:resultados? esperados?|refer[eê]ncias?|objetivo|finalidade|abrang[eê]ncia|responsabilidades?|defini[cç][oõ]es?|materiais?|procedimentos?|descri[cç][aã]o|registros?|indicadores?|anexos?)\\s*:?$/i.test(t))return true;
  return /^(?:FUNDAÇÃO HOSPITALAR|PROCEDIMENTO OPERACIONAL PADRÃO|CÓDIGO|REGISTRO|REVISÃO|ELABORAÇÃO|VERIFICAÇÃO|APROVAÇÃO|ASSINATURA|HISTÓRICO)/i.test(t);
}
function comparisonNormalizedText(text=""){
  return normalizedText(text).normalize("NFKC").replace(/[“”„‟]/g,'"').replace(/[‘’‚‛]/g,"'").replace(/\\s+/g," ").trim();
}
function effectiveAIUpdates(paragraphs,updates,allowed){
  const originalByIndex=new Map(paragraphs.map(p=>[Number(p.index),String(p.text||"")]));
  const dedup=new Map();
  for(const u of updates||[]){
    const index=Number(u?.paragraph_index),newText=String(u?.new_text||"").trim();
    if(!allowed.has(index)||!newText)continue;
    const before=originalByIndex.get(index);if(before==null)continue;
    if(institutionalStructureProtectedText(before))continue;
    if(comparisonNormalizedText(before)===comparisonNormalizedText(newText))continue;
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
function primaryScientificInstitution(raw=""){
  const host=sourceHostname(raw),u=String(raw||"").toLowerCase();
  if(!host)return "";
  if(domainMatches(host,"who.int"))return "WHO";
  if(domainMatches(host,"paho.org")||domainMatches(host,"opas.org.br"))return "OPAS";
  if(domainMatches(host,"anvisa.gov.br")||(domainMatches(host,"gov.br")&&u.includes("/anvisa/")))return "ANVISA";
  if(domainMatches(host,"saude.gov.br")||(domainMatches(host,"gov.br")&&u.includes("/saude/")))return "MS";
  if(domainMatches(host,"fiocruz.br"))return "FIOCRUZ";
  if(domainMatches(host,"cofen.gov.br")||host.includes("coren-"))return "COFEN_COREN";
  if(domainMatches(host,"sbp.com.br"))return "SBP";
  return "";
}
async function researchWithTavily(prompt,queryOverride=""){
  if(!TAVILY_API_KEY)throw new Error("TAVILY_API_KEY não configurada no servidor.");
  const query=String(queryOverride||prompt||"").replace(/\s+/g," ").trim().slice(0,400);
  if(!query)throw new Error("Não foi possível montar a consulta científica para o Tavily.");

  let ranked=[],official=[],lastSearchError=null;
  // v0.14.42 — a pesquisa científica não deve cair inteira se apenas uma consulta Tavily falhar.
  // Tenta a busca geral e, independentemente do resultado, complementa com busca oficial restrita
  // quando ainda não houver base primária suficiente.
  try{
    const first=await tavilySearchRequest(query);
    ranked=rankScientificSources(Array.isArray(first.results)?first.results:[]);
    official=ranked.filter(r=>primaryScientificInstitution(r.url));
  }catch(e){
    lastSearchError=e;
    console.warn(`[SIASH AI] Tavily busca geral falhou; tentando busca oficial restrita | motivo=${String(e?.message||"falha").replace(/\s+/g," ").slice(0,300)}`);
  }

  if(official.length<2){
    try{
      const second=await tavilySearchRequest(query,{include_domains:SCIENTIFIC_PREFERRED_DOMAINS});
      const merged=[...ranked,...rankScientificSources(Array.isArray(second.results)?second.results:[])];
      const seen=new Set();
      ranked=merged.filter(r=>{const u=normalizeUrl(r.url);if(!u||seen.has(u))return false;seen.add(u);return true})
        .sort((a,b)=>b._tier-a._tier||a._originalIndex-b._originalIndex);
      official=ranked.filter(r=>primaryScientificInstitution(r.url));
    }catch(e){
      lastSearchError=e;
      console.warn(`[SIASH AI] Tavily busca oficial restrita falhou | motivo=${String(e?.message||"falha").replace(/\s+/g," ").slice(0,300)}`);
    }
  }
  if(!ranked.length&&lastSearchError)throw lastSearchError;

  // Para POP assistencial, fontes oficiais/primárias formam a base. Fontes secundárias
  // só complementam quando já existem ao menos duas fontes oficiais verificáveis.
  if(official.length<2)throw new Error("Pesquisa científica bloqueada: não foram localizadas pelo menos 2 fontes primárias de autoridades técnico-científicas reconhecidas.");
  // v0.14.35: em POP assistencial, a evidência entregue ao modelo é somente oficial/primária.
  // Fontes secundárias podem ser descobertas na busca, mas não sustentam alteração clínica.
  const selected=official.slice(0,6);
  const sources=selected.map((r,i)=>({
    sourceId:`FONTE_${i+1}`,
    title:String(r.title||"Fonte web").trim(),
    url:String(r.url||"").trim(),
    content:String(r.content||"").trim(),
    sourceTier:r._tier,
    sourceHost:sourceHostname(r.url),
    sourceInstitution:primaryScientificInstitution(r.url)
  }));

  const evidence=sources.map(s=>`[${s.sourceId}]\nInstituição oficial: ${s.sourceInstitution}\nTítulo: ${s.title}\nURL: ${s.url}\nConteúdo: ${s.content}`).join("\n\n");
  console.log(`[SIASH AI] pesquisa Tavily concluída | fontes=${sources.length} | oficiais=${official.length} | política=scientific_source_governance_v1`);
  return {sources,evidence,researchMode:"tavily_search"};
}
function sourceInstitutionFamily(raw=""){return primaryScientificInstitution(raw)}
function claimedInstitutionFamilies(text=""){
  const t=normalizedText(text).toUpperCase(),out=new Set();
  if(/\b(?:OMS|WHO|ORGANIZAÇÃO MUNDIAL DA SAÚDE)\b/.test(t))out.add("WHO");
  if(/\b(?:OPAS|PAHO|ORGANIZAÇÃO PAN-AMERICANA DA SAÚDE)\b/.test(t))out.add("OPAS");
  if(/\bANVISA\b/.test(t))out.add("ANVISA");
  if(/\b(?:MINISTÉRIO DA SAÚDE|MINISTERIO DA SAUDE)\b/.test(t))out.add("MS");
  if(/\bFIOCRUZ\b/.test(t))out.add("FIOCRUZ");
  if(/\b(?:COFEN|COREN)\b/.test(t))out.add("COFEN_COREN");
  if(/\b(?:SBP|SOCIEDADE BRASILEIRA DE PEDIATRIA)\b/.test(t))out.add("SBP");
  return [...out];
}
function foldClinicalText(text=""){return normalizedText(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function enforceClinicalSequenceIntegrity(updates=[],baselineParagraphs=[]){
  const baseline=new Map((baselineParagraphs||[]).map(p=>[Number(p.index),String(p.text||"")]));
  const finalMap=new Map(baseline);
  for(const u of updates||[])if(Number.isInteger(Number(u.paragraph_index)))finalMap.set(Number(u.paragraph_index),String(u.new_text||""));
  const proposed=(updates||[]).map(u=>foldClinicalText(u.new_text)).filter(Boolean);
  const reasons=(updates||[]).map(u=>foldClinicalText(u.reason)).filter(Boolean);
  // v0.14.46 — listas clínicas são validadas no documento final, não apenas no delta de updates.
  // Em correções da Rev.02, itens corretos podem permanecer inalterados e por isso não aparecem
  // em updates; exigir que todos estivessem no delta tornava uma correção válida impossível.
  const finalTexts=[...finalMap.values()].map(foldClinicalText).filter(Boolean);
  const combined=(finalTexts.length?finalTexts:proposed).join(" | ");
  const mentionsFiveMoments=[...finalTexts,...proposed,...reasons].some(t=>/5 momentos|cinco momentos/.test(t));
  if(mentionsFiveMoments){
    const required=[
      ["1 - antes de tocar o paciente",/antes (?:de )?(?:tocar|contato com) (?:o )?paciente/],
      ["2 - antes de procedimento limpo/asséptico",/antes (?:de |da |do )?(?:realizar )?(?:procedimento )?(?:limpo|asseptico)/],
      ["3 - após risco de exposição a fluidos corporais",/apos (?:o )?(?:risco de )?exposicao a fluidos corporais/],
      ["4 - após tocar o paciente",/apos (?:tocar|o contato com) (?:o )?paciente/],
      ["5 - após tocar superfícies próximas ao paciente",/apos (?:tocar|o contato com) (?:objetos|superficies|areas|o ambiente|ambiente).{0,45}(?:proxim|entorno|paciente)/]
    ];
    // v0.14.48 — se houver seção textual "Procedimentos essenciais", a lista deve estar completa ali.
    // Texto em imagem, referência ou outra seção não pode mascarar uma lista clínica editável incompleta.
    let momentScope=combined;
    const sectionStart=finalTexts.findIndex(t=>/^(?:6\s*[-.)]?\s*)?procedimentos essenciais/.test(t));
    if(sectionStart>=0){
      let sectionEnd=finalTexts.findIndex((t,i)=>i>sectionStart&&/^7\s*[-.)]?\s*/.test(t));
      if(sectionEnd<0)sectionEnd=finalTexts.length;
      momentScope=finalTexts.slice(sectionStart,sectionEnd).join(" | ");
    }
    const missing=required.filter(([,rx])=>!rx.test(momentScope)).map(([label])=>label);
    if(missing.length){const err=new Error(`Integridade clínica bloqueada: a lista textual editável dos 5 momentos está incompleta. Ausente(s): ${missing.join("; ")}. Conteúdo presente apenas em imagem não satisfaz esta validação.`);err.code="CLINICAL_SEQUENCE_INTEGRITY_REJECTED";throw err;}
    const positions=required.map(([,rx])=>{const m=momentScope.match(rx);return m?momentScope.indexOf(m[0]):-1});
    if(positions.some((p,i)=>i>0&&p<=positions[i-1])){const err=new Error("Integridade clínica bloqueada: os 5 momentos estão fora da ordem oficial no texto editável (1 antes de tocar o paciente; 2 antes de procedimento limpo/asséptico; 3 após risco de fluidos; 4 após tocar o paciente; 5 após superfícies próximas).");err.code="CLINICAL_SEQUENCE_INTEGRITY_REJECTED";throw err;}
    const numbered=reasons.map((t,i)=>({i,n:Number(t.match(/(?:primeiro|1º|1o|1°)/)?1:t.match(/(?:segundo|2º|2o|2°)/)?2:t.match(/(?:terceiro|3º|3o|3°)/)?3:t.match(/(?:quarto|4º|4o|4°)/)?4:t.match(/(?:quinto|5º|5o|5°)/)?5:0),text:proposed[i]||""})).filter(x=>x.n);
    const expected=[null,/antes (?:de )?(?:tocar|contato com) (?:o )?paciente/,/antes (?:de |da |do )?(?:realizar )?(?:procedimento )?(?:limpo|asseptico)/,/apos (?:o )?(?:risco de )?exposicao a fluidos corporais/,/apos (?:tocar|o contato com) (?:o )?paciente/,/apos (?:tocar|o contato com) (?:objetos|superficies|areas|o ambiente|ambiente).{0,45}(?:proxim|entorno|paciente)/];
    const mismatch=numbered.find(x=>!expected[x.n].test(x.text));
    if(mismatch){const err=new Error(`Integridade clínica bloqueada: a justificativa identifica incorretamente o momento ${mismatch.n} em relação ao texto proposto.`);err.code="CLINICAL_SEQUENCE_INTEGRITY_REJECTED";throw err;}
  }
  const repeatLeft=finalTexts.filter(t=>/repetir.{0,80}(?:mao esquerda|sequencia para a mao esquerda)/.test(t));
  if(repeatLeft.length>1){const err=new Error("Integridade clínica bloqueada: o texto final contém instruções redundantes para repetir a sequência na mão esquerda.");err.code="CLINICAL_SEQUENCE_INTEGRITY_REJECTED";throw err;}
  for(const u of updates||[]){
    const before=String(baseline.get(Number(u.paragraph_index))||u.old_text||"");
    if(/polpas digitais|unhas/i.test(before)){
      const after=foldClinicalText(u.new_text);
      if(!/(ponta|polpa).{0,30}dedos|unhas/.test(after)){const err=new Error(`Integridade clínica bloqueada: o parágrafo ${u.paragraph_index} continha etapa de polpas digitais/unhas e a proposta a substituiu sem preservar essa etapa.`);err.code="CLINICAL_SEQUENCE_INTEGRITY_REJECTED";throw err;}
    }
    if(/^\s*\d+\s*[-.)]?\s*(descri[cç][aã]o|procedimento)/i.test(before)&&!/^\s*\d+\s*[-.)]?\s*(descri[cç][aã]o|procedimento)/i.test(String(u.new_text||""))){const err=new Error(`Integridade estrutural bloqueada: o parágrafo ${u.paragraph_index} é um cabeçalho de procedimento e não pode ser substituído por uma etapa clínica.`);err.code="CLINICAL_SEQUENCE_INTEGRITY_REJECTED";throw err;}
  }
  return true;
}
function validateClinicalAdvisory(updates=[],baselineParagraphs=[]){
  try{enforceClinicalSequenceIntegrity(updates,baselineParagraphs);return {ok:true,warnings:[]};}
  catch(e){if(e?.code!=="CLINICAL_SEQUENCE_INTEGRITY_REJECTED")throw e;const warning=String(e?.message||"Revisão clínica recomendada.");console.warn(`[SIASH AI] alerta clínico para conferência profissional | ${warning.replace(/\\s+/g," ").slice(0,500)}`);return {ok:false,warnings:[warning]};}
}
function deterministicFiveMomentsRepair(updates=[],baselineParagraphs=[],sources=[]){
  const baseline=new Map((baselineParagraphs||[]).map(p=>[Number(p.index),String(p.text||"")])),finalMap=new Map(baseline);for(const u of updates||[])if(Number.isInteger(Number(u.paragraph_index)))finalMap.set(Number(u.paragraph_index),String(u.new_text||""));
  const ordered=[...finalMap.entries()].sort((a,b)=>a[0]-b[0]);let start=ordered.findIndex(([,t])=>/^(?:6\s*[-.)]?\s*)?procedimentos essenciais/i.test(String(t).trim()));if(start<0)start=ordered.findIndex(([,t])=>/seguintes casos/i.test(String(t)));if(start<0)return updates;let end=ordered.findIndex(([,t],i)=>i>start&&/^7\s*[-.)]?\s*/.test(String(t).trim()));if(end<0)end=ordered.length;const scope=ordered.slice(start,end);let cases=scope.findIndex(([,t])=>/seguintes casos/i.test(String(t)));if(cases<0)cases=-1;
  const canonical=["a) Antes de tocar o paciente;","b) Antes de realizar procedimento limpo/asséptico;","c) Após risco de exposição a fluidos corporais;","d) Após tocar o paciente;","e) Após tocar superfícies próximas ao paciente."],momentRx=[/antes (?:de )?(?:tocar|contato com) (?:o )?paciente/i,/antes (?:de |da |do )?(?:realizar )?(?:procedimento )?(?:limpo|ass[eé]ptico)/i,/ap[oó]s (?:o )?(?:risco de )?exposi[cç][aã]o a fluidos corporais/i,/ap[oó]s (?:tocar|o contato com) (?:o )?paciente/i,/ap[oó]s (?:tocar|o contato com) (?:objetos|superf[ií]cies|[aá]reas|o ambiente|ambiente).{0,45}(?:pr[oó]xim|entorno|paciente)/i];let candidate=scope.slice(cases+1).filter(([,t])=>momentRx.some(rx=>rx.test(String(t)))).slice(0,5);if(candidate.length<4){candidate=scope.slice(cases+1).filter(([,t])=>/^[a-e]\s*[).:-]/i.test(String(t).trim())).slice(0,5);}if(candidate.length<4)return updates;
  const refs=(sources||[]).filter(x=>primaryScientificInstitution(x.url)).slice(0,2).map(x=>x.url).filter(Boolean),byIndex=new Map((updates||[]).map(u=>[Number(u.paragraph_index),u]));for(let i=0;i<Math.min(5,candidate.length);i++){const idx=candidate[i][0],old=String(baseline.get(idx)||candidate[i][1]||"");byIndex.set(idx,{...(byIndex.get(idx)||{}),paragraph_index:idx,old_text:old,new_text:canonical[i],reason:"Correção determinística da lista textual dos 5 Momentos para Higiene das Mãos na ordem oficial, preservando a revisão proposta.",references:refs});}if(candidate.length===4){const lastIdx=candidate[3][0],last=byIndex.get(lastIdx);last.new_text=canonical[3]+" "+canonical[4];byIndex.set(lastIdx,last);}return [...byIndex.values()];
}
function normalizeOfficialUpdateReferences(updates=[],sources=[]){
  const byId=new Map((sources||[]).map(src=>[String(src.sourceId||"").toUpperCase(),src])),byUrl=new Map((sources||[]).map(src=>[normalizeUrl(src.url),src]));
  return (updates||[]).map(update=>({...update,references:(Array.isArray(update.references)?update.references:[]).map(ref=>{const raw=String(ref||"").trim(),exact=raw.toUpperCase().match(/^FONTE_(\d+)$/),src=exact?byId.get(`FONTE_${exact[1]}`):byUrl.get(normalizeUrl(raw));return src&&primaryScientificInstitution(src.url)?src.url:"";}).filter(Boolean)}));
}
function enforceScientificClaimSourceBinding(updates=[],sources=[]){
  const byUrl=new Map(sources.map(s=>[normalizeUrl(s.url),s]));
  const failures=[];
  for(const u of updates){
    const refs=(u.references||[]).map(normalizeUrl).filter(Boolean);
    const linked=refs.map(x=>byUrl.get(x)).filter(Boolean);
    if(!linked.length){failures.push({paragraph:u.paragraph_index,reason:"sem fonte oficial vinculada"});continue}
    if(linked.some(s=>!primaryScientificInstitution(s.url))){
      failures.push({paragraph:u.paragraph_index,reason:"fonte secundária não pode sustentar alteração clínica"});continue;
    }
    // A vinculação institucional deve validar a afirmação clínica que entrará no POP.
    // A justificativa é metadado de auditoria e pode comparar instituições/fontes; usá-la
    // como se fosse texto publicado gerava falso bloqueio de rastreabilidade.
    const claims=claimedInstitutionFamilies(u.new_text);
    for(const family of claims){
      if(!linked.some(s=>sourceInstitutionFamily(s.url)===family)){
        failures.push({paragraph:u.paragraph_index,reason:`texto proposto atribui evidência a ${family}, mas nenhuma URL vinculada pertence a essa instituição`});
        break;
      }
    }
  }
  if(failures.length){const err=new Error(`Rastreabilidade científica bloqueada: ${failures.map(x=>`parágrafo ${x.paragraph} (${x.reason})`).join("; ")}. Use a fonte primária da própria instituição citada.`);err.code="SCIENTIFIC_BINDING_REJECTED";throw err;}
  return true;
}
function validateScientificAdvisory(updates=[],sources=[]){
  try{enforceScientificClaimSourceBinding(updates,sources);return {ok:true,warnings:[]};}
  catch(e){
    if(e?.code!=="SCIENTIFIC_BINDING_REJECTED")throw e;
    const warning=String(e?.message||"Conferência de rastreabilidade científica recomendada.");
    console.warn(`[SIASH AI] alerta científico para conferência profissional | ${warning.replace(/\\s+/g," ").slice(0,500)}`);
    return {ok:false,warnings:[warning]};
  }
}
function appendProfessionalReviewWarnings(result,check){
  if(!result||check?.ok!==false)return;
  const merged=[...(result.validationWarnings||[]),...(check.warnings||[])].filter(Boolean);
  result.validationWarnings=[...new Set(merged)];
  result.requiresProfessionalReview=true;
}
async function runAIRevision(prompt,requested,options={}){
  const errors=[];
  const order=providerOrder(requested);
  const requireWebResearch=options?.requireWebResearch===true;
  const simulatedUnavailable=new Set(Array.isArray(options?.simulateUnavailable)?options.simulateUnavailable.map(x=>String(x).toLowerCase()):[]);
  const diagnostic=options?.diagnostic===true;
  const scientificRejections=[];
  const clinicalRejections=[];
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
        "REGRA DE ATRIBUIÇÃO INSTITUCIONAL: cada FONTE_N informa sua Instituição oficial. No new_text, só atribua uma recomendação nominalmente a uma instituição quando references incluir uma FONTE_N dessa mesma instituição. Se ela não estiver nas evidências, redija a recomendação sem atribuição nominal e registre a limitação no summary. Na reason, descreva a justificativa sem criar atribuições científicas novas.",
        "REGRA DE INTEGRIDADE DE SEQUÊNCIA CLÍNICA: antes de devolver updates, valide o procedimento como um conjunto. Se atualizar uma lista clínica padronizada (por exemplo, os 5 momentos da higiene das mãos) preserve TODOS os itens, a ordem oficial e a correspondência entre new_text e reason. Nunca substitua uma etapa técnica por outra diferente (por exemplo, polpas digitais/unhas por punhos). Se não houver parágrafo editável suficiente para preservar o conjunto completo, não improvise: registre a limitação no summary.",
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
            .map(src=>({title:src.title,url:src.url,sourceTier:src.sourceTier,sourceHost:src.sourceHost,sourceInstitution:src.sourceInstitution}));
          appendProfessionalReviewWarnings(ai.result,validateScientificAdvisory(ai.result.updates,webResearch.sources||[]));
        }
        const merged=[...(webResearch.sources||[]),...(Array.isArray(ai.sources)?ai.sources:[])];
        ai.sources=[...new Map(merged.filter(x=>x&&x.url).map(x=>[String(x.url).trim(),x])).values()];
        ai.researchMode="tavily_search";
      }
      // v0.14.53 — reparar padrões clínicos conhecidos antes de bloquear; integridade clínica é obrigatória mesmo sem pesquisa web; validar sempre o estado final.
      if(ai?.result&&Array.isArray(ai.result.updates)){
        ai.result.updates=deterministicFiveMomentsRepair(ai.result.updates,options?.editableParagraphs||[],webResearch?.sources||[]);
        if(webResearch){ai.result.updates=normalizeOfficialUpdateReferences(ai.result.updates,webResearch.sources||[]);appendProfessionalReviewWarnings(ai.result,validateScientificAdvisory(ai.result.updates,webResearch.sources||[]));}
        appendProfessionalReviewWarnings(ai.result,validateClinicalAdvisory(ai.result.updates,options?.editableParagraphs||[]));
      }
      console.log(`[SIASH AI${diagnostic?" TEST":""}] proposta concluída | provider=${ai.provider} | model=${ai.model} | researchMode=${ai.researchMode||"provider_default"}`);
      return ai;
    }catch(e){
      const msg=String(e?.message||"falha").replace(/\s+/g," ").slice(0,500);
      if(e?.code==="SCIENTIFIC_BINDING_REJECTED"||e?.code==="CLINICAL_SEQUENCE_INTEGRITY_REJECTED"){
        const validationKind=e.code==="SCIENTIFIC_BINDING_REJECTED"?"rastreabilidade científica":"integridade clínica";
        const rejectionBucket=e.code==="SCIENTIFIC_BINDING_REJECTED"?scientificRejections:clinicalRejections;
        rejectionBucket.push({provider:p,message:msg});
        console.warn(`[SIASH AI${diagnostic?" TEST":""}] proposta rejeitada pela validação | tipo=${validationKind} | provider=${p} | motivo=${msg}`);
        // v0.14.47 — validações são parte do pipeline, não "indisponibilidade do provedor".
        // O mesmo modelo recebe o erro determinístico e pode reparar a proposta usando exatamente
        // as mesmas fontes e o mesmo baseline. Só depois de falhar no reparo ocorre fallback.
        if(webResearch){
          try{
            const repairPrompt=[
              revisionPrompt,
              "",
              "REPARO OBRIGATÓRIO DE VALIDAÇÃO SIASH:",
              `TIPO: ${validationKind}`,
              `ERRO DETERMINÍSTICO: ${msg}`,
              "Regenere a proposta corrigindo exatamente o erro acima. Preserve as partes já corretas do documento-base. Não invente fonte, não substitua cabeçalhos por etapas e não elimine etapas clínicas obrigatórias. Cada update científico deve citar FONTE_N oficial compatível. Se uma alteração não puder ser sustentada, remova apenas essa alteração."
            ].join("\n");
            let repaired=null;
            if(p==="gemini"&&GEMINI_API_KEY)repaired=await reviseWithGemini(repairPrompt);
            else if(p==="cloudflare"&&cloudflareConfigured())repaired=await reviseWithCloudflare(repairPrompt);
            else if(p==="openai"&&openaiClient)repaired=await reviseWithOpenAI(repairPrompt);
            if(repaired?.result&&Array.isArray(repaired.result.updates)){
              if(e?.code==="CLINICAL_SEQUENCE_INTEGRITY_REJECTED")repaired.result.updates=deterministicFiveMomentsRepair(repaired.result.updates,options?.editableParagraphs||[],webResearch.sources||[]);
              repaired.result.updates=normalizeOfficialUpdateReferences(repaired.result.updates,webResearch.sources||[]);
              const tavilyById=new Map((webResearch.sources||[]).map(src=>[String(src.sourceId||"").toUpperCase(),src]));
              const usedSourceUrls=new Set();
              repaired.result.updates=repaired.result.updates.map(update=>({...update,references:(Array.isArray(update.references)?update.references:[]).map(ref=>{const raw=String(ref||"").trim();const exact=raw.toUpperCase().match(/^FONTE_(\d+)$/);const src=exact?tavilyById.get(`FONTE_${exact[1]}`):null;if(src){usedSourceUrls.add(src.url);return src.url}return raw}).filter(Boolean)}));
              repaired.result.references=(webResearch.sources||[]).filter(src=>usedSourceUrls.has(src.url)).map(src=>({title:src.title,url:src.url,sourceTier:src.sourceTier,sourceHost:src.sourceHost,sourceInstitution:src.sourceInstitution}));
              appendProfessionalReviewWarnings(repaired.result,validateScientificAdvisory(repaired.result.updates,webResearch.sources||[]));
              appendProfessionalReviewWarnings(repaired.result,validateClinicalAdvisory(repaired.result.updates,options?.editableParagraphs||[]));
              repaired.sources=[...new Map([...(webResearch.sources||[]),...(Array.isArray(repaired.sources)?repaired.sources:[])].filter(x=>x&&x.url).map(x=>[String(x.url).trim(),x])).values()];
              repaired.researchMode="tavily_search";
              console.log(`[SIASH AI${diagnostic?" TEST":""}] proposta reparada e revalidada | tipo=${validationKind} | provider=${p}`);
              return repaired;
            }
          }catch(repairError){
            const repairMsg=String(repairError?.message||"falha").replace(/\s+/g," ").slice(0,500);
            if(repairError?.code==="SCIENTIFIC_BINDING_REJECTED"){
              scientificRejections.push({provider:p,message:`reparo: ${repairMsg}`});
            }else if(repairError?.code==="CLINICAL_SEQUENCE_INTEGRITY_REJECTED"){
              clinicalRejections.push({provider:p,message:`reparo: ${repairMsg}`});
            }else{
              errors.push(`${p} repair: ${repairMsg}`);
            }
            console.warn(`[SIASH AI${diagnostic?" TEST":""}] reparo não aprovado | provider=${p} | code=${repairError?.code||"PROVIDER_ERROR"} | motivo=${repairMsg}`);
          }
        }
      }else console.warn(`[SIASH AI${diagnostic?" TEST":""}] provedor indisponível | provider=${p} | motivo=${msg}`);
      errors.push(`${p}: ${msg}`);
      const next=order[order.indexOf(p)+1];
      if(next)console.log(`[SIASH AI${diagnostic?" TEST":""}] iniciando fallback | de=${p} | para=${next}`);
    }
  }
  console.error(`[SIASH AI] todos os provedores falharam | ${errors.join(" | ")}`);
  if(requireWebResearch){
    const tavilyOk=!!webResearch;
    if(tavilyOk&&clinicalRejections.length){
      const err=new Error("A pesquisa oficial foi concluída, mas as propostas geradas não passaram pela validação de integridade clínica após tentativa automática de reparo. A revisão proposta foi preservada e nenhuma alteração foi publicada.");
      err.code="AI_CLINICAL_VALIDATION_REJECTED";
      err.details=clinicalRejections;
      throw err;
    }
    if(tavilyOk&&scientificRejections.length){
      const err=new Error("A pesquisa oficial foi concluída e houve resposta de IA, mas todas as propostas utilizáveis foram rejeitadas pela validação científica de rastreabilidade. A revisão proposta foi preservada e nenhuma alteração foi publicada.");
      err.code="AI_SCIENTIFIC_VALIDATION_REJECTED";
      err.details=scientificRejections;
      throw err;
    }
    const err=new Error(tavilyOk
      ? "A pesquisa web verificável da Tavily foi concluída, porém nenhum modelo de IA disponível conseguiu concluir uma proposta válida dentro dos limites atuais. A revisão proposta foi preservada e nenhuma alteração foi publicada."
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
    const correctionRequested=!!String(correction_request||"").trim();
    const requiresCurrentWebResearch=correctionRequested||periodicReviewRequired||scientificAudit?.status==="review"||scientificAudit?.status==="adjust";
    if(!doc_code||!file_base64)return res.status(400).json({error:"POP/arquivo não informado."});
    const original=Buffer.from(file_base64,"base64");if(original.length>18*1024*1024)return res.status(413).json({error:"Word acima do limite de 18 MB para revisão automática."});
    const historyCleanup=cleanDuplicateSiashHistoryRows(original),baseDocument=historyCleanup.buffer;
    const paragraphs=docxParagraphs(baseDocument);if(!paragraphs.length)return res.status(400).json({error:"Não foi possível extrair o texto do Word."});const hygieneBefore=bibliographyHygieneState(baseDocument);const latestReferenceYear=latestReferenceYearInDoc(paragraphs);
    const protectedRx=/(FUNDAÇÃO HOSPITALAR|PROCEDIMENTO OPERACIONAL PADRÃO|CÓDIGO|REGISTRO|REVISÃO|ELABORAÇÃO|VERIFICAÇÃO|APROVAÇÃO|ASSINATURA|HISTÓRICO)/i;
    const editable=paragraphs.filter(p=>!protectedRx.test(p.text)&&!institutionalStructureProtectedText(p.text));
    const prompt=`Você atua como revisor técnico-científico de POP hospitalar neonatal. Revise ${doc_code} — ${doc_title}, revisão atual ${current_revision}, para proposta ${next_revision}.\nREGRAS OBRIGATÓRIAS:\n1) Priorize referências oficiais e tecnicamente reconhecidas (ANVISA, Ministério da Saúde, Fundação Oswaldo Cruz/FIOCRUZ — especialmente IFF/Fiocruz quando pertinente à neonatologia —, COFEN/COREN, SBP, OMS/WHO, OPAS/PAHO, CDC e literatura revisada por pares quando pertinente). Não invente referências, URLs, normas ou recomendações.\n2) Não altere cabeçalho, identidade institucional, código, tabelas administrativas, histórico, campos de elaboração/verificação/aprovação/assinatura.\n3) Se não houver base suficiente para uma mudança, mantenha o texto.\n4) A saída é apenas PROPOSTA e nunca publicação automática.\n5) Retorne somente alterações técnico-científicas realmente necessárias. Cada paragraph_index deve existir na lista fornecida. Para cada alteração, preencha references com os títulos e/ou URLs das fontes que sustentam aquela alteração; use [] quando não houver fonte específica confiável.\n6) Preserve o sentido e a função de cada parágrafo; não mova seções.\n7) Nunca inclua dados de pacientes.\n8) Toda referência deve ser tratada como apoio à conferência humana; a validação profissional é obrigatória antes da publicação.\n9) NÃO mantenha, crie ou altere periodicidade, concentração, diluição, tempo de contato, compatibilidade de equipamento ou outra recomendação operacional específica sem fonte rastreável que sustente exatamente essa afirmação. Se a fonte disponível não sustentar o detalhe, mantenha o texto vigente e sinalize isso no summary.\n10) Cada alteração proposta DEVE possuir pelo menos uma referência específica em references. As referências gerais devem conter título e URL completos e rastreáveis. Não invente URL.\n11) As referências efetivamente utilizadas serão incorporadas pelo SIASH à seção de Referências Bibliográficas do Word, preservando as referências institucionais anteriores.
12) NUNCA use homepage, portal inicial ou raiz institucional (ex.: gov.br/anvisa/pt-br, sbp.com.br/) como referência bibliográfica. Informe a URL da publicação, diretriz, manual, nota técnica, resolução, artigo ou documento específico. Se não souber a URL específica, não proponha a alteração sustentada apenas por essa homepage.\n13) Se houver PEDIDO DE CORREÇÃO DO PROFISSIONAL abaixo, ele tem prioridade dentro destas regras e deve ser atendido sem criar alterações técnicas não solicitadas. Em modo de correção, compare o pedido diretamente com os PARÁGRAFOS EDITÁVEIS desta proposta e devolva updates para cada erro corrigível sustentado pelas fontes. Não trate a proposta existente como automaticamente correta apenas por já ser uma revisão gerada pela IA.
14) REVISÃO PERIÓDICA / VIGÊNCIA: se o conteúdo técnico permanecer adequado e não houver alteração técnico-científica necessária, NÃO invente mudança apenas para criar uma revisão. Informe isso claramente no summary. A SIASH poderá registrar uma revisão documental periódica sem mudança de conteúdo, sempre com validação humana e sem publicação automática.
15) Quando esta revisão exigir PESQUISA ATUAL, confronte deliberadamente o conteúdo com publicações posteriores ao ano mais recente da bibliografia detectada no POP (${latestReferenceYear||"não identificado"}) e priorize documentos oficiais vigentes.
16) Para concluir que NÃO há alteração técnico-científica necessária em revisão periódica, sustente a conclusão com pelo menos 2 referências específicas elegíveis e ao menos 1 fonte oficial/autoridade reconhecida consultada na pesquisa atual.
17) Se a AUDITORIA CIENTÍFICA SIASH estiver classificada como REVISÃO NECESSÁRIA, trate os achados como pontos obrigatórios de verificação e não encerre a análise como simples renovação de vigência.
18) Em REVISÃO NECESSÁRIA, compare literalmente os PARÁGRAFOS EDITÁVEIS com cada achado. Quando uma fonte atual sustentar correção de um achado, devolva em updates o paragraph_index do parágrafo vigente afetado e um new_text REALMENTE DIFERENTE que incorpore a correção. Repetir o texto vigente não conta como correção.
19) Em REVISÃO NECESSÁRIA, não devolva updates vazio se houver ao menos um achado corrigível pelas fontes fornecidas. Não invente alteração para cumprir esta regra: se nenhum achado puder ser corrigido com segurança pelas fontes disponíveis, mantenha updates vazio e explique objetivamente no summary quais achados ficaram sem evidência suficiente; o SIASH bloqueará a proposta para nova pesquisa.
19A) AUDITORIA → DELTA: para cada achado da AUDITORIA CIENTÍFICA SIASH, identifique explicitamente o(s) parágrafo(s) editável(is) que contêm a conduta relacionada e confronte o texto vigente com as FONTE_N atuais. Achado sustentado por fonte atual e divergente do texto vigente DEVE gerar update textual rastreável; não encerre com 0 alterações apenas porque a bibliografia foi consultada.\n19B) LEG-UTIN-024: examine obrigatoriamente critérios/tempo/frequência do banho e estabilidade térmica, preservação do vérnix, técnica/produtos de higiene da pele, cuidado do coto umbilical e produtos usados na incubadora/berço. Compare literalmente as condutas vigentes com fontes neonatais atuais e proponha somente as correções sustentadas.\n20) Para LEG-UTIN-023 e outros POPs de higienização das mãos, diferencie explicitamente, quando sustentado pelas fontes fornecidas, preparação alcoólica versus lavagem com água e sabonete, indicação pelos momentos de higiene e quantidade/volume conforme instrução do produto/fabricante, evitando regra universal sem suporte.
21) HIERARQUIA OBRIGATÓRIA: para alteração clínica/assistencial use somente as fontes oficiais/primárias FONTE_N fornecidas pela pesquisa. Não substitua referência primária vigente por protocolo municipal, página de terceiro, repositório, blog ou documento secundário.
22) VÍNCULO INSTITUCIONAL OBRIGATÓRIO: se new_text ou reason atribuir uma recomendação a ANVISA, OMS/WHO, OPAS/PAHO, Ministério da Saúde, FIOCRUZ, COFEN/COREN ou SBP, references deve conter FONTE_N cuja URL pertença à própria instituição citada. Não use uma fonte de terceiro para justificar afirmação atribuída a outra instituição.
23) Não altere um parágrafo apenas para trocar uma referência bibliográfica por outra inferior. Uma atualização de referência só é válida quando a nova fonte é oficial/primária e de hierarquia igual ou superior à fonte vigente.\n24) ESTRUTURA INSTITUCIONAL IMUTÁVEL: não altere, remova, renumere nem substitua títulos e cabeçalhos de seção (por exemplo "4- Resultados esperados:" e "9- Referências:"). Atualize somente o conteúdo técnico dentro das seções.\n25) FIOCRUZ: inclua a Fundação Oswaldo Cruz entre as fontes oficiais prioritárias da pesquisa, com preferência por documentos específicos e verificáveis da Fiocruz/IFF pertinentes ao tema; não use página genérica como referência bibliográfica.
MOTIVO DA REVISÃO DOCUMENTAL: ${String(periodic_review_reason||"não informado").trim()||"não informado"}
AUDITORIA CIENTÍFICA SIASH: ${scientificAudit?`${scientificAudit.label}: ${scientificAudit.findings.join(" | ")}`:"Sem apontamento retroativo específico."}\nPEDIDO DE CORREÇÃO DO PROFISSIONAL: ${String(correction_request||"Nenhum").trim()||"Nenhum"}\nPARÁGRAFOS EDITÁVEIS (índice | texto):\n${editable.map(p=>`${p.index} | ${p.text}`).join("\n")}`;
    const researchQuery=[
      doc_title,
      scientificAudit?.status==="review"||scientificAudit?.status==="adjust" ? "revisão técnico-científica hospitalar neonatal" : "",
      ...(scientificAudit?.findings||[]),
      String(correction_request||"").trim() ? `correção solicitada pelo profissional: ${String(correction_request).trim()}` : "",
      "ANVISA Ministério da Saúde Fiocruz IFF Fundação Oswaldo Cruz SBP WHO OPAS diretriz manual recomendação atual"
    ].filter(Boolean).join(" | ");
    const ai=await runAIRevision(prompt,provider,{requireWebResearch:requiresCurrentWebResearch,researchQuery,editableParagraphs:editable});
    if(requiresCurrentWebResearch&&!(["web_search","google_search","tavily_search"].includes(String(ai.researchMode||""))))throw new Error("Esta revisão exige pesquisa web atual. Nenhum provedor com pesquisa web verificável concluiu a análise; o POP vigente permanece inalterado.");
    const result=ai.result||{},allowed=new Set(editable.map(p=>p.index));
    const effective=effectiveAIUpdates(paragraphs,result.updates||[],allowed);
    const correctionNoop=correctionRequested&&!effective.length;
    if(correctionNoop){
      result.validationWarnings=[...(result.validationWarnings||[]),"A IA analisou o pedido de correção, mas não propôs nova alteração textual. O Word da mesma revisão será preservado e seguirá para conferência profissional com os alertas de qualidade do estado final."];
      result.requiresProfessionalReview=true;
      console.warn(`[SIASH AI] correção sem delta textual | code=${doc_code} | proposta preservada para conferência profissional`);
    }
    if(scientificAudit?.status==="review"){
      console.log(`[SIASH AI] auditoria obrigatória | code=${doc_code} | updates_recebidos=${Array.isArray(result.updates)?result.updates.length:0} | alteracoes_reais=${effective.length} | achados=${scientificAudit.findings.length}`);
      if(!effective.length){result.validationWarnings=[...(result.validationWarnings||[]),"A auditoria científica indica revisão necessária, mas a IA não produziu novo delta textual neste ciclo. Conferência profissional obrigatória."];result.requiresProfessionalReview=true;}
    }
    if(effective.some(x=>!Array.isArray(x.references)||!x.references.length)){result.validationWarnings=[...(result.validationWarnings||[]),"Há alteração proposta sem referência específica vinculada. Conferir a rastreabilidade antes da publicação."];result.requiresProfessionalReview=true;}
    const candidateSources=[...(result.references||[]),...(ai.sources||[])].filter(x=>x&&(x.title||x.url));
    const norm=s=>normalizedText(s).toLowerCase();
    const sourceKeys=candidateSources.flatMap(x=>[norm(x.title),norm(x.url)]).filter(Boolean);
    const unlinked=effective.filter(ch=>!(ch.references||[]).some(ref=>{const n=norm(ref);return sourceKeys.some(k=>k===n||k.includes(n)||n.includes(k))}));
    if(unlinked.length){result.validationWarnings=[...(result.validationWarnings||[]),`Há referência citada sem correspondência bibliográfica rastreável nos parágrafos: ${unlinked.map(x=>x.paragraph_index).join(", ")}. Conferir antes da publicação.`];result.requiresProfessionalReview=true;}
    const classified=candidateSources.length?await classifyReferenceUrls(candidateSources):{verified:[],pending:[]};
    const references=[...classified.verified,...classified.pending];
    const eligibleReferenceCount=references.filter(x=>x?.wordEligible===true).length;
    const officialEligibleReferenceCount=references.filter(x=>x?.wordEligible===true&&isOfficialScientificReference(x)).length;
    let traceable=[],excludedChanges=[];
    if(effective.length){
      if(!references.length){result.validationWarnings=[...(result.validationWarnings||[]),"A proposta contém alterações sem referências bibliográficas identificáveis. Conferência profissional obrigatória."];result.requiresProfessionalReview=true;}
      traceable=effective.filter(ch=>(ch.references||[]).some(ref=>references.some(src=>src.wordEligible===true&&sourceMatchesChangeReference(ref,src))));
      excludedChanges=effective.filter(ch=>!traceable.includes(ch));
      if(!traceable.length&&effective.length){traceable=effective;result.validationWarnings=[...(result.validationWarnings||[]),"As alterações não obtiveram vínculo bibliográfico elegível automático. Foram preservadas na proposta para conferência profissional; não publicar sem revisar as fontes."];result.requiresProfessionalReview=true;}
    }
    if(periodicReviewRequired&&!traceable.length&&(eligibleReferenceCount<2||officialEligibleReferenceCount<1)){result.validationWarnings=[...(result.validationWarnings||[]),`Revisão periódica com referências insuficientes para validação automática: ${eligibleReferenceCount} elegível(is), ${officialEligibleReferenceCount} oficial(is). Conferir profissionalmente.`];result.requiresProfessionalReview=true;}
    // v0.14.6 — separa revisão documental periódica de alteração técnico-científica.
    // Se o POP precisa renovar a vigência, a ausência de mudança técnica NÃO é falha: cria-se uma
    // proposta de revisão periódica, preservando integralmente o conteúdo e exigindo a mesma aprovação humana.
    // Fora de um ciclo de revisão documental solicitado, permanece a proteção contra falsa revisão.
    // v0.14.65: ausência legítima de mudança é resultado normal da revisão, não falha de geração.
    let contentRevised=baseDocument,verification={verified:true,actualChanges:0};
    if(traceable.length){contentRevised=patchDocx(baseDocument,traceable);verification=verifyDocxRevision(baseDocument,contentRevised,traceable)}
    let withRefs={buffer:contentRevised,added:0,moved:0,coverage:[],representedByInstitutional:0,genericReferencesRemoved:0,legacyLabelsRemoved:0,wordEligibleReferences:0};
    if(traceable.length||hygieneBefore.needsHygiene||(periodicReviewRequired&&eligibleReferenceCount>0)){
      withRefs=appendReviewedReferences(contentRevised,references,{allowHygieneOnly:!traceable.length});
    }
    const hygieneChanges=Number(withRefs.genericReferencesRemoved||0)+Number(withRefs.labelsRemoved||0);
    const periodicReviewOnly=periodicReviewRequired&&!traceable.length&&hygieneChanges<1;
    verification.actualChanges=Number(verification.actualChanges??traceable.length)+hygieneChanges;
    verification.periodicReviewOnly=periodicReviewOnly;
    verification.periodicReviewRequired=periodicReviewRequired;
    verification.periodicReviewReason=String(periodic_review_reason||"").trim();verification.researchMode=ai.researchMode||"provider_default";verification.currentWebResearchRequired=requiresCurrentWebResearch;verification.eligibleReferenceCount=eligibleReferenceCount;verification.officialEligibleReferenceCount=officialEligibleReferenceCount;verification.latestReferenceYear=latestReferenceYear;verification.scientificAuditStatus=scientificAudit?.status||"none";verification.scientificAuditLabel=scientificAudit?.label||"";
    verification.historyRowsCleaned=Number(historyCleanup.removed||0);
    verification.bibliographyHygieneOnly=!traceable.length&&hygieneChanges>0;
    verification.bibliographyHygieneChanges=hygieneChanges;
    verification.genericReferencesRemoved=Number(withRefs.genericReferencesRemoved||0);
    verification.legacyLabelsRemoved=Number(withRefs.labelsRemoved||0);
    const finalCleanup=targetedFinalWordCleanup(withRefs.buffer),revised=finalCleanup.buffer;
    verification.targetedFinalRepairs=finalCleanup.repairs;
    verification.actualChanges=Number(verification.actualChanges||0)+finalCleanup.repairs.length;
    appendVerificationWarnings(verification,advisoryFinalDocumentQuality(revised));
    if(Array.isArray(result.validationWarnings)&&result.validationWarnings.length)appendVerificationWarnings(verification,{ok:false,warnings:result.validationWarnings});
    // v0.13.3: não exige que toda URL retornada pela IA apareça literalmente no Word.
    // Uma fonte pode já estar representada por uma referência institucional semanticamente equivalente;
    // nesse caso, repetir a URL criaria justamente a duplicidade que a v0.13.2 passou a impedir.
    if(!periodicReviewOnly&&traceable.length&&(!withRefs.coverage?.length||withRefs.coverage.some(x=>!x.represented))){appendVerificationWarnings(verification,{ok:false,warnings:["Nem todas as referências foram consolidadas automaticamente no Word. Conferir bibliografia antes da publicação."]});}
    if(periodicReviewOnly&&withRefs.coverage?.some(x=>!x.represented)){appendVerificationWarnings(verification,{ok:false,warnings:["Há referência da revisão periódica pendente de consolidação no Word. Conferir antes da publicação."]});}
    verification.referencesAdded=withRefs.added;
    verification.referencesVerified=classified.verified.length;
    verification.referencesPending=classified.pending.length;verification.referencePlacement="bibliography_section_verified";
    const validatedSummary=traceable.length
  ?`PROPOSTA de revisão — alterações técnico-científicas aplicadas no Word e pendentes de validação profissional: ${traceable.map((ch,i)=>{
      const before=String(ch.before_text||"").trim();
      const after=String(ch.new_text||"").trim();
      const reason=String(ch.reason||"").trim();
      return `${i+1}) ${before} → ${after}${reason?` — ${reason}`:""}`;
    }).join(" | ")}`
  :periodicReviewOnly
    ?"Revisão periódica concluída sem alteração técnico-científica do conteúdo. O documento segue para conferência e aprovação profissional."
    :"Revisão concluída: nenhuma alteração técnico-científica ou bibliográfica necessária. O POP vigente foi preservado.";
    await audit(req.user.u,"SIASH Docs: proposta de revisão gerada pela IA para conferência profissional.",{doc_code,current_revision,next_revision,provider:ai.provider,model:ai.model,changes:traceable.length,periodic_review_only:periodicReviewOnly,periodic_review_required:periodicReviewRequired,bibliography_hygiene_changes:Number(verification.bibliographyHygieneChanges||0),history_rows_cleaned:Number(historyCleanup.removed||0),changes_excluded_unqualified_sources:excludedChanges.length,verified:false,requires_professional_review:true,validation_warnings:verification.validationWarnings||[],references_verified:classified.verified.length,references_pending:classified.pending.length});
    res.json({ok:true,provider:ai.provider,model:ai.model,researchMode:ai.researchMode||"provider_default",summary:validatedSummary,changes:traceable,excludedChanges,references,verification,file_name:String(file_name||`${doc_code}_Rev${next_revision}_PROPOSTA_IA.docx`).replace(/\.docx$/i,"")+"_IA.docx",file_base64:revised.toString("base64")});
  }catch(e){console.error("AI revise POP:",e);res.status(500).json({error:"Falha ao gerar proposta com IA: "+(e?.message||"erro interno")})}
});

app.get("/api/users",auth,async(req,res)=>{
  if(req.user.r!=="owner")return res.status(403).json({error:"Somente Administrador Proprietário."});
  const q=await pool.query("SELECT username,role,created_at FROM siash_users ORDER BY username");res.json(q.rows);
});
app.post("/api/users",auth,async(req,res)=>{
  if(req.user.r!=="owner")return res.status(403).json({error:"Somente Administrador Proprietário."});
  const username=String(req.body?.username||"").trim(),password=String(req.body?.password||"");
  const role=req.body?.role??"operational";
  if(!["operational","clinical_supervisor"].includes(role))return res.status(400).json({error:"INVALID_USER_ROLE"});
  if(!/^[a-zA-Z0-9._-]{3,64}$/.test(username)||!validNewPassword(password))
    return res.status(400).json({error:"Login: 3 a 64 caracteres (letras, números, ponto, hífen ou sublinhado). Senha: 10 a 128 caracteres com pelo menos um especial (!@#$%^&*._-)."});
  const hash=await bcrypt.hash(password,12);
  try{
    await pool.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,$3)",[username,hash,role]);
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"Este login já existe. Nenhuma senha foi alterada."});throw e}
  await audit(req.user.u,"Usuário Cloud criado.",{username,role});
  res.status(201).json({ok:true,username,role});
});


app.patch("/api/users/:username/role",auth,async(req,res)=>{
 if(req.user.r!=="owner")return res.status(403).json({error:"OWNER_REQUIRED"});
 const username=req.params.username,role=req.body?.role;
 if(!["operational","clinical_supervisor"].includes(role))return res.status(400).json({error:"INVALID_USER_ROLE"});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const target=await client.query("SELECT role FROM siash_users WHERE username=$1 FOR UPDATE",[username]);
  if(!target.rows.length){await client.query("ROLLBACK");return res.status(404).json({error:"USER_NOT_FOUND"})}
  if(target.rows[0].role==="owner"){await client.query("ROLLBACK");return res.status(403).json({error:"OWNER_ROLE_IMMUTABLE"})}
  await client.query("UPDATE siash_users SET role=$1 WHERE username=$2",[role,username]);
  await client.query("INSERT INTO siash_cloud_audit(username,action,details) VALUES($1,$2,$3)",[req.user.u,"Perfil clínico alterado.",JSON.stringify({username,previousRole:target.rows[0].role,newRole:role})]);
  await client.query("COMMIT");res.json({ok:true,username,role});
 }catch(e){await client.query("ROLLBACK").catch(()=>{});res.status(503).json({error:"ROLE_UPDATE_UNAVAILABLE"})}
 finally{client.release()}
});
// Regularização tardia: fluxo exclusivamente humano, append-only, sem alteração de siash_state.
const {randomUUID}=require("node:crypto");
const {validateRequest,decideReview}=require("./census-late-regularization.cjs");
function lateError(res,code,status=422){return res.status(status).json({error:code})}
async function lateTransaction(handler,res){
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const result=await handler(client);
  if(result?.error){await client.query("ROLLBACK");return lateError(res,result.error,result.http||422)}
  await client.query("COMMIT");return res.status(result.http||200).json(result.data);
 }catch(e){
  await client.query("ROLLBACK").catch(()=>{});
  if(e.code==="23505")return lateError(res,"LATE_CENSUS_ALREADY_REQUESTED",409);
  console.error("Falha transacional da regularização tardia:",e);
  return lateError(res,"LATE_CENSUS_UNAVAILABLE",503);
 }finally{client.release()}
}
app.post("/api/census/late-requests",auth,async(req,res)=>{
 const base=req.body?.base_revision;
 if(!Number.isSafeInteger(base)||base<1)return lateError(res,"BASE_REVISION_REQUIRED",428);
 const now=new Date();
 const validated=validateRequest({
  referenceDate:req.body?.referenceDate,
  proposedCount:req.body?.midnightCount,
  justification:req.body?.justification,
  evidence:req.body?.evidence,
  actor:req.user.u,now
 });
 if(!validated.ok)return lateError(res,validated.code);
 return lateTransaction(async client=>{
  const state=await client.query("SELECT revision,payload FROM siash_state WHERE id=1 FOR UPDATE");
  if(!state.rows.length)return {error:"STATE_NOT_FOUND",http:409};
  const revision=Number(state.rows[0].revision);
  if(revision!==base)return {error:"STATE_REVISION_CONFLICT",http:409};
  const daily=state.rows[0].payload?.state?.daily?.find?.(d=>d.date===validated.referenceDate);
  if(daily?.censusConference)return {error:"CENSUS_CONFERENCE_ALREADY_EXISTS",http:409};
  const previous=await client.query("SELECT protocol FROM siash_census_late_requests WHERE reference_date=$1 FOR UPDATE",[validated.referenceDate]);
  if(previous.rows.length)return {error:"LATE_CENSUS_ALREADY_REQUESTED",http:409};
  const protocol=randomUUID();
  await client.query("INSERT INTO siash_census_late_requests(protocol,reference_date,requester,midnight_count,justification,evidence,state_revision,requested_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[protocol,validated.referenceDate,req.user.u,validated.proposedCount,validated.justification,validated.evidence,revision,now]);
  for(const eventType of ["pendente","regularizacao_solicitada","aguardando_supervisor"]){
   await client.query("INSERT INTO siash_census_late_events(protocol,reference_date,event_type,actor,state_revision,occurred_at,details) VALUES($1,$2,$3,$4,$5,$6,$7)",[protocol,validated.referenceDate,eventType,req.user.u,revision,now,JSON.stringify({source:"late_request",justification:validated.justification,evidence:validated.evidence,midnightCount:validated.proposedCount})]);
  }
  return {http:201,data:{protocol,referenceDate:validated.referenceDate,status:"aguardando_supervisor",requestedAt:now.toISOString(),timeZone:"America/Sao_Paulo",stateRevision:revision}};
 },res);
});
app.post("/api/census/late-requests/:protocol/decision",auth,async(req,res)=>{
 if(!canDecideClinical(await databaseRole(req.user.u)))return lateError(res,"SUPERVISOR_PERMISSION_REQUIRED",403);
 // Papel clínico é verificado no banco, jamais pelo JWT ou payload.
 const base=req.body?.base_revision;
 if(!Number.isSafeInteger(base)||base<1)return lateError(res,"BASE_REVISION_REQUIRED",428);
 const protocol=req.params.protocol;
 if(!/^[0-9a-f-]{36}$/i.test(protocol))return lateError(res,"INVALID_PROTOCOL",400);
 return lateTransaction(async client=>{
  const state=await client.query("SELECT revision FROM siash_state WHERE id=1 FOR UPDATE");
  if(!state.rows.length)return {error:"STATE_NOT_FOUND",http:409};
  const revision=Number(state.rows[0].revision);
  if(revision!==base)return {error:"STATE_REVISION_CONFLICT",http:409};
  const record=await client.query("SELECT protocol,reference_date::text AS reference_date,requester FROM siash_census_late_requests WHERE protocol=$1 FOR UPDATE",[protocol]);
  if(!record.rows.length)return {error:"LATE_CENSUS_NOT_FOUND",http:404};
  const request=record.rows[0];
  if(request.requester===req.user.u)return {error:"SELF_APPROVAL_FORBIDDEN",http:403};
  const supervisorRole=await client.query("SELECT role FROM siash_users WHERE username=$1 FOR SHARE",[req.user.u]);
  if(!canDecideClinical(supervisorRole.rows[0]?.role))return {error:"SUPERVISOR_PERMISSION_REQUIRED",http:403};
  const events=await client.query("SELECT event_type FROM siash_census_late_events WHERE protocol=$1 ORDER BY id DESC LIMIT 1",[protocol]);
  const status=events.rows[0]?.event_type;
  const reviewed=decideReview({request:{requester:request.requester,status},supervisor:req.user.u,approved:req.body?.approved,reason:req.body?.reason,now:new Date()});
  if(!reviewed.ok)return {error:reviewed.code,http:reviewed.code==="INVALID_REVIEW_STATE"?409:422};
  const now=new Date();
  await client.query("INSERT INTO siash_census_late_events(protocol,reference_date,event_type,actor,state_revision,occurred_at,details) VALUES($1,$2,$3,$4,$5,$6,$7)",[protocol,request.reference_date,reviewed.status,req.user.u,revision,now,JSON.stringify({reason:reviewed.reviewReason})]);
  return {data:{protocol,status:reviewed.status,reviewedBy:req.user.u,reviewedAt:now.toISOString(),timeZone:"America/Sao_Paulo",stateRevision:revision}};
 },res);
});
app.get("/api/census/late-requests",auth,async(req,res)=>{
 try{
  const q=await pool.query("SELECT r.protocol,r.reference_date::text AS reference_date,r.requester,r.midnight_count,r.justification,r.evidence,r.state_revision,r.requested_at,(SELECT e.event_type FROM siash_census_late_events e WHERE e.protocol=r.protocol ORDER BY e.id DESC LIMIT 1) AS status FROM siash_census_late_requests r ORDER BY r.requested_at DESC LIMIT 100");
  res.json({requests:q.rows});
 }catch(e){return lateError(res,"LATE_CENSUS_UNAVAILABLE",503)}
});
app.get("/api/census/late-requests/:protocol/events",auth,async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/i.test(req.params.protocol))return lateError(res,"INVALID_PROTOCOL",400);
 try{const q=await pool.query("SELECT id,protocol,reference_date::text AS reference_date,event_type,actor,state_revision,occurred_at,details FROM siash_census_late_events WHERE protocol=$1 ORDER BY id",[req.params.protocol]);res.json({events:q.rows})}
 catch(e){return lateError(res,"LATE_CENSUS_UNAVAILABLE",503)}
});

app.use(express.static(__dirname,{extensions:["html"]}));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));

initDb().then(async()=>{await reconcileMidnightCensus();app.listen(PORT,()=>console.log(`SIASH Cloud ativa na porta ${PORT}`));setInterval(()=>reconcileMidnightCensus().catch(err=>console.error("Falha no fechamento automático do censo:",err.message)),60000).unref();}).catch(e=>{console.error(e);process.exit(1)});
