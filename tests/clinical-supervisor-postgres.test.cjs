"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("clinical supervisor PostgreSQL: owner grant/revoke, decision, SoD, audit and active-token revocation",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 const {Pool}=require("pg"),bcrypt=require("bcryptjs");
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 const port=18895,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"siash-clinical-supervisor-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",x=>logs+=x);child.stderr.on("data",x=>logs+=x);
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  const prefix="clin_"+Date.now(),owner=prefix+"_owner",nurse=prefix+"_nurse",supervisor=prefix+"_super",password="ClinicalRole!2026";
  const hash=await bcrypt.hash(password,4);
  for(const [username,role] of [[owner,"owner"],[nurse,"operational"]])await pool.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,$3)",[username,hash,role]);
  async function request(method,path,token,body){
   const r=await fetch(url+path,{method,headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:r.status,body:await r.json()};
  }
  async function login(username){const r=await request("POST","/api/login",null,{username,password});assert.equal(r.status,200);return r.body.token}
  const ownerToken=await login(owner),nurseToken=await login(nurse);
  let r=await request("POST","/api/users",nurseToken,{username:supervisor,password,role:"clinical_supervisor"});assert.equal(r.status,403);
  r=await request("POST","/api/users",ownerToken,{username:supervisor,password,role:"operational"});assert.equal(r.status,201);
  const supervisorToken=await login(supervisor);
  r=await request("PATCH","/api/users/"+supervisor+"/role",ownerToken,{role:"clinical_supervisor"});assert.equal(r.status,200);
  for(const token of [supervisorToken,nurseToken]){
   assert.equal((await request("GET","/api/users",token)).status,403);
   assert.equal((await request("POST","/api/users",token,{username:prefix+"_x",password})).status,403);
   assert.equal((await request("PATCH","/api/users/"+nurse+"/role",token,{role:"clinical_supervisor"})).status,403);
  }
  const state=await pool.query("SELECT revision,payload FROM siash_state WHERE id=1");
  const revision=Number(state.rows[0].revision),original=JSON.stringify(state.rows[0].payload);
  async function create(date,token){
   const r=await request("POST","/api/census/late-requests",token,{referenceDate:date,midnightCount:4,justification:"Registro assistencial de plantão noturno para conferência",evidence:"Mapa de leitos e evolução assistencial",base_revision:revision});
   assert.equal(r.status,201,JSON.stringify(r.body));return r.body.protocol;
  }
  const date=n=>new Date(Date.now()-n*86400000).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
  const p1=await create(date(230),nurseToken);
  const decide=(p,t,approved)=>request("POST","/api/census/late-requests/"+p+"/decision",t,{base_revision:revision,approved,reason:"Conferência independente dos documentos clínicos"});
  assert.equal((await decide(p1,nurseToken,true)).status,403);
  assert.equal((await decide(p1,supervisorToken,true)).status,200);
  const p2=await create(date(231),supervisorToken);
  const self=await decide(p2,supervisorToken,true);assert.equal(self.status,403);assert.equal(self.body.error,"SELF_APPROVAL_FORBIDDEN");
  assert.equal((await decide(p2,ownerToken,false)).status,200);
  const p3=await create(date(232),nurseToken);
  r=await request("PATCH","/api/users/"+supervisor+"/role",ownerToken,{role:"operational"});assert.equal(r.status,200);
  const revoked=await decide(p3,supervisorToken,true);assert.equal(revoked.status,403);assert.equal(revoked.body.error,"SUPERVISOR_PERMISSION_REQUIRED");
  const events=await pool.query("SELECT event_type FROM siash_census_late_events WHERE protocol=$1 ORDER BY id",[p1]);
  assert.equal(events.rows.at(-1).event_type,"regularizacao_aprovada");
  const audits=await pool.query("SELECT action,details,created_at FROM siash_cloud_audit WHERE username=$1 AND action='Perfil clínico alterado.' ORDER BY id",[owner]);
  assert.equal(audits.rows.length,2);assert.equal(audits.rows[0].details.newRole,"clinical_supervisor");assert.equal(audits.rows[1].details.newRole,"operational");
  const after=await pool.query("SELECT revision,payload FROM siash_state WHERE id=1");
  assert.equal(Number(after.rows[0].revision),revision);assert.equal(JSON.stringify(after.rows[0].payload),original);
 }finally{child.kill("SIGTERM");await pool.end()}
});
