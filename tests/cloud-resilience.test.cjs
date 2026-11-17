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
