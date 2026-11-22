'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
test('indicadores exibem uma unica linha canguru e nao exibem destino pediatria',()=>{
 const start=source.indexOf('function renderIndicators()');
 const end=source.indexOf('function ',start+10);
 assert.ok(start>=0&&end>start);
 const section=source.slice(start,end);
 assert.equal((section.match(/\["Altas → Leito Canguru",c\.canguru\]/g)||[]).length,1);
 assert.doesNotMatch(section,/\["Altas → Pediatria"/);
 assert.doesNotMatch(section,/Altas para Leito Canguru \(total\)/);
});
test('agregacao mensal existente permanece preservada para historico e registros atuais',()=>{
 const start=source.indexOf('function monthStats(m)');
 const end=source.indexOf('function allMonths()',start);
 assert.ok(start>=0&&end>start);
 const section=source.slice(start,end);
 assert.match(section,/canguru:sum\("canguru"\)\+sum\("altaCanguru"\)/);
 assert.match(section,/altaPediatria:sum\("altaPediatria"\)/);
});
test('calculo de mes preserva as duas origens sem modificar registros',()=>{
 const start=source.indexOf('function monthStats(m)');
 const end=source.indexOf('function allMonths()',start);
 const code=source.slice(start,end);
 const sandbox={S:{daily:[
  {date:'2026-10-01',internados:4,altas:1,canguru:2,altaCanguru:0,altaPediatria:1},
  {date:'2026-10-02',internados:5,altas:1,canguru:0,altaCanguru:3,altaPediatria:0},
  {date:'2026-11-01',internados:6,canguru:7,altaCanguru:8}
 ],settings:{beds:10},picc:[],pipa:[]},monthOf:d=>d.slice(0,7),pipaMonthTotal:()=>0,piccInsertDate:()=>'',piccDaysInMonth:()=>0,thermalMonthCount:()=>0};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 const result=vm.runInContext('monthStats("2026-10")',sandbox);
 assert.equal(result.canguru,5);
 assert.equal(result.altaPediatria,1);
 assert.equal(result.altas,2);
 assert.equal(result.pd,9);
 assert.equal(result.ld,20);
 assert.equal(result.outs,2);
 assert.equal(sandbox.S.daily[0].canguru,2);
});
