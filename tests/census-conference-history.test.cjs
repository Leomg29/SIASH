const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("app.js","utf8");
const start=source.indexOf("function registerCensusConference(");
const end=source.indexOf("async function refreshMidnightCensusStatus(",start);
assert.ok(start>=0&&end>start,"census conference function not found");
const fn=source.slice(start,end);
function run(history){
 const daily={date:"2026-11-18",internados:3,censusConference:{count:3,responsible:"Anterior"},censusConferenceHistory:history};
 const ctx={S:{daily:[daily],settings:{beds:10},beds:[{status:"Ocupado"}]},SESSION:{user:"teste"},todayISO:()=>"2026-11-19",$:()=>({value:"3"}),Date};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 return {daily,result:vm.runInContext('registerCensusConference("2026-11-18","Noturno")',ctx)};
}
test("historico malformado nao impede nova conferencia",()=>{
 const {daily,result}=run({invalid:true});
 assert.equal(result.ok,true);
 assert.equal(daily.censusConferenceHistory.length,1);
 assert.equal(daily.censusConferenceHistory[0].responsible,"Anterior");
 assert.equal(daily.censusConference.responsible,"Noturno");
});
test("historico valido preserva conferencias anteriores",()=>{
 const {daily,result}=run([{count:2,responsible:"Mais antigo"}]);
 assert.equal(result.ok,true);
 assert.equal(daily.censusConferenceHistory.length,2);
 assert.equal(daily.censusConferenceHistory[0].responsible,"Mais antigo");
 assert.equal(daily.censusConferenceHistory[1].responsible,"Anterior");
});
