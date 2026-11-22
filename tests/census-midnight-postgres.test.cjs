const test=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const net=require("node:net");

const {dateInBrazil,previousDate,midnightBrazilUtc}=require("../census-midnight.cjs");
test("PostgreSQL isolado: censo exclusivamente manual, legado preservado e admissao pendente",async()=>{
 if(process.env.SIASH_ISOLATED_CI!=="1")return;
 const {Pool}=require("pg");
 const jwt=require("jsonwebtoken");
 const schema="siash_pr81_midnight";
 const base=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 await base.query('CREATE SCHEMA IF NOT EXISTS '+schema);
 const url=new URL(process.env.DATABASE_URL);
 url.searchParams.set("options","-csearch_path="+schema);
 const isolated=url.toString();
 const db=new Pool({connectionString:isolated,ssl:false});
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p))})});
 const secret="ci-pr81-midnight-secret-minimum-32-characters";
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,DATABASE_URL:isolated,JWT_SECRET:secret,PORT:String(port),PGSSLMODE:"disable"},stdio:"pipe"});
 const auth=jwt.sign({u:"ci-nurse",r:"operational"},secret,{expiresIn:"1h"});
 const referenceDate=previousDate(dateInBrazil(new Date()));
 const midnight=midnightBrazilUtc(dateInBrazil(new Date()));
 const before=new Date(midnight.getTime()-60000);
 const get=async()=>fetch("http://127.0.0.1:"+port+"/api/census/midnight-status",{headers:{Authorization:"Bearer "+auth}});
 try{
  let started=false;
  for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error("Server terminated");try{const r=await fetch("http://127.0.0.1:"+port+"/api/health");if(r.ok){started=true;break}}catch(_){}await new Promise(r=>setTimeout(r,200))}
  assert.equal(started,true,"server did not start");
  // Real authentication regression against isolated PostgreSQL.
  const bcrypt=require("bcryptjs");
  await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,$3)",["legacy-nurse",await bcrypt.hash("LegacyPass123",12),"operational"]);
  const post=async(path,body,token)=>fetch("http://127.0.0.1:"+port+path,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(body)});
  let login=await post("/api/login",{username:"legacy-nurse",password:"LegacyPass123"});
  assert.equal(login.status,200,"legacy password must remain valid");
  let loginBody=await login.json();
  assert.ok(loginBody.token);assert.equal("password_hash" in loginBody,false);assert.equal("password" in loginBody,false);
  const change=await post("/api/change-password",{currentPassword:"LegacyPass123",newPassword:"NovaSenha!123",confirmPassword:"NovaSenha!123"},loginBody.token);
  assert.equal(change.status,200,"password change must succeed");
  const changeBody=await change.json();assert.equal(changeBody.ok,true);assert.equal(JSON.stringify(changeBody).includes("NovaSenha"),false);
  login=await post("/api/login",{username:"legacy-nurse",password:"LegacyPass123"});
  assert.equal(login.status,401,"old password must be rejected after change");
  login=await post("/api/login",{username:"legacy-nurse",password:"NovaSenha!123"});
  assert.equal(login.status,200,"new password must authenticate");
  const auditRows=await db.query("SELECT action,details FROM siash_cloud_audit WHERE username=$1",["legacy-nurse"]);
  assert.ok(auditRows.rows.some(x=>x.action.includes("Senha alterada")));
  assert.equal(JSON.stringify(auditRows.rows).includes("NovaSenha!123"),false,"audit must not expose passwords");
  const daily={date:referenceDate,internados:3,admissoes:0};
  await db.query("INSERT INTO siash_state(id,payload,revision,updated_at) VALUES(1,$1,1,$2)",[{state:{daily:[daily]}},before]);
  await db.query("INSERT INTO siash_daily_admission_records(reference_date,admission_count,ever_admitted,recorded_at,recorded_by) VALUES($1,0,FALSE,$2,'ci')",[referenceDate,before]);
  // Sem conferencia, a leitura repetida nao cria nem promove fechamento automatico.
  let r=await get();assert.equal(r.status,200);let body=await r.json();
  assert.equal(body.status,"pending");assert.equal(body.legacyAutomaticRecordExists,false);
  r=await get();assert.equal((await r.json()).status,"pending");
  let q=await db.query("SELECT count(*)::int AS n FROM siash_census_auto_closures");assert.equal(q.rows[0].n,0);
  q=await db.query("SELECT count(*)::int AS n FROM siash_cloud_audit WHERE username='system'");assert.equal(q.rows[0].n,0);
  // Uma conferencia explicita e valida e a unica via para status manual.
  const conference={referenceDate,count:3,responsible:"Enfermeira plantonista CI",registeredAt:new Date().toISOString()};
  await db.query("UPDATE siash_state SET payload=$1,updated_at=$2 WHERE id=1",[{state:{daily:[{...daily,censusConference:conference}]}},before]);
  r=await get();assert.equal(r.status,200);body=await r.json();
  assert.equal(body.status,"manual");assert.equal(body.responsible,conference.responsible);
  assert.equal(body.registeredAt,conference.registeredAt);
  q=await db.query("SELECT count(*)::int AS n FROM siash_census_auto_closures");assert.equal(q.rows[0].n,0);
  // Um fechamento historico simulado deve permanecer intacto e nao equivale a conferencia manual.
  await db.query("INSERT INTO siash_census_auto_closures(reference_date,midnight_at,census_count,note,state_revision) VALUES($1,$2,$3,$4,$5)",[referenceDate,midnight,3,"LEGADO CI - preservar sem promover",1]);
  await db.query("UPDATE siash_state SET payload=$1,updated_at=$2 WHERE id=1",[{state:{daily:[daily]}},before]);
  r=await get();assert.equal(r.status,200);body=await r.json();
  assert.equal(body.status,"pending");assert.equal(body.legacyAutomaticRecordExists,true);
  r=await get();assert.equal((await r.json()).status,"pending");
  q=await db.query("SELECT census_count,note,state_revision FROM siash_census_auto_closures WHERE reference_date=$1",[referenceDate]);
  assert.equal(q.rows.length,1);assert.equal(q.rows[0].census_count,3);
  assert.equal(q.rows[0].note,"LEGADO CI - preservar sem promover");assert.equal(Number(q.rows[0].state_revision),1);
  // Admissao pendente tambem nao autoriza fechamento, nem modifica o legado.
  await db.query("UPDATE siash_state SET payload=$1,updated_at=$2 WHERE id=1",[{state:{daily:[{...daily,admissoes:1}]}},before]);
  await db.query("UPDATE siash_daily_admission_records SET admission_count=1,ever_admitted=TRUE WHERE reference_date=$1",[referenceDate]);
  r=await get();assert.equal(r.status,200);body=await r.json();assert.equal(body.status,"pending");
  assert.equal(body.legacyAutomaticRecordExists,true);
  q=await db.query("SELECT count(*)::int AS n FROM siash_census_auto_closures");assert.equal(q.rows[0].n,1);
  q=await db.query("SELECT count(*)::int AS n FROM siash_cloud_audit WHERE username='system'");assert.equal(q.rows[0].n,0);
 }finally{
  child.kill("SIGTERM");await db.end();await base.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await base.end();
 }
},{timeout:30000});
