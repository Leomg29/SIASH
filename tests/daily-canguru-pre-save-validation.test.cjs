'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const js=fs.readFileSync('app.js','utf8');
const start=js.indexOf('function validateDailyCanguruSubset(');
const end=js.indexOf('function syncAllDischargesToCanguru(){',start);
assert.ok(start>=0&&end>start);
const ctx={};vm.createContext(ctx);vm.runInContext(js.slice(start,end),ctx);
const check=(a,c,legacy=0)=>vm.runInContext('validateDailyCanguruSubset('+JSON.stringify(a)+','+JSON.stringify(c)+','+JSON.stringify(legacy)+')',ctx);
test('permite todas, parte ou nenhuma das altas destinadas ao Canguru',()=>{
 assert.equal(check(3,3),'');
 assert.equal(check(3,1),'');
 assert.equal(check(3,0),'');
 assert.equal(check(0,0),'');
});
test('bloqueia subset superior ao total de altas',()=>{
 assert.match(check(1,2),/não pode superar/);
 assert.match(check(0,1),/não pode superar/);
});
test('protege contra sobreposicao entre fonte historica e atual',()=>{
 assert.match(check(2,2,1),/histórico supera/);
 assert.equal(check(3,1,1),'');
 assert.equal(check(1,0,2),''); // edicao nao relacionada nao reescreve legado
});
test('rejeita valores fracionarios e negativos',()=>{
 assert.match(check(2,1.5),/inteiras/);
 assert.match(check(-1,0),/inteiras/);
 assert.match(check(1,-1),/inteiras/);
});
test('valida antes de montar registro e limpa opcao de preenchimento automatico',()=>{
 const i=js.indexOf('$("daily-form").addEventListener("submit"');
 const j=js.indexOf('const r={date,internados:',i);
 const k=js.indexOf('validateDailyCanguruSubset(',i);
 assert.ok(i>=0&&k>i&&j>k);
 assert.match(js,/\$\("d-obs"\)\.value="";\$\("d-altas-todas-canguru"\)\.checked=false\}\)/);
});

test('salvamento preserva campo legado canguru sem alterar historico',()=>{
 assert.match(js,/if\(previous&&Object\.prototype\.hasOwnProperty\.call\(previous,"canguru"\)\)r\.canguru=previous\.canguru/);
 assert.match(js,/if\(previous\?\.censusConference\)/);
});
