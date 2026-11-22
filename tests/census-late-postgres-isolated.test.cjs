"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {setTimeout:delay}=require("node:timers/promises");
const isolated=process.env.SIASH_ISOLATED_CI==="1";
test("PostgreSQL isolado: regularização tardia transacional, dupla custódia, histórico e concorrência",{skip:!isolated,timeout:120000},async()=>{
 const {Pool}=require("pg");
 const db=process.env.DATABASE_URL;
 assert.match(db,/siash_ci/);
 const pool=new Pool({connectionString:db,ssl:false});
 const port=18793,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"siash-ci-isolated-late-census-secret-32"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
 const prefix="late_"+Date.now();
 const nurse=prefix+"_n",supervisor=prefix+"_s",other=prefix+"_o";
 const password="Isolated-test-2026!";
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  const bcrypt=require("bcryptjs"),hash=await bcrypt.hash(password,4);
  for(const [u,role] of [[nurse,"operational"],[supervisor,"owner"],[other,"operational"]])await pool.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,$3)",[u,hash,role]);
  async function login(u){const r=await fetch(url+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:u,password})});assert.equal(r.status,200);return (await r.json()).token}
  const nurseToken=await login(nurse),superToken=await login(supervisor),otherToken=await login(other);
  const state=await pool.query("SELECT revision,payload FROM siash_state WHERE id=1");
  assert.equal(state.rows.length,1);
  const revision=Number(state.rows[0].revision),original=JSON.stringify(state.rows[0].payload);
  const date=new Date(Date.now()-3*86400000).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
  // Use a date not present in historical conferences and preserve existing data.
  let referenceDate=date;
  for(let i=3;i<90;i++){
   const candidate=new Date(Date.now()-i*86400000).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
   const exists=await pool.query("SELECT 1 FROM siash_census_late_requests WHERE reference_date=$1",[candidate]);
   const daily=state.rows[0].payload?.state?.daily?.find?.(d=>d.date===candidate);
   if(!exists.rows.length&&!daily?.censusConference){referenceDate=candidate;break}
  }
  const body={referenceDate,midnightCount:4,justification:"Intercorrência assistencial no plantão noturno",evidence:"Relatório de ocupação e registros do plantão",base_revision:revision};
  async function post(route,token,data){const r=await fetch(url+route,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(data)});return {status:r.status,data:await r.json()}}
  const [a,b]=await Promise.all([post("/api/census/late-requests",nurseToken,body),post("/api/census/late-requests",otherToken,body)]);
  assert.deepEqual([a.status,b.status].sort((x,y)=>x-y),[201,409]);
  const created=a.status===201?a:b;
  assert.match(created.data.protocol,/^[a-f0-9-]{36}$/);
  assert.match(created.data.requestedAt,/Z$/);
  const protocol=created.data.protocol,decision="/api/census/late-requests/"+protocol+"/decision";
  const self=await post(decision,nurseToken,{base_revision:revision,approved:true,reason:"Evidências suficientes para aprovação"});
  assert.equal(self.status,403);assert.equal(self.data.error,"SELF_APPROVAL_FORBIDDEN");
  const unauthorized=await post(decision,otherToken,{base_revision:revision,approved:true,reason:"Evidências suficientes para aprovação"});
  assert.equal(unauthorized.status,403);
  const approved=await post(decision,superToken,{base_revision:revision,approved:true,reason:"Conferência independente dos documentos"});
  assert.equal(approved.status,200);assert.equal(approved.data.status,"regularizacao_aprovada");
  const duplicate=await post(decision,superToken,{base_revision:revision,approved:false,reason:"Tentativa de modificar decisão histórica"});
  assert.equal(duplicate.status,409);
  const ev=await pool.query("SELECT event_type FROM siash_census_late_events WHERE protocol=$1 ORDER BY id",[protocol]);
  assert.deepEqual(ev.rows.map(x=>x.event_type),["pendente","regularizacao_solicitada","aguardando_supervisor","regularizacao_aprovada"]);
  await assert.rejects(pool.query("UPDATE siash_census_late_events SET event_type='regularizacao_rejeitada' WHERE protocol=$1",[protocol]));
  await assert.rejects(pool.query("DELETE FROM siash_census_late_requests WHERE protocol=$1",[protocol]));
  const after=await pool.query("SELECT revision,payload FROM siash_state WHERE id=1");
  assert.equal(Number(after.rows[0].revision),revision);assert.equal(JSON.stringify(after.rows[0].payload),original);
  // Independent rejection on a separate historical date.
  const rejectDate=new Date(Date.now()-120*86400000).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
  const rejection=await post("/api/census/late-requests",nurseToken,{...body,referenceDate:rejectDate});
  assert.equal(rejection.status,201);
  const denied=await post("/api/census/late-requests/"+rejection.data.protocol+"/decision",superToken,{base_revision:revision,approved:false,reason:"Evidências clínicas insuficientes"});
  assert.equal(denied.status,200);assert.equal(denied.data.status,"regularizacao_rejeitada");
 }finally{child.kill("SIGTERM");await pool.end()}
});
