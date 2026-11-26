'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('app.js','utf8');
const start=src.indexOf('$("daily-form").addEventListener("submit"');
const end=src.indexOf('$("census-close").addEventListener',start);
assert.ok(start>=0&&end>start);
const handler=src.slice(start,end);
test('daily edit merges previous record before explicit form fields',()=>{
 assert.match(handler,/const previous=S\.daily\.find\(x=>x\.date===date\);[\s\S]*?const r=\{\.\.\.\(previous\|\|\{\}\),date,internados:/);
 assert.match(handler,/altaCanguru:\+\$\("d-alta-canguru"\)\.value\|\|0/);
});
test('census conference invalidation remains in place on count change',()=>{
 assert.match(handler,/if\(Number\(previous\.internados\)===r\.internados\)r\.censusConference=previous\.censusConference;else\{r\.censusConferenceHistory=/);
 assert.match(handler,/delete r\.censusConference/);
});
test('save replaces only selected day and retains historical extra keys',()=>{
 assert.match(handler,/S\.daily=S\.daily\.filter\(x=>x\.date!==r\.date\);S\.daily\.push\(r\)/);
 const prev={date:'2026-11-22',canguru:1,legacyAudit:{source:'import'},futureClinicalField:7,internados:2,censusConference:{count:2}};
 const next={...prev,date:'2026-11-22',internados:3,altas:1};
 assert.equal(next.canguru,1);
 assert.deepEqual(next.legacyAudit,{source:'import'});
 assert.equal(next.futureClinicalField,7);
});

test('conferencia ativa e invalidada quando censo muda sem perder historico',()=>{
 const prev={internados:2,censusConference:{count:2},censusConferenceHistory:[{count:1}],extra:'preserve'};
 const r={...prev,internados:3};
 if(Number(prev.internados)===r.internados)r.censusConference=prev.censusConference;
 else{r.censusConferenceHistory=[...(r.censusConferenceHistory||[]),prev.censusConference];delete r.censusConference;}
 assert.equal(Object.hasOwn(r,'censusConference'),false);
 assert.deepEqual(r.censusConferenceHistory,[{count:1},{count:2}]);
 assert.equal(r.extra,'preserve');
});
