'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const js=fs.readFileSync('app.js','utf8');
test('auditoria identifica somente sobreposicao no mesmo dia e mes',()=>{
 const start=js.indexOf('function canguruSourceOverlap(m){');
 const end=js.indexOf('function monthStats(m){',start);
 assert.ok(start>=0&&end>start);
 const sandbox={S:{daily:[
  {date:'2026-11-01',canguru:1,altaCanguru:2},
  {date:'2026-11-02',canguru:3,altaCanguru:0},
  {date:'2026-11-03',canguru:0,altaCanguru:4},
  {date:'2026-10-01',canguru:1,altaCanguru:1}
 ]},monthOf:s=>s.slice(0,7)};
 vm.createContext(sandbox);vm.runInContext(js.slice(start,end),sandbox);
 const result=vm.runInContext('canguruSourceOverlap("2026-11")',sandbox);
 assert.equal(result.length,1);
 assert.equal(result[0].date,'2026-11-01');
 assert.equal(result[0].legacy,1);
 assert.equal(result[0].current,2);
 assert.equal(sandbox.S.daily.length,4);
});
test('aviso de auditoria nao muda total de altas ou cria deduplicacao presumida',()=>{
 assert.match(js,/canguru:sum\("canguru"\)\+sum\("altaCanguru"\)/);
 assert.match(js,/const overlaps=canguruSourceOverlap\(m\)/);
 assert.match(js,/conferir os registros antes de concluir que há duplicidade/);
 assert.match(js,/overlaps\.length\?/);
});
