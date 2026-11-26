"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateConferenceMutation,censusWindow}=require("../census-window.cjs");
const date="2026-11-25";
const record=(count=7)=>({date,internados:count,censusConference:{referenceDate:date,count,responsible:"Enfermeiro teste"}});
const validate=(after,now,before)=>validateConferenceMutation({before,after,referenceDate:after.date,now:new Date(now)});
for(const time of ["2026-11-26T03:00:00Z","2026-11-26T03:11:00Z","2026-11-26T10:00:00Z","2026-11-27T10:00:00Z"]){
 test("first confirmation "+time,()=>assert.equal(validate(record(),time).ok,true));
}
test("reject before midnight",()=>assert.equal(validate(record(),"2026-11-26T02:59:59Z").ok,false));
test("explicit zero",()=>assert.equal(validate(record(0),"2026-11-26T10:00:00Z").ok,true));
for(const count of [null,"",undefined,-1,11,1.5,"7"]){
 test("invalid count "+String(count),()=>assert.equal(validate(record(count===undefined?null:count),"2026-11-26T10:00:00Z").ok,false));
}
test("confirmed total immutable",()=>assert.equal(validate({...record(),internados:9},"2026-11-26T10:00:00Z",record()).ok,false));
test("unchanged confirmed record",()=>assert.equal(validate(record(),"2026-11-26T10:00:00Z",record()).ok,true));
test("overdue status permits confirmation",()=>assert.equal(censusWindow(new Date("2026-11-26T10:00:00Z")).canConfirm,true));

test("conference removal rejected",()=>assert.equal(validate({date,internados:7},"2026-11-26T10:00:00Z",record()).ok,false));
test("invalid calendar date rejected",()=>{const d="2026-10-32";assert.equal(validate({date:d,internados:7,censusConference:{referenceDate:d,count:7,responsible:"Teste"}},"2026-11-26T10:00:00Z").ok,false);});

for(const missing of [null,"",undefined,false,"0"]){
 test("confirmed zero cannot become "+String(missing),()=>assert.equal(validate({...record(0),internados:missing},"2026-11-26T10:00:00Z",record(0)).ok,false));
}
test("confirmed explicit zero remains valid on identical replay",()=>assert.equal(validate(record(0),"2026-11-26T10:00:00Z",record(0)).ok,true));

const mergeSource=require("node:fs").readFileSync(require("node:path").join(__dirname,"../app.js"),"utf8");
const mergeVM=require("node:vm").createContext({});
require("node:vm").runInContext(mergeSource.slice(mergeSource.indexOf("function cloudStatesEqual("),mergeSource.indexOf("function cloudDraftIsCurrent("))+mergeSource.slice(mergeSource.indexOf("function cloudThreeWayMerge("),mergeSource.indexOf("const SIASH_PENDING_KEY=")),mergeVM);
const mergeDaily=(b,l,r)=>JSON.parse(JSON.stringify(require("node:vm").runInContext("cloudThreeWayMerge("+JSON.stringify({daily:b})+","+JSON.stringify({daily:l})+","+JSON.stringify({daily:r})+")",mergeVM)));
test("four successive independent census sessions preserve every date",()=>{
 const records=[1,2,3,4].map(n=>({date:"2026-11-2"+n,internados:n}));
 let remote=[];
 for(const row of records){const result=mergeDaily([], [row],remote);assert.equal(result.conflicts.length,0);remote=result.state.daily;}
 assert.deepEqual(remote,records);
});
test("same date divergent count cannot be silently combined",()=>{
 const base=[{date:"2026-11-25",internados:7}];
 const result=mergeDaily(base,[{...base[0],internados:8}],[{...base[0],internados:9}]);
 assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].local.internados,8);assert.equal(result.conflicts[0].server.internados,9);
});
test("object property ordering is not a clinical conflict",()=>{
 const result=mergeDaily([], [{date:"2026-11-25",internados:7}],[{internados:7,date:"2026-11-25"}]);
 assert.equal(result.conflicts.length,0);assert.equal(result.state.daily.length,1);
});
test("duplicate dates block automatic reconciliation",()=>{
 const row={date:"2026-11-25",internados:7};
 const result=mergeDaily([], [row,row],[{...row,internados:8}]);
 assert.equal(result.conflicts.length,1);
});
