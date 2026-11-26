'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('app.js','utf8');
const start=src.indexOf('function monthCoverage('),end=src.indexOf('function allMonths()',start);
assert.ok(start>=0&&end>start);
const monthCoverage=vm.runInNewContext(src.slice(start,end)+';monthCoverage');
test('calendar coverage counts actual month length including leap years',()=>{
 assert.equal(monthCoverage('2026-06',30).incomplete,false);
 assert.equal(monthCoverage('2026-07',30).incomplete,true);
 assert.equal(monthCoverage('2026-02',28).incomplete,false);
 assert.equal(monthCoverage('2028-02',28).incomplete,true);
 assert.equal(monthCoverage('2028-02',28).calendarDays,29);
});
test('incomplete months are disclosed in indicators and comparison',()=>{
 assert.match(src,/Cobertura parcial:/);
 assert.match(src,/const coverage=monthCoverage\(m,c\.days\)/);
 assert.match(src,/const coverageNote=data\.some\(x=>monthCoverage\(x\.m,x\.days\)\?\.incomplete\)/);
});
const stats=rows=>vm.runInNewContext(src.slice(src.indexOf('function monthStats('),src.indexOf('function monthCoverage('))+';monthStats("2026-06")',{S:{daily:rows,settings:{beds:10},picc:[]},monthOf:d=>d.slice(0,7),pipaMonthTotal:()=>0,piccDaysInMonth:()=>0,thermalMonthCount:()=>0});
const row=(day,internados,altas=0)=>({date:"2026-06-"+String(day).padStart(2,"0"),internados,altas,transferencias:0,obitos:0});
test('occupancy and stay use matching valid census dates',()=>{
 const c=stats([row(1,7,2),row(2,9,2),row(3,null,8),row(4,5,3),row(4,6,4)]);
 assert.equal(c.pd,16);assert.equal(c.ld,20);assert.equal(c.occ,80);assert.equal(c.losOuts,4);assert.equal(c.los,4);
});
test('missing or invalid exits and zero exits do not fabricate stay',()=>{
 for(const v of [null,"",false,-1,1.5])assert.equal(stats([row(1,7,v)]).los,null);
 assert.equal(stats([row(1,7)]).los,null);
 assert.equal(stats([row(1,0,1)]).los,0);
});
test('June historical occupancy reference',()=>{
 const c=stats(Array.from({length:30},(_,i)=>row(i+1,i<18?7:6,1)));
 assert.equal(c.pd,198);assert.equal(c.ld,300);assert.equal(c.occ,66);assert.equal(c.los,6.6);
});
