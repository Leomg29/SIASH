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
    localStorage:storage,document:{getElementById:()=>status},
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
