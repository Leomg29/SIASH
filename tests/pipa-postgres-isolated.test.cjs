"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{setTimeout:delay}=require("node:timers/promises");
test("PR98 PostgreSQL: PIPA legacy immutability, 409, 422 and append-only rectification",{skip:process.env.SIASH_ISOLATED_CI!=="1",timeout:120000},async()=>{
 assert.match(process.env.DATABASE_URL||"",/siash_ci/);
 const {Pool}=require("pg"),bcrypt=require("bcryptjs");
 const db=new Pool({connectionString:process.env.DATABASE_URL,ssl:false}),port=18908,url="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["server.js"],{env:{...process.env,PORT:String(port),PGSSLMODE:"disable",JWT_SECRET:"pr98-postgres-isolated-secret-2026"},stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",d=>logs+=d);child.stderr.on("data",d=>logs+=d);
 const clone=x=>JSON.parse(JSON.stringify(x));
 try{
  for(let i=0;i<150;i++){try{if((await fetch(url+"/api/health")).ok)break}catch{}if(child.exitCode!==null)throw Error(logs);if(i===149)throw Error(logs);await delay(100)}
  const username="pr98_"+Date.now(),password="PR98Isolated!2026";
  await db.query("INSERT INTO siash_users(username,password_hash,role) VALUES($1,$2,'operational')",[username,await bcrypt.hash(password,4)]);
  const login=await fetch(url+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password})});
  assert.equal(login.status,200);const token=(await login.json()).token,headers={"content-type":"application/json",authorization:"Bearer "+token};
  const beds=Array.from({length:10},(_,i)=>({n:i+1,isolation:i>=8,status:"Livre",profile:"Intensivo",rn:"",note:""}));
  const legacy={month:"2024-02",city:"Ibiaí",qty:2,note:"Legado sem UUID ou data",updated:"2024"};
  const dated={id:"pipa-pr98-dated",date:"2026-11-20",month:"2026-11",city:"Pirapora",qty:1,postDischargeConfirmed:true,updated:"20/11/2026"};
  const payload={state:{beds,bedMoves:[],profileHistory:[],movements:[],daily:[],picc:[],piccEvents:[],pipa:[legacy,dated]},security:{},schema:"pr98-ci"};
  await db.query("UPDATE siash_state SET payload=$1,revision=1 WHERE id=1",[payload]);
  const history=Number((await db.query("SELECT COUNT(*) n FROM siash_state_history")).rows[0].n);
  const cancellation=Number((await db.query("SELECT COUNT(*) n FROM siash_pipa_cancellation_audit")).rows[0].n);
  const request=async(path,method,body)=>{const r=await fetch(url+path,{method,headers,body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
  const put=(p,rev)=>request("/api/state","PUT",{payload:p,base_revision:rev});
  const removed=clone(payload);removed.state.pipa.pop();assert.equal((await put(removed,1)).status,422);
  const changed=clone(payload);changed.state.pipa[0].city="Ibiai";assert.equal((await put(changed,1)).status,422);
  const changedQty=clone(payload);changedQty.state.pipa[1].qty=3;assert.equal((await put(changedQty,1)).status,422);
  assert.equal(Number((await db.query("SELECT COUNT(*) n FROM siash_state_history")).rows[0].n),history);
  assert.equal(Number((await db.query("SELECT COUNT(*) n FROM siash_pipa_cancellation_audit")).rows[0].n),cancellation);
  const rect=await request("/api/pipa/rectifications","POST",{base_revision:1,record_index:0,reason:"Conferência documental do registro histórico",correction:"Grafia municipal deve ser conferida pelo profissional"});
  assert.equal(rect.status,200,JSON.stringify(rect.data));assert.equal(rect.data.username,username);assert.match(rect.data.id,/^[0-9a-f-]{36}$/i);
  assert.ok(rect.data.created_at);assert.ok(rect.data.created_at_sao_paulo);
  const rows=await db.query("SELECT username,record_before,correction,reason,created_at FROM siash_pipa_rectification_audit WHERE id=$1",[rect.data.id]);
  assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].username,username);assert.deepEqual(rows.rows[0].record_before,legacy);
  const afterRect=await db.query("SELECT payload,revision FROM siash_state WHERE id=1");
  assert.deepEqual(afterRect.rows[0].payload,payload);assert.equal(Number(afterRect.rows[0].revision),1);
  const addition=clone(payload);addition.state.pipa.push({id:"pipa-pr98-new",date:"2026-11-21",month:"2026-11",city:"Ibiaí",qty:1,postDischargeConfirmed:true,updated:"21/11/2026"});
  const ok=await put(addition,1);assert.equal(ok.status,200,JSON.stringify(ok.data));
  assert.equal((await put(payload,1)).status,409);
  const stale=await request("/api/pipa/rectifications","POST",{base_revision:1,record_index:0,reason:"Conferência documental do registro histórico",correction:"Retificação com revisão desatualizada"});
  assert.equal(stale.status,409);
  const final=await db.query("SELECT payload,revision FROM siash_state WHERE id=1");
  assert.equal(Number(final.rows[0].revision),2);assert.deepEqual(final.rows[0].payload.state.pipa[0],legacy);
  assert.equal(Number((await db.query("SELECT COUNT(*) n FROM siash_pipa_cancellation_audit")).rows[0].n),cancellation);
  assert.equal(Number((await db.query("SELECT COUNT(*) n FROM siash_state_history")).rows[0].n),history+1);
 }finally{child.kill("SIGTERM");await db.end()}
});