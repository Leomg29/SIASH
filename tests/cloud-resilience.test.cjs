const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Testes da lógica real do início de app.js em sandbox sem rede e sem banco.
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const end = source.indexOf('async function uploadDocCloud(');
assert.ok(end > 0, 'Bloco cloud não encontrado');
const cloudSource = source.slice(0, end);
function harness({responses=[],initialPending=null}={}){
  const data = new Map();
  if(initialPending)data.set('siash_cloud_pending_v1',JSON.stringify(initialPending));
  const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
  const events=[], requests=[], timers=[];
  const status={textContent:'',classList:{toggle(){}}};
  const context={
    location:{protocol:'https:'},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    localStorage:storage,document:{getElementById:id=>id==='cloud-status'?status:null},
    navigator:{onLine:true},window:{addEventListener:(...args)=>events.push(args)},
    console:{error(){}},alert:()=>{},Date,JSON,Number,Math,
    setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{},
    fetch:async(url,opts)=>{requests.push({url,opts});const next=responses.shift();if(next instanceof Error)throw next;if(!next)throw Error('Unexpected request');return {ok:next.status>=200&&next.status<300,status:next.status,json:async()=>next.body}}
  };
  vm.createContext(context);
  vm.runInContext(cloudSource,context);
  vm.runInContext('S={census:{test:1}}; SESSION={authenticated:true,user:"enfermeiro-teste",role:"operational"}; SIASH_CLOUD.token="token-ficticio"; SIASH_CLOUD.revision=1; normalize=()=>{};loadSharedPending=()=>{};securityState=()=>({})',context);
  async function tick(){const fn=timers.shift();assert.ok(fn,'Nenhum timer agendado');await fn();await new Promise(resolve=>setImmediate(resolve));}
  return {context,data,requests,status,tick,eval:code=>vm.runInContext(code,context)};
}
test('rascunho é persistido antes da primeira requisição',async()=>{
 const h=harness({responses:[{status:200,body:{revision:2}}]});
 h.eval('scheduleCloudSave()');
 assert.ok(h.data.has('siash_cloud_pending_v1'));
 assert.equal(h.requests.length,0);
 await h.tick();
 assert.equal(h.data.has('siash_cloud_pending_v1'),false);
 assert.match(h.status.textContent,/Sincronizado/);
});
test('HTTP 409 preserva rascunho e bloqueia novo envio',async()=>{
 const h=harness({responses:[{status:409,body:{conflict:true,error:'Conflito'}}]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.ok(h.data.has('siash_cloud_pending_v1'));
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.match(h.status.textContent,/CONFLITO/);
});
test('HTTP 401 preserva rascunho e bloqueia sincronização',async()=>{
 const h=harness({responses:[{status:401,body:{error:'Sessão expirada'}}]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).reason,'session-expired');
});
test('resposta perdida com revisão alterada bloqueia reenvio',async()=>{
 const h=harness({responses:[new Error('Network lost'),{status:200,body:{exists:true,revision:2}}]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(h.requests.length,2);
 assert.ok(h.data.has('siash_cloud_pending_v1'));
});
test('falha transitória com revisão inalterada agenda retry',async()=>{
 const h=harness({responses:[new Error('Network lost'),{status:200,body:{exists:true,revision:1}}]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.conflict'),false);
 assert.match(h.status.textContent,/aguardando reconexão/);
 assert.ok(h.data.has('siash_cloud_pending_v1'));
});
test('novo login com rascunho pendente não substitui estado local',async()=>{
 const pending={user:'enfermeiro-teste',revision:1,state:{census:{test:42}}};
 const h=harness({initialPending:pending,responses:[{status:200,body:{exists:true,revision:2,payload:{state:{census:{test:0}}}}}]});
 await h.eval('cloudLoadAfterLogin()');
 assert.equal(h.eval('S.census.test'),42);
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
});

test('dois usuários: o segundo salvamento com revisão antiga recebe 409 e preserva rascunho',async()=>{
 let serverRevision=1;
 const makeResponse=async(url,opts)=>{
   if(url==='/api/state'&&opts?.method==='PUT'){
     const body=JSON.parse(opts.body);
     if(body.base_revision!==serverRevision)return {status:409,body:{conflict:true,current_revision:serverRevision,error:'Conflito de revisão'}};
     serverRevision++;
     return {status:200,body:{revision:serverRevision}};
   }
   throw Error('Requisição inesperada: '+url);
 };
 const first=harness();
 const second=harness();
 // A resposta de ambos é calculada no momento do PUT contra o mesmo servidor fictício.
 for(const h of [first,second]){
   h.context.fetch=async(url,opts)=>{
     h.requests.push({url,opts});
     const r=await makeResponse(url,opts);
     return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>r.body};
   };
 }
 first.eval('scheduleCloudSave()');
 second.eval('scheduleCloudSave()');
 await first.tick();
 await second.tick();
 assert.equal(serverRevision,2);
 assert.equal(first.eval('SIASH_CLOUD.revision'),2);
 assert.equal(second.eval('SIASH_CLOUD.conflict'),true);
 assert.ok(second.data.has('siash_cloud_pending_v1'));
});
test('rascunho pertencente a outro usuário não é carregado',async()=>{
 const h=harness({initialPending:{user:'outro-usuario',revision:1,state:{census:{test:99}}}});
 await assert.rejects(async()=>h.eval('cloudLoadAfterLogin()'),/outro usuário/);
 assert.equal(h.eval('S.census.test'),1);
 assert.ok(h.data.has('siash_cloud_pending_v1'));
});

test('novo login offline recupera rascunho sem sobrescrever estado',async()=>{
 const pending={user:'enfermeiro-teste',revision:1,state:{census:{test:77}}};
 const h=harness({initialPending:pending,responses:[new Error('offline')]});
 await h.eval('cloudLoadAfterLogin()');
 assert.equal(h.eval('S.census.test'),77);
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.match(h.status.textContent,/OFFLINE/);
 assert.ok(h.data.has('siash_cloud_pending_v1'));
});
test('erro HTTP 503 com revisão estável mantém rascunho e programa retry',async()=>{
 const h=harness({responses:[{status:503,body:{error:'temporariamente indisponível'}},{status:200,body:{exists:true,revision:1}}]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.conflict'),false);
 assert.ok(h.data.has('siash_cloud_pending_v1'));
 assert.match(h.status.textContent,/aguardando reconexão/);
});

test('retry nao cria uma nova geracao de edicao',async()=>{
 const h=harness({responses:[{status:200,body:{revision:2}}]});
 h.eval('scheduleCloudSave()');
 const generation=h.eval('SIASH_CLOUD.editGeneration');
 h.eval('scheduleCloudSave({retry:true})');
 assert.equal(h.eval('SIASH_CLOUD.editGeneration'),generation);
 await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.revision'),2);
});
test('retry sem rascunho pendente nao envia dados',()=>{
 const h=harness();
 h.eval('scheduleCloudSave({retry:true})');
 assert.equal(h.requests.length,0);
 assert.equal(h.eval('SIASH_CLOUD.editGeneration'),0);
});

test('401 na consulta apos falha de PUT interrompe retry e preserva rascunho',async()=>{
 const h=harness({responses:[new Error('Network lost'),{status:401,body:{error:'Sessão expirada'}}]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).reason,'session-expired');
 assert.match(h.status.textContent,/Sessão expirada/);
});

test('migracao inicial utiliza revisao retornada pelo servidor',async()=>{
 const h=harness({responses:[{status:200,body:{exists:false}},{status:200,body:{ok:true,revision:7}}]});
 h.data.set('siash_utin_consolidada_v08',JSON.stringify({census:{test:1}}));
 const ok=await h.eval('cloudLoadAfterLogin()');
 assert.equal(ok,true);
 assert.equal(h.eval('SIASH_CLOUD.revision'),7);
 assert.equal(h.requests[1].url,'/api/state/init');
});
test('migracao sem revisao valida nao marca sincronizacao como concluida',async()=>{
 const h=harness({responses:[{status:200,body:{exists:false}},{status:200,body:{ok:true}}]});
 h.data.set('siash_utin_consolidada_v08',JSON.stringify({census:{test:1}}));
 await assert.rejects(h.eval('cloudLoadAfterLogin()'),/revisão válida/);
 assert.equal(h.eval('SIASH_CLOUD.revision'),1);
 assert.doesNotMatch(h.status.textContent,/Dados locais migrados/);
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).reason,'revision-unavailable');
});

test('conflito HTTP 409 na migracao inicial preserva copia local',async()=>{
 const h=harness({responses:[{status:200,body:{exists:false}},{status:409,body:{conflict:true,error:'Estado central ja existe'}}]});
 h.data.set('siash_utin_consolidada_v08',JSON.stringify({census:{test:1}}));
 await assert.rejects(h.eval('cloudLoadAfterLogin()'),/Migração inicial não confirmada/);
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 const draft=JSON.parse(h.data.get('siash_cloud_pending_v1'));
 assert.equal(draft.reason,'initialization-conflict');
 assert.equal(draft.state.census.test,1);
});
test('queda de rede na migracao inicial exige conciliacao sem reenviar',async()=>{
 const h=harness({responses:[{status:200,body:{exists:false}},new Error('network interrupted')]});
 h.data.set('siash_utin_consolidada_v08',JSON.stringify({census:{test:1}}));
 await assert.rejects(h.eval('cloudLoadAfterLogin()'),/Migração inicial não confirmada/);
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).reason,'initialization-unconfirmed');
 h.eval('scheduleCloudSave()');
 assert.equal(h.requests.length,2);
});

test('estado remoto existente sem payload valido nao aciona migracao inicial',async()=>{
 const h=harness({responses:[{status:200,body:{exists:true,revision:4}}]});
 h.data.set('siash_utin_consolidada_v08',JSON.stringify({census:{test:1}}));
 await assert.rejects(h.eval('cloudLoadAfterLogin()'),/estado existente sem dados válidos/);
 assert.equal(h.requests.length,1);
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).reason,'remote-state-invalid');
});

test('falha de PUT seguida de falha no GET bloqueia retry e mantém rascunho',async()=>{
 const h=harness({responses:[new Error('PUT sem confirmação'),new Error('GET indisponível')]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.requests.length,2);
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).reason,'confirmation-unknown');
 assert.match(h.status.textContent,/SALVAMENTO INCERTO/);
 h.eval('scheduleCloudSave({retry:true})');
 assert.equal(h.requests.length,2);
});
test('GET sem revisão após falha de PUT exige conciliação',async()=>{
 const h=harness({responses:[new Error('PUT sem confirmação'),{status:200,body:{exists:true}}]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).reason,'confirmation-unknown');
 assert.match(h.status.textContent,/SALVAMENTO INCERTO/);
});
test('GET com revisão não numérica não autoriza reenvio',async()=>{
 const h=harness({responses:[new Error('PUT sem confirmação'),{status:200,body:{exists:true,revision:'1'}}]});
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(h.requests.length,2);
 assert.ok(h.data.has('siash_cloud_pending_v1'));
});

test('confirmacao do servidor atualiza autor data e justificativa PIPA no estado local',async()=>{
 const h=harness({responses:[{status:200,body:{revision:2,pipa_cancellations:[{index:0,cancelledAt:'2026-11-20T12:00:00.000Z',cancelledBy:'enfermeiro-teste',cancelReason:'Duplicidade confirmada'}]}}]});
 h.eval('S.pipa=[{city:"Pirapora",month:"2026-11",qty:1,cancelledAt:"provisorio",cancelledBy:"local",cancelReason:"  Duplicidade confirmada  "}]');
 h.eval('scheduleCloudSave()');await h.tick();
 assert.equal(h.eval('S.pipa[0].cancelledAt'),'2026-11-20T12:00:00.000Z');
 assert.equal(h.eval('S.pipa[0].cancelledBy'),'enfermeiro-teste');
 assert.equal(h.eval('S.pipa[0].cancelReason'),'Duplicidade confirmada');
 assert.equal(h.eval('SIASH_CLOUD.revision'),2);
 assert.equal(h.data.has('siash_cloud_pending_v1'),false);
});

test('race condition: dois plantoes editam mesmo leito; somente um commit e outro preserva rascunho',async()=>{
 let revision=1;
 let remoteBed={n:1,status:'Livre',patient:''};
 const requests=[];
 let release;
 const barrier=new Promise(resolve=>{release=resolve});
 let arrived=0;
 const server=async(url,opts)=>{
   assert.equal(url,'/api/state');
   assert.equal(opts.method,'PUT');
   const body=JSON.parse(opts.body);
   requests.push(body);
   arrived++;
   if(arrived===2)release();
   await barrier;
   // Equivalente ao SELECT FOR UPDATE + verificação de base_revision no PostgreSQL.
   if(body.base_revision!==revision){
     return {ok:false,status:409,json:async()=>({conflict:true,current_revision:revision,error:'Conflito de revisão'})};
   }
   remoteBed=JSON.parse(JSON.stringify(body.payload.state.beds[0]));
   revision++;
   return {ok:true,status:200,json:async()=>({revision})};
 };
 const a=harness(),b=harness();
 for(const [h,user,patient] of [[a,'plantao-a','RN-A'],[b,'plantao-b','RN-B']]){
   h.eval('SESSION.user='+JSON.stringify(user));
   h.eval('S.beds=[{n:1,status:"Ocupado",patient:'+JSON.stringify(patient)+'}]');
   h.context.fetch=async(url,opts)=>{h.requests.push({url,opts});return server(url,opts)};
   h.eval('scheduleCloudSave()');
 }
 await Promise.all([a.tick(),b.tick()]);
 assert.equal(requests.length,2,'ambos tentaram gravar a mesma revisão');
 assert.equal(revision,2,'apenas uma gravação pode avançar a revisão');
 const winner=remoteBed.patient==='RN-A'?a:b;
 const loser=winner===a?b:a;
 const losingPatient=winner===a?'RN-B':'RN-A';
 assert.equal(winner.eval('SIASH_CLOUD.revision'),2);
 assert.equal(loser.eval('SIASH_CLOUD.conflict'),true,'o perdedor deve sinalizar conflito');
 assert.equal(loser.eval('S.beds[0].patient'),losingPatient,'a edição local não pode ser substituída');
 assert.equal(JSON.parse(loser.data.get('siash_cloud_pending_v1')).state.beds[0].patient,losingPatient,'o rascunho deve persistir');
 assert.match(loser.status.textContent,/CONFLITO/);
 loser.eval('scheduleCloudSave({retry:true})');
 assert.equal(loser.requests.length,1,'não reenviar automaticamente após 409');
});

test('GET atrasado no login não sobrescreve edição local feita durante a consulta',async()=>{
 let release;
 const waiting=new Promise(resolve=>{release=resolve});
 const h=harness();
 h.context.fetch=async()=>{await waiting;return {ok:true,status:200,json:async()=>({exists:true,revision:2,payload:{state:{beds:[{n:1,patient:'RN-remoto'}]}}})}};
 const loading=h.eval('cloudLoadAfterLogin()');
 h.eval('S.beds=[{n:1,patient:"RN-local"}];scheduleCloudSave()');
 release();
 await loading;
 assert.equal(h.eval('S.beds[0].patient'),'RN-local');
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).state.beds[0].patient,'RN-local');
});

test('DOM clinico: HTTP 409 preserva formulario e apresenta comparacao local/remoto',async()=>{
 const h=harness({responses:[
  {status:409,body:{conflict:true,error:'Revisão obsoleta'}},
  {status:200,body:{exists:true,revision:2,payload:{state:{beds:[{n:1,patient:'RN-SERVIDOR'}]}}}}
 ]});
 const elements=new Map();
 for(const id of ['cloud-conflict-panel','cloud-conflict-local','cloud-conflict-remote','cloud-conflict-message','cloud-conflict-refresh','cloud-conflict-close'])
  elements.set(id,{hidden:true,textContent:'',onclick:null});
 const oldGet=h.context.document.getElementById;
 h.context.document.getElementById=id=>elements.get(id)||oldGet(id);
 h.eval('S.beds=[{n:1,patient:"RN-LOCAL"}];scheduleCloudSave()');
 await h.tick();
 assert.equal(h.eval('SIASH_CLOUD.conflict'),true);
 assert.equal(h.eval('S.beds[0].patient'),'RN-LOCAL');
 assert.equal(JSON.parse(h.data.get('siash_cloud_pending_v1')).state.beds[0].patient,'RN-LOCAL');
 assert.equal(elements.get('cloud-conflict-panel').hidden,false);
 assert.match(elements.get('cloud-conflict-local').textContent,/RN-LOCAL/);
 assert.match(elements.get('cloud-conflict-remote').textContent,/RN-SERVIDOR/);
 assert.equal(h.eval('SIASH_CLOUD.revision'),1,'não atualizar revisão automaticamente');
 h.eval('scheduleCloudSave({retry:true})');
 assert.equal(h.requests.filter(r=>r.opts?.method==='PUT').length,1,'não reenviar dados conflitantes');
});
