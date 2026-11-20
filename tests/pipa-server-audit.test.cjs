const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('server.js','utf8');
const start=source.indexOf('function reconcilePipaAudit(');
const end=source.indexOf('app.put("/api/state"',start);
assert.ok(start>0&&end>start);
const ctx={Date,JSON,String,Array,Object,Number};vm.createContext(ctx);
vm.runInContext(source.slice(start,end),ctx);
const reconcile=(a,b)=>vm.runInContext('reconcilePipaAudit',ctx)({state:{pipa:a}},{state:{pipa:b}},'daniel');
const row=()=>({city:'Pirapora',month:'2026-11',qty:1,note:''});
test('cancelamento gera evento auditavel e identidade confiavel do servidor',()=>{
 const result=reconcile([row()],[{...row(),cancelledAt:'2020-01-01',cancelledBy:'falso',cancelReason:'Lançamento duplicado confirmado'}]);
 assert.equal(result.events.length,1);
 assert.equal(result.events[0].index,0);
 assert.equal(result.payload.state.pipa[0].cancelledBy,'daniel');
 assert.notEqual(result.payload.state.pipa[0].cancelledAt,'2020-01-01');
});
test('impede remocao, adulteracao, reordenacao e inclusao cancelada',()=>{
 assert.match(reconcile([row()],[]).error,/remover/);
 assert.match(reconcile([row()],[{...row(),qty:5}]).error,/alterado/);
 assert.match(reconcile([],[{...row(),cancelledAt:'2026-11-20'}]).error,/nascer cancelado/);
});
test('justificativa insuficiente e cancelamento adulterado sao rejeitados',()=>{
 assert.match(reconcile([row()],[{...row(),cancelledAt:'x',cancelledBy:'falso',cancelReason:'curta'}]).error,/Justificativa/);
 const cancelled={...row(),cancelledAt:'2026-11-20',cancelledBy:'daniel',cancelReason:'Duplicidade confirmada'};
 assert.match(reconcile([cancelled],[{...cancelled,cancelReason:'Novo motivo'}]).error,/imutável/);
});
test('estado sem alteracoes e inclusao datada sao aceitos',()=>{
 assert.equal(reconcile([row()],[{...row()}]).events.length,0);
 assert.equal(reconcile([row()],[row(),{...row(),date:'2026-11-20'}]).events.length,0);
});
test('transacao persiste auditoria no banco antes de atualizar estado',()=>{
 const route=source.slice(end,source.indexOf('app.put("/api/state/init"',end));
 assert.match(source,/CREATE TABLE IF NOT EXISTS siash_pipa_cancellation_audit/);
 assert.match(route,/INSERT INTO siash_pipa_cancellation_audit/);
 assert.ok(route.indexOf('INSERT INTO siash_pipa_cancellation_audit')<route.indexOf('UPDATE siash_state'));
 assert.match(route,/ROLLBACK/);
});

test('servidor devolve carimbo autoritativo e cliente concilia somente sem novas edicoes',()=>{
 const app=fs.readFileSync('app.js','utf8');
 assert.match(source,/pipa_cancellations:pipaAudit\.events\.map/);
 assert.match(app,/generation===SIASH_CLOUD\.editGeneration&&Array\.isArray\(r\.pipa_cancellations\)/);
 assert.match(app,/record\.cancelledAt=item\.cancelledAt;record\.cancelledBy=item\.cancelledBy/);
});

test('aceita base historica sem chave PIPA e preserva novos encaminhamentos',()=>{
 const result=vm.runInContext('reconcilePipaAudit',ctx)({state:{}},{state:{pipa:[row()]}},'daniel');
 assert.equal(result.events.length,0);
 assert.equal(result.payload.state.pipa[0].city,'Pirapora');
});
test('impede adulteracao isolada do timestamp updated em registro ativo',()=>{
 const old={...row(),updated:'anterior'};
 assert.match(reconcile([old],[{...old,updated:'adulterado'}]).error,/não auditada/);
});
