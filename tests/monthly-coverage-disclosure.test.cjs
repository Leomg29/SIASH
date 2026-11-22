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
test('existing occupancy and length of stay formulas remain unchanged',()=>{
 assert.match(src,/ld=\(S\.settings\.beds\|\|10\)\*days,outs=sum\("altas"\)\+sum\("transferencias"\)\+sum\("obitos"\)/);
 assert.match(src,/occ:ld\?pd\/ld\*100:0,los:outs\?pd\/outs:0/);
});
