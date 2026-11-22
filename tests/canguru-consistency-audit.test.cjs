'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const js=fs.readFileSync('app.js','utf8');
test('auditoria de consistencia so sinaliza canguru superior a altas',()=>{
 const start=js.indexOf('function canguruConsistencyAudit(m){');
 const end=js.indexOf('function monthStats(m){',start);
 assert.ok(start>=0&&end>start);
 const sandbox={S:{daily:[
  {date:'2026-11-01',altas:1,canguru:1,altaCanguru:1},
  {date:'2026-11-02',altas:2,canguru:1,altaCanguru:1},
  {date:'2026-11-03',altas:3,altaCanguru:1},
  {date:'2026-10-01',altas:0,altaCanguru:2}
 ]},monthOf:d=>d.slice(0,7)};
 vm.createContext(sandbox);vm.runInContext(js.slice(start,end),sandbox);
 const result=vm.runInContext('canguruConsistencyAudit("2026-11")',sandbox);
 assert.equal(result.length,1);
 assert.equal(result[0].date,'2026-11-01');
 assert.equal(result[0].canguru,2);
 assert.equal(sandbox.S.daily.length,4);
});
test('avisos nao alteram totais e escapam datas de registros',()=>{
 assert.match(js,/canguru:sum\("canguru"\)\+sum\("altaCanguru"\)/);
 assert.match(js,/overlaps\.map\(r=>safe\(dateBR\(r\.date\)\)\)/);
 assert.match(js,/inconsistencies\.map\(r=>safe\(dateBR\(r\.date\)\)\)/);
 assert.match(js,/nenhum valor foi alterado/);
});
