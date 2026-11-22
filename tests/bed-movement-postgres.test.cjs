"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR96 isolated PostgreSQL: append-only histories, atomic rollback and stale revision",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const {Pool}=require("pg"),bcrypt=require("bcryptjs");
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
 const port=18897,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"pr96-postgres-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
 const beds=()=>Array.from({length:10},(_,i)=>({n:i+1,isolation:i>=8,status:"Livre",profile:"Intensivo",rn:"",note:""}));
 const clone=x=>JSON.parse(JSON.stringify(x));
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  const username="pr96_"+Date.now(),password="PR96Isolated!2026";
  await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,'operational')",[username,await bcrypt.hash(password,4)]);
  const login=await fetch(url+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password})});
  assert.equal(login.status,200);const token=(await login.json()).token;
  const headers={"content-type":"application/json",authorization:"Bearer "+token};
  const state={beds:beds(),bedMoves:[{when:"legacy",origin:1,target:2,rn:"OLD"}],profileHistory:[{when:"legacy",bed:1}],movements:[{when:"legacy",type:"Alta"}],daily:[]};
  const payload={state,security:{},schema:"pr96-ci"};
  await db.query("UPDATE siash_state SET payload=$1,revision=1 WHERE id=1",[payload]);
  async function put(p,base){const r=await fetch(url+"/api/state",{method:"PUT",headers,body:JSON.stringify({payload:p,base_revision:base})});return {status:r.status,body:await r.json()}}
  const before=await db.query("SELECT revision,payload FROM siash_state WHERE id=1");
  const historyBefore=await db.query("SELECT COUNT(*)::int n FROM siash_state_history");
  for(const key of ["bedMoves","profileHistory","movements"]){
   const bad=clone(payload);bad.state[key]=[];
   const r=await put(bad,1);assert.equal(r.status,422,key);assert.equal(r.body.error,"BED_HISTORY_IMMUTABLE");
  }
  const invalid=clone(payload);invalid.state.beds[0].status="Ocupado";
  assert.equal((await put(invalid,1)).status,422);
  const afterRejected=await db.query("SELECT revision,payload FROM siash_state WHERE id=1");
  assert.deepEqual(afterRejected.rows,before.rows);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM siash_state_history")).rows[0].n,historyBefore.rows[0].n);
  const valid=clone(payload);valid.state.beds[0].status="Ocupado";valid.state.beds[0].rn="RN-CI-96";
  valid.state.bedMoves.push({when:"new",origin:2,target:1,rn:"RN-CI-96"});
  const accepted=await put(valid,1);assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  assert.equal((await put(payload,1)).status,409);
  const final=await db.query("SELECT revision,payload FROM siash_state WHERE id=1");
  assert.equal(Number(final.rows[0].revision),2);
  assert.equal(final.rows[0].payload.state.bedMoves.length,2);
  assert.deepEqual(final.rows[0].payload.state.bedMoves[0],state.bedMoves[0]);
 }finally{child.kill("SIGTERM");await db.end()}
});
