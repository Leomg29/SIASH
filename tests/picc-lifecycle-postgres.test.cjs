"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR97 isolated PostgreSQL: legacy, immutable PICC, rollback, 409",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const {Pool}=require("pg"),bcrypt=require("bcryptjs");
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false}),port=18898,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"pr97-postgres-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
 const clone=x=>JSON.parse(JSON.stringify(x));
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  const username="pr97_"+Date.now(),password="PR97Isolated!2026";
  await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,'operational')",[username,await bcrypt.hash(password,4)]);
  const login=await fetch(url+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password})});
  assert.equal(login.status,200);const token=(await login.json()).token,headers={"content-type":"application/json",authorization:"Bearer "+token};
  const beds=Array.from({length:10},(_,i)=>({n:i+1,isolation:i>=8,status:"Livre",profile:"Intensivo",rn:"",note:""}));
  const legacy={when:"28/02/2024 10:00",status:"Ativo",bed:"1",vein:"Basílica"};
  const state={beds,bedMoves:[],profileHistory:[],movements:[],daily:[],picc:[legacy],piccEvents:[]};
  const payload={state,security:{},schema:"pr97-ci"};
  await db.query("UPDATE siash_state SET payload=$1,revision=1 WHERE id=1",[payload]);
  async function put(p,base){const r=await fetch(url+"/api/state",{method:"PUT",headers,body:JSON.stringify({payload:p,base_revision:base})});return {status:r.status,body:await r.json()}}
  const history=(await db.query("SELECT COUNT(*)::int n FROM siash_state_history")).rows[0].n;
  const deleted=clone(payload);deleted.state.picc=[];assert.equal((await put(deleted,1)).status,422);
  const changed=clone(payload);changed.state.picc[0].when="01/03/2024";assert.equal((await put(changed,1)).status,422);
  const invalid=clone(payload);Object.assign(invalid.state.picc[0],{status:"Retirado",removalDate:"2024-02-27",removalReason:"Fim"});assert.equal((await put(invalid,1)).status,422);
  const before=await db.query("SELECT revision,payload FROM siash_state WHERE id=1");
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM siash_state_history")).rows[0].n,history);
  const valid=clone(payload);Object.assign(valid.state.picc[0],{status:"Retirado",removalDate:"2024-03-01",removalReason:"Fim da terapia",removedAt:"local",updated:"local"});
  const ok=await put(valid,1);assert.equal(ok.status,200,JSON.stringify(ok.body));assert.equal(ok.body.picc_event_stamps[0].recordedBy,username);
  assert.equal((await put(payload,1)).status,409);
  const final=await db.query("SELECT revision,payload FROM siash_state WHERE id=1");
  assert.equal(Number(final.rows[0].revision),2);assert.equal(final.rows[0].payload.state.picc[0].id,undefined);
  assert.deepEqual(final.rows[0].payload.state.picc[0].when,legacy.when);
  assert.equal(final.rows[0].payload.state.piccEvents[0].type,"Retirada");
  const tamper=clone(final.rows[0].payload);tamper.state.picc[0].removalReason="Alterado";
  assert.equal((await put(tamper,2)).status,422);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM siash_state_history")).rows[0].n,history+1);
  assert.equal((await db.query("SELECT revision FROM siash_state WHERE id=1")).rows[0].revision,2);
  assert.deepEqual(before.rows[0].payload,payload);
 }finally{child.kill("SIGTERM");await db.end()}
});
