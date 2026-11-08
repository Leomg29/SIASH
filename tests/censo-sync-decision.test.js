const {test}=require("node:test");
const assert=require("node:assert/strict");
const {decideSync}=require("../censo-sync-decision.js");
const state=(localBaseRevision,remoteRevision,localDirty=true,remoteAvailable=true)=>({localBaseRevision,remoteRevision,localDirty,remoteAvailable});
test("sem rede, preserva dados locais e impede gravação",()=>{
 assert.deepEqual(decideSync(state(8,null,true,false)).action,"preserve-local");
 assert.equal(decideSync(state(8,null,true,false)).canWrite,false);
});
test("edições concorrentes exigem reconciliação manual",()=>{
 const result=decideSync(state(8,9));
 assert.equal(result.action,"manual-reconcile");
 assert.equal(result.canWrite,false);
});
test("sem alterações locais, permite atualização da versão remota",()=>{
 assert.equal(decideSync(state(8,9,false)).action,"refresh-remote");
});
test("versão remota inferior bloqueia gravação e exige investigação",()=>{
 assert.equal(decideSync(state(9,8)).action,"investigate");
});
test("gravação somente com revisão correspondente e alterações locais",()=>{
 assert.deepEqual(decideSync(state(8,8)),{action:"write-with-base-revision",canWrite:true,base_revision:8});
 assert.equal(decideSync(state(8,8,false)).canWrite,false);
});
test("revisões inválidas não autorizam gravação",()=>{
 assert.throws(()=>decideSync(state(0,1)),/Revisão local/);
 assert.throws(()=>decideSync(state(8,0)),/Revisão remota/);
});
