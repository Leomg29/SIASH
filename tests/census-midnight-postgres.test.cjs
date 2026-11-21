const test=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const net=require("node:net");

const {dateInBrazil,previousDate,midnightBrazilUtc}=require("../census-midnight.cjs");
test("PostgreSQL isolado: auto-fechamento idempotente e admissao pendente",async()=>{
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
  const daily={date:referenceDate,internados:3,admissoes:0};
  await db.query("INSERT INTO siash_state(id,payload,revision,updated_at) VALUES(1,$1,1,$2)",[{state:{daily:[daily]}},before]);
  let r=await get();assert.equal(r.status,200);let body=await r.json();assert.equal(body.status,"automatic");
  r=await get();assert.equal((await r.json()).status,"automatic");
  let q=await db.query("SELECT count(*)::int AS n FROM siash_census_auto_closures");assert.equal(q.rows[0].n,1);
  q=await db.query("SELECT count(*)::int AS n FROM siash_cloud_audit WHERE username='system'");assert.equal(q.rows[0].n,1);
  await db.query("DELETE FROM siash_census_auto_closures");
  await db.query("UPDATE siash_state SET payload=$1,updated_at=$2",[{state:{daily:[{...daily,admissoes:1}]}},before]);
  r=await get();body=await r.json();assert.equal(body.status,"pending");
  q=await db.query("SELECT count(*)::int AS n FROM siash_census_auto_closures");assert.equal(q.rows[0].n,0);
 }finally{
  child.kill("SIGTERM");await db.end();await base.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await base.end();
 }
},{timeout:30000});
