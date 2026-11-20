const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf('function showPendingHistoryDialog(');
const end=source.indexOf('$("pending-list").addEventListener("click"',start);
assert.ok(start>0&&end>start,'modal handler missing');
const fn=source.slice(start,end);
function harness(){
 const elements={};
 const dialog={id:'',style:{cssText:''},setAttribute(){},innerHTML:'',showModal(){this.open=true},close(){this.open=false},querySelector(){return {addEventListener:(name,fn)=>{this.closeFn=fn}}}};
 const document={createElement:tag=>{assert.equal(tag,'dialog');return dialog},body:{appendChild:d=>{elements[d.id]=d}},getElementById:id=>elements[id]};
 const safe=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const ctx={document,safe,Date,Number};vm.createContext(ctx);vm.runInContext(fn,ctx);
 return {dialog,show:items=>vm.runInContext('showPendingHistoryDialog',ctx)(items)};
}
test('historico abre modal com tabela e fecha sem salvar',()=>{
 const h=harness();h.show([{created_at:'2026-11-20T13:11:08Z',actor:'leomg29',action:'Situação alterada',previous_status:'Pendente',new_status:'Concluída'}]);
 assert.equal(h.dialog.open,true);
 assert.match(h.dialog.innerHTML,/Data e hora/);
 assert.match(h.dialog.innerHTML,/leomg29/);
 assert.match(h.dialog.innerHTML,/Pendente.*Concluída/);
 h.dialog.closeFn();assert.equal(h.dialog.open,false);
});
test('historico escapa conteudo nao confiavel e aceita vazio',()=>{
 const h=harness();h.show([{actor:'<img src=x onerror=alert(1)>',action:'teste',previous_status:'',new_status:''}]);
 assert.doesNotMatch(h.dialog.innerHTML,/<img/);
 assert.match(h.dialog.innerHTML,/&lt;img/);
 h.dialog.closeFn();h.show([]);
 assert.match(h.dialog.innerHTML,/Sem histórico registrado/);
});
