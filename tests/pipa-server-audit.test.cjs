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
 assert.equal(reconcile([row()],[row(),{...row(),date:'2026-11-20',postDischargeConfirmed:true}]).events.length,0);
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
 assert.match(app,/Array\.isArray\(r\.pipa_cancellations\)&&r\.pipa_cancellations\.length/);
 assert.match(app,/if\(generation!==SIASH_CLOUD\.editGeneration\)preserveCloudDraft\("pending"\)/);
 assert.match(app,/record\.cancelledAt=item\.cancelledAt;/);
 assert.match(app,/record\.cancelledBy=item\.cancelledBy;/);
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

test('rejeicao 422 bloqueia repeticao automatica e preserva rascunho',()=>{
 const app=fs.readFileSync('app.js','utf8');
 assert.match(app,/e\.status===409\|\|e\.status===428\|\|e\.status===422\?"conflict":"network"/);
 assert.match(app,/else if\(e\.conflict\|\|e\.status===409\|\|e\.status===428\|\|e\.status===422\)/);
 assert.match(app,/SIASH_CLOUD\.conflict=true;\s*localStorage\.setItem\(STORE,JSON\.stringify\(S\)\)/);
});

test('falha de rede apos commit exige conciliacao antes de reenviar',()=>{
 const app=fs.readFileSync('app.js','utf8');
 const start=app.indexOf('function scheduleCloudSave(');
 const end=app.indexOf('function scheduleCloudSaveRetry(',start);
 const save=app.slice(start,end);
 assert.match(save,/remote\.revision!==SIASH_CLOUD\.revision/);
 assert.match(save,/SIASH_CLOUD\.conflict=true;\s*updateCloudBadge\("CONFIRMAÇÃO INCERTA/);
 assert.match(save,/if\(!SIASH_CLOUD\.conflict&&generation!==SIASH_CLOUD\.editGeneration\)/);
});
test('interface diferencia erro de integridade PIPA de conflito entre usuarios',()=>{
 const app=fs.readFileSync('app.js','utf8');
 assert.match(app,/e\.status===422\?"INTEGRIDADE PIPA/);
 assert.match(app,/O servidor recusou uma alteração do PIPA por inconsistência de integridade/);
});

test('historico mensal sem data e preservado e pode ser cancelado com auditoria',()=>{
 const historic={month:'2026-11',city:'Pirapora',qty:1,note:'Histórico sem data'};
 const incoming={...historic,cancelledAt:'2026-11-20T00:00:00Z',cancelledBy:'outro',cancelReason:'Duplicidade verificada no fechamento'};
 const result=reconcile([historic],[incoming]);
 assert.equal(result.events.length,1);
 assert.equal(result.events[0].before.date,undefined);
 assert.equal(result.payload.state.pipa[0].cancelledBy,'daniel');
 assert.equal(result.payload.state.pipa[0].date,undefined);
 assert.match(reconcile([result.payload.state.pipa],[historic]).error,/imutável|alterado ou reordenado/);
});
test('controle de revisao e verificacao PIPA ocorrem sob o mesmo bloqueio de escrita',()=>{
 const route=source.slice(end,source.indexOf('app.put("/api/state/init"',end));
 const lock=route.indexOf('SELECT payload,revision FROM siash_state WHERE id=1 FOR UPDATE');
 const revision=route.indexOf('if(current!==base)');
 const validation=route.indexOf('reconcilePipaAudit(');
 const update=route.indexOf('UPDATE siash_state SET payload=');
 assert.ok(lock>=0&&revision>lock&&validation>revision&&update>validation);
 assert.match(route,/if\(current!==base\).*?res\.status\(409\)/s);
 assert.match(route,/if\(pipaAudit\.error\).*?res\.status\(422\)/s);
});

test('justificativa PIPA e normalizada no estado e na auditoria',()=>{
 const reason='   Duplicidade confirmada no fechamento   ';
 const result=reconcile([row()],[{...row(),cancelledAt:'2020-01-01',cancelledBy:'falso',cancelReason:reason}]);
 assert.equal(result.events[0].reason,'Duplicidade confirmada no fechamento');
 assert.equal(result.payload.state.pipa[0].cancelReason,result.events[0].reason);
});

test('dois cancelamentos simultaneos geram eventos distintos e preservam a ordem',()=>{
 const a={...row(),city:'Pirapora',qty:1};
 const b={...row(),city:'Buritizeiro',qty:2};
 const after=[
  {...a,cancelledAt:'falso',cancelledBy:'terceiro',cancelReason:'Duplicidade confirmada no censo'},
  {...b,cancelledAt:'falso',cancelledBy:'terceiro',cancelReason:'Encaminhamento registrado em duplicidade'}
 ];
 const result=reconcile([a,b],after);
 assert.equal(result.events.length,2);
 assert.equal(result.events[0].index,0);
 assert.equal(result.events[1].index,1);
 assert.equal(result.events[0].before.city,'Pirapora');
 assert.equal(result.events[1].before.city,'Buritizeiro');
 assert.equal(result.payload.state.pipa[0].cancelledBy,'daniel');
 assert.equal(result.payload.state.pipa[1].cancelledBy,'daniel');
 assert.ok(result.payload.state.pipa.every(x=>!Number.isNaN(Date.parse(x.cancelledAt))));
});
test('lote com justificativa invalida nao pode ser persistido parcialmente',()=>{
 const a={...row(),city:'Pirapora'};
 const b={...row(),city:'Buritizeiro'};
 const result=reconcile([a,b],[
  {...a,cancelledAt:'falso',cancelledBy:'daniel',cancelReason:'Duplicidade confirmada no fechamento'},
  {...b,cancelledAt:'falso',cancelledBy:'daniel',cancelReason:'curta'}
 ]);
 assert.match(result.error,/Justificativa/);
 const route=source.slice(end,source.indexOf('app.put("/api/state/init"',end));
 assert.ok(route.indexOf('if(pipaAudit.error)')<route.indexOf('INSERT INTO siash_pipa_cancellation_audit'));
 assert.match(route,/if\(pipaAudit\.error\)\{await client\.query\("ROLLBACK"\)/);
});

test('rejeita justificativa PIPA que nao seja texto',()=>{
 for(const value of [1234567890123,{motivo:'duplicado'},['duplicidade confirmada'],null]){
  const result=reconcile([row()],[{...row(),cancelledAt:'2026-11-20',cancelledBy:'falso',cancelReason:value}]);
  assert.match(result.error,/texto válido/);
 }
});

test('inclusao PIPA rejeita campos invalidos sem alterar historico',()=>{
 const invalid=[
  {...row(),city:''},
  {...row(),month:'2026-13'},
  {...row(),qty:0},
  {...row(),qty:1.5},
  {...row(),date:'2026-11-31'},
  {...row(),date:'2026-10-20'}
 ];
 for(const item of invalid)assert.ok(reconcile([row()],[row(),item]).error);
 const legacy={...row(),note:'Registro histórico sem data'};
 assert.equal(reconcile([legacy],[legacy,{...row(),date:'2026-11-20',postDischargeConfirmed:true}]).events.length,0);
});

test('indicadores PIPA excluem registros cancelados sem apagar historico',()=>{
 const app=fs.readFileSync('app.js','utf8');
 assert.match(app,/function pipaCountOn\(date\)\{return S\.pipa\.filter\(x=>!x\.cancelledAt&&x\.date===date\)/);
 assert.match(app,/window\.deletePipa=i=>\{/);
 assert.match(app,/r\.cancelledAt=new Date\(\)\.toISOString\(\)/);
 assert.doesNotMatch(app,/S\.pipa\.splice\(/);
});
test('cadastro PIPA exige confirmacao de encaminhamento apos alta',()=>{
 const app=fs.readFileSync('app.js','utf8');
 assert.match(app,/if\(!\$\("pipa-post-discharge"\)\.checked\)return alert/);
 assert.match(app,/postDischargeConfirmed:true/);
});

test('servidor exige alta confirmada para novos encaminhamentos datados',()=>{
 const dated={...row(),date:'2026-11-20'};
 assert.match(reconcile([],[dated]).error,/após a alta/);
 assert.match(reconcile([],[{...dated,postDischargeConfirmed:'true'}]).error,/após a alta/);
 assert.equal(reconcile([],[{...dated,postDischargeConfirmed:true}]).events.length,0);
 // Histórico legado sem data permanece compatível.
 assert.equal(reconcile([],[row()]).events.length,0);
});

test('registro PIPA cancelado acusa adulteracao especifica em qualquer campo',()=>{
 const cancelled={...row(),cancelledAt:'2026-11-20T12:00:00.000Z',cancelledBy:'daniel',cancelReason:'Duplicidade confirmada'};
 for(const altered of [
  {...cancelled,qty:2},
  {...cancelled,city:'Buritizeiro'},
  {...cancelled,cancelledBy:'outro'},
  {...cancelled,cancelReason:'Motivo adulterado'},
  {...cancelled,cancelledAt:'2026-11-19T12:00:00.000Z'}
 ])assert.match(reconcile([cancelled],[altered]).error,/Auditoria PIPA cancelada é imutável/);
 assert.equal(reconcile([cancelled],[{...cancelled}]).events.length,0);
});
