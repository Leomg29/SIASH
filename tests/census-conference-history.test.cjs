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
test("historico malformado preservado e reconferencia bloqueada",()=>{
 const {daily,result}=run({invalid:true});
 assert.equal(result.ok,false);
 assert.deepEqual(daily.censusConferenceHistory,{invalid:true});
 assert.equal(daily.censusConference.responsible,"Anterior");
});
test("historico valido preservado sem sobrescrever conferencia",()=>{
 const history=[{count:2,responsible:"Mais antigo"}];
 const {daily,result}=run(history);
 assert.equal(result.ok,false);
 assert.deepEqual(daily.censusConferenceHistory,history);
 assert.equal(daily.censusConference.responsible,"Anterior");
});

test("late manual census preserves seven historical patients despite nine current occupied beds",()=>{
 const daily={date:"2026-11-25",internados:7};
 const fixedDate=class extends Date {constructor(...args){super(...(args.length?args:["2026-11-26T10:00:00Z"]))}};
 const ctx={S:{daily:[daily],settings:{beds:10},beds:Array.from({length:10},(_,i)=>({status:i<9?"Ocupado":"Livre"}))},SESSION:{user:"teste"},$:()=>({value:"7"}),Date:fixedDate};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 const result=vm.runInContext('registerCensusConference("2026-11-25","Noturno")',ctx);
 assert.equal(result.ok,true);
 assert.equal(daily.internados,7);
 assert.equal(daily.censusConference.count,7);
 assert.equal(daily.censusConference.bedOccupancyAtRegistration,9);
 assert.equal(daily.censusConference.countSource,"manual_reference_date");
 assert.equal(daily.censusConference.referenceDate,"2026-11-25");
 assert.equal(daily.censusConference.registeredAt,"2026-11-26T10:00:00.000Z");
});
