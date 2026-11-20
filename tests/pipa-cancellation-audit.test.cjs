const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
test('PIPA: tabela identifica origem e cancelamento',()=>{
 assert.match(html,/<th>Origem<\/th><th>Situação \/ Auditoria<\/th>/);
 assert.match(source,/Histórico sem data/);
 assert.match(source,/cancelReason/);
 assert.doesNotMatch(source,/S\.pipa\.splice\(/);
});
test('PIPA: todos os agregados ignoram cancelados',()=>{
 for(const fn of ['pipaCountOn','pipaReconciliationSummary','pipaMonthTotal','renderPipa']){
  const start=source.indexOf('function '+fn+'(');
  assert.ok(start>=0,fn+' missing');
  const end=source.indexOf('\nfunction ',start+10);
  const segment=source.slice(start,end<0?start+5000:end);
  assert.match(segment,/!x\.cancelledAt/,fn+' must ignore cancelled rows');
 }
});
test('PIPA: cancelamento exige confirmação e justificativa e preserva registro',()=>{
 const start=source.indexOf('window.deletePipa=i=>{');
 const end=source.indexOf('let sharedPending=[]',start);
 assert.ok(start>=0&&end>start);
 const state={pipa:[{city:'Pirapora',qty:1,month:'2026-11',updated:'anterior'}]};
 const ctx={S:state,SESSION:{user:'daniel'},confirm:()=>true,prompt:()=> 'Correção de lançamento duplicado',nowBR:()=> '20/11/2026',showToast:()=>{},save:()=>{ctx.saved=true},alert:()=>{throw Error('unexpected alert')},Date,String};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 vm.runInContext('deletePipa(0)',ctx);
 assert.equal(state.pipa.length,1);
 assert.equal(state.pipa[0].cancelledBy,'daniel');
 assert.equal(state.pipa[0].cancelReason,'Correção de lançamento duplicado');
 assert.ok(state.pipa[0].cancelledAt);
 assert.equal(ctx.saved,true);
});
test('PIPA: cancelamento abortado nao modifica registro',()=>{
 const start=source.indexOf('window.deletePipa=i=>{');
 const end=source.indexOf('let sharedPending=[]',start);
 const state={pipa:[{city:'Pirapora',qty:1,month:'2026-11'}]};
 const ctx={S:state,SESSION:{user:'daniel'},confirm:()=>false,prompt:()=>{throw Error('prompt should not run')},save:()=>{throw Error('should not save')},Date,String};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);vm.runInContext('deletePipa(0)',ctx);
 assert.equal(state.pipa[0].cancelledAt,undefined);
});
