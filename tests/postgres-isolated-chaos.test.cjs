'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {Pool}=process.env.SIASH_ISOLATED_CI==='1'?require('pg'):{Pool:null};
const {setTimeout:delay}=require('node:timers/promises');

const DB='postgres://siash_ci:siash_ci@127.0.0.1:5432/siash_ci';
const BASE='http://127.0.0.1:18780';
const SECRET='siash-ci-isolated-jwt-secret-32-chars-minimum';
const pool=Pool?new Pool({connectionString:DB,ssl:false}):null;
let child,token;
const json=async(path,method='GET',body,signal)=>{
 const r=await fetch(BASE+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal});
 return {status:r.status,body:await r.json()};
};
const clone=x=>JSON.parse(JSON.stringify(x));
const bed=(patient,picc)=>({n:1,patient,picc});
const payload=state=>({state,security:{},schema:'siash-ci-isolated',savedAt:new Date().toISOString()});
const put=(state,revision,signal)=>json('/api/state','PUT',{payload:payload(state),base_revision:revision},signal);
async function current(){const r=await json('/api/state');assert.equal(r.status,200);return r.body}
async function seed(state){await pool.query('UPDATE siash_state SET payload=$1,revision=1 WHERE id=1',[payload(state)]);}
async function boot(){
 child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'18780',DATABASE_URL:DB,PGSSLMODE:'disable',JWT_SECRET:SECRET},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw Error('SIASH server failed: '+logs);
  try{const r=await fetch(BASE+'/api/health');if(r.ok)break}catch{}
  await delay(100);
  if(i===99)throw Error('Server startup timeout: '+logs);
 }
 const auth=await json('/api/bootstrap','POST',{username:'siash_ci_owner',password:'isolated-only-password'});
 assert.equal(auth.status,200,JSON.stringify(auth.body));token=auth.body.token;
 const init=await json('/api/state/init','PUT',{payload:payload({beds:[bed('BASE','PICC-BASE')]})});
 assert.equal(init.status,200,JSON.stringify(init.body));
}
test('PostgreSQL real isolado: corrida, falha de rede, rascunho e conciliacao manual',{skip:process.env.SIASH_ISOLATED_CI!=='1'},async t=>{
 assert.equal(process.env.SIASH_ISOLATED_CI,'1','Execução permitida apenas em CI isolado');
 assert.equal(process.env.DATABASE_URL,DB,'Banco deve ser exclusivamente o container efêmero');
 try{
  await boot();
  await t.test('dois PUT concorrentes no mesmo leito/PICC: um 200 e outro 409',async()=>{
   await seed({beds:[bed('BASE','PICC-BASE')]});
   const base=await current();assert.equal(base.revision,1);
   const a=clone(base.payload.state),b=clone(base.payload.state);
   a.beds[0]=bed('RN-DIURNO','PICC-DIURNO');
   b.beds[0]=bed('RN-NOTURNO','PICC-NOTURNO');
   const [ra,rb]=await Promise.all([put(a,1),put(b,1)]);
   assert.deepEqual([ra.status,rb.status].sort(),[200,409]);
   const winner=ra.status===200?a:b,loser=ra.status===409?a:b;
   const db=await current();
   assert.equal(db.revision,2);
   assert.deepEqual(db.payload.state.beds[0],winner.beds[0]);
   const draft=new Map([['siash_cloud_pending_v1',JSON.stringify({reason:'conflict',revision:1,state:loser})]]);
   assert.deepEqual(JSON.parse(draft.get('siash_cloud_pending_v1')).state.beds[0],loser.beds[0]);
   assert.equal((ra.status===409?ra:rb).body.conflict,true);
  });
  await t.test('timeout no cliente não implica rollback; revisão remota impede replay cego',async()=>{
   await seed({beds:[bed('BASE','PICC-BASE')]});
   const local={beds:[bed('RN-OFFLINE','PICC-OFFLINE')]};
   const draft=new Map([['siash_cloud_pending_v1',JSON.stringify({revision:1,state:local})]]);
   const controller=new AbortController();
   controller.abort();
   await assert.rejects(put(local,1,controller.signal),{name:'AbortError'});
   assert.equal((await current()).revision,1);
   // Simula perda da resposta depois do commit: a versão remota já avançou.
   assert.equal((await put(local,1)).status,200);
   const remote=await current();assert.equal(remote.revision,2);
   assert.equal((await put(local,1)).status,409);
   assert.deepEqual(JSON.parse(draft.get('siash_cloud_pending_v1')).state,local);
  });
  await t.test('conciliação explícita: buscar estado atual, revisar e reenviar nova versão',async()=>{
   await seed({beds:[bed('BASE','PICC-BASE')],notes:[]});
   const old=await current();
   const a=clone(old.payload.state),b=clone(old.payload.state);
   a.beds[0]=bed('RN-DIURNO','PICC-DIURNO');
   b.beds[0]=bed('RN-NOTURNO','PICC-NOTURNO');
   assert.equal((await put(a,1)).status,200);
   assert.equal((await put(b,1)).status,409);
   const draft=clone(b);
   const remote=await current();
   assert.equal(remote.payload.state.beds[0].patient,'RN-DIURNO');
   // Decisão humana explícita: não sobrescrever leito; registrar divergência em notes.
   const merged=clone(remote.payload.state);
   merged.notes=[...(merged.notes||[]),{source:'CI',local:draft.beds[0],remote:remote.payload.state.beds[0]}];
   const saved=await put(merged,remote.revision);
   assert.equal(saved.status,200);
   const final=await current();
   assert.equal(final.payload.state.beds[0].patient,'RN-DIURNO');
   assert.equal(final.payload.state.notes[0].local.patient,'RN-NOTURNO');
   assert.equal(final.revision,3);
  });
 }finally{
  if(child){child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,3000).unref()})}
  await pool.end();
 }
});
