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

for(const scenario of [{name:"clean handoff",pending:false,syncing:false,conflict:false,exit:true,retry:false},{name:"inflight save",pending:true,syncing:true,conflict:false,exit:false,retry:false},{name:"offline pending",pending:true,syncing:false,conflict:false,exit:false,retry:true},{name:"protected conflict",pending:true,syncing:false,conflict:true,exit:false,retry:false}]){
 test("shift logout: "+scenario.name,()=>{
  const vm=require("node:vm");let handler,retries=0,removed=0,timers=0;
  const element={addEventListener:(event,fn)=>{handler=fn},classList:{add(){},remove(){}},reset(){}};
  const ctx={$:()=>element,SIASH_CLOUD:{token:"test",syncing:scenario.syncing,conflict:scenario.conflict},SESSION:{user:"night",authenticated:true},cloudPending:()=>scenario.pending,confirm:()=>false,parkCloudDraft:()=>false,scheduleCloudSave:()=>{retries++},alert:()=>{},clearTimeout:()=>{timers++},cloudSaveTimer:1,cloudRetryTimer:2,sessionStorage:{removeItem(){removed++}},initSecurityUI(){}};
  const line=mergeSource.split("\n").find(x=>x.startsWith('$("logout-btn").addEventListener'));
  assert.ok(line);vm.runInNewContext(line,ctx);handler();
  assert.equal(ctx.SIASH_CLOUD.token==="",scenario.exit);assert.equal(retries,Number(scenario.retry));assert.equal(removed,Number(scenario.exit));assert.equal(timers,scenario.exit?2:0);
 });
}

test("official census receipt preserves later unrelated edits and permits next save",()=>{
 const vm=require("node:vm");
 const original={referenceDate:date,count:7,responsible:"Teste",registeredAt:"2026-11-26T10:00:00.000Z"};
 const official={...original,registeredAt:"2026-11-26T10:00:02.000Z",registeredBy:"night"};
 const sentState={daily:[{date,internados:7,censusConference:{...original}}]};
 const S={daily:[{date,internados:7,admissoes:2,censusConference:{...original}}]};
 const start=mergeSource.indexOf("     if(Array.isArray(r.census_conference_stamps))");
 const end=mergeSource.indexOf("     cloudSetBase(sentState);",start);
 assert.ok(start>=0&&end>start);
 const ctx={sentState,S,r:{census_conference_stamps:[{date,conference:official}]},localStorage:{setItem(){}},STORE:"test"};
 vm.runInNewContext(mergeSource.slice(mergeSource.indexOf("function cloudStatesEqual("),mergeSource.indexOf("function cloudDraftIsCurrent("))+mergeSource.slice(start,end),ctx);
 assert.deepEqual(S.daily[0].censusConference,official);
 assert.deepEqual(sentState.daily[0].censusConference,official);
 assert.equal(S.daily[0].admissoes,2);
 assert.equal(validate(S.daily[0],"2026-11-26T10:01:00Z",sentState.daily[0]).ok,true);
});

test("closure status rejects false zero and absent audit timestamp",()=>{
 const {decideMidnightClosure}=require("../census-midnight.cjs");
 const now=new Date("2026-11-26T10:00:00Z");
 const check=(count,registeredAt)=>decideMidnightClosure({daily:{internados:count,censusConference:{referenceDate:date,count,responsible:"Teste",registeredAt}},referenceDate:date,now}).status;
 for(const invalid of [false,true,[],[0]," ","00",null,undefined])assert.equal(check(invalid,now.toISOString()),"pending");
 for(const invalid of [null,undefined,0,false,""])assert.equal(check(0,invalid),"pending");
 assert.equal(check(0,now.toISOString()),"manual");
 assert.equal(check("7",now.toISOString()),"manual");
});

test("parked draft survives sequential users and restores only original owner",()=>{
 const vm=require("node:vm"),data=new Map();
 const localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const ctx={localStorage,SESSION:{user:"night"},S:{daily:[{date,internados:7}]},SIASH_PENDING_KEY:"pending",console};
 ctx.cloudPending=()=>JSON.parse(localStorage.getItem("pending")||"null");
 ctx.clearCloudDraft=()=>localStorage.removeItem("pending");
 localStorage.setItem("pending",JSON.stringify({user:"night",state:ctx.S,revision:4}));
 vm.createContext(ctx);
 vm.runInContext(mergeSource.slice(mergeSource.indexOf("function cloudStatesEqual("),mergeSource.indexOf("function cloudDraftIsCurrent("))+mergeSource.slice(mergeSource.indexOf("function parkCloudDraft("),mergeSource.indexOf("async function cloudLoadAfterLogin(")),ctx);
 assert.equal(vm.runInContext("parkCloudDraft()",ctx),true);
 assert.equal(ctx.cloudPending(),null);
 ctx.SESSION.user="day";vm.runInContext("restoreParkedCloudDraft()",ctx);assert.equal(ctx.cloudPending(),null);
 ctx.SESSION.user="night";vm.runInContext("restoreParkedCloudDraft()",ctx);assert.equal(ctx.cloudPending().state.daily[0].internados,7);
 assert.equal(localStorage.getItem("pending:parked:night"),null);
});

test("interrupted parking and restoration are retryable without data loss",()=>{
 const vm=require("node:vm"),data=new Map();let failRemove=null;
 const localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>{if(k===failRemove)throw Error("simulated interruption");data.delete(k)}};
 const ctx={localStorage,SESSION:{user:"night"},S:{daily:[{date,internados:7}]},SIASH_PENDING_KEY:"pending",console};
 ctx.cloudPending=()=>JSON.parse(localStorage.getItem("pending")||"null");
 const raw=JSON.stringify({user:"night",state:ctx.S,revision:4});
 data.set("pending",raw);
 vm.createContext(ctx);
 vm.runInContext(mergeSource.slice(mergeSource.indexOf("function cloudStatesEqual("),mergeSource.indexOf("function cloudDraftIsCurrent("))+mergeSource.slice(mergeSource.indexOf("function parkCloudDraft("),mergeSource.indexOf("async function cloudLoadAfterLogin(")),ctx);
 failRemove="pending";assert.equal(vm.runInContext("parkCloudDraft()",ctx),false);
 assert.equal(data.get("pending"),raw);assert.equal(data.get("pending:parked:night"),raw);
 failRemove=null;assert.equal(vm.runInContext("parkCloudDraft()",ctx),true);
 failRemove="pending:parked:night";assert.throws(()=>vm.runInContext("restoreParkedCloudDraft()",ctx));
 assert.equal(data.get("pending"),raw);assert.equal(data.get("pending:parked:night"),raw);
 failRemove=null;vm.runInContext("restoreParkedCloudDraft()",ctx);
 assert.equal(data.get("pending"),raw);assert.equal(data.has("pending:parked:night"),false);
 data.set("pending:parked:night",JSON.stringify({user:"night",state:{daily:[]}}));
 const divergent=data.get("pending:parked:night");
 assert.equal(vm.runInContext("parkCloudDraft()",ctx),false);
 vm.runInContext("restoreParkedCloudDraft()",ctx);
 assert.equal(data.get("pending"),raw);assert.equal(data.get("pending:parked:night"),divergent);
});
