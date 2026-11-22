"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {validatePiccMutation,stampPiccEvents,piccDaysInMonth,legacyDate}=require("../picc-lifecycle-integrity.cjs");
const payload=(picc=[],piccEvents=[])=>({state:{picc,piccEvents}});
const active=(extra={})=>({id:"a",status:"Ativo",insertDate:"2026-02-28",bed:"1",vein:"Basílica",...extra});
test("insert, withdrawal and append-only official stamps",()=>{
 const before=payload([]),after=payload([active()]);
 assert.equal(validatePiccMutation(before,after).ok,true);
 const e=stampPiccEvents(before,after,"nurse");assert.equal(e.length,1);assert.equal(e[0].type,"Inserção");assert.equal(e[0].recordedBy,"nurse");
 const prior=structuredClone(after),withdrawn=payload([{...active(),status:"Retirado",removalDate:"2026-03-02",removalReason:"Fim da terapia"}],structuredClone(prior.state.piccEvents));
 assert.equal(validatePiccMutation(prior,withdrawn).ok,true);
 assert.equal(stampPiccEvents(prior,withdrawn,"nurse2")[0].type,"Retirada");
 assert.equal(validatePiccMutation(withdrawn,payload([])).code,"PICC_HISTORY_REMOVAL_BLOCKED");
 assert.equal(validatePiccMutation(withdrawn,payload([{...withdrawn.state.picc[0],removalReason:"Outro"}],withdrawn.state.piccEvents)).code,"PICC_REMOVAL_IMMUTABLE");
});
test("duplicate and invalid withdrawals rejected",()=>{
 const before=payload([active()]);const bad=payload([{...active(),status:"Retirado",removalDate:"2026-02-27",removalReason:"Fim"}]);
 assert.equal(validatePiccMutation(before,bad).code,"PICC_INVALID_REMOVAL");
 bad.state.picc[0].removalDate="2026-03-01";bad.state.picc[0].removalReason="";
 assert.equal(validatePiccMutation(before,bad).code,"PICC_INVALID_REMOVAL");
});
test("legacy without UUID stays untouched and can be withdrawn",()=>{
 const old={status:"Ativo",when:"28/02/2024 10:00",bed:"2",vein:"Cefálica"};
 const before=payload([old]),after=payload([{...old,status:"Retirado",removalDate:"2024-03-01",removalReason:"Fim",removedAt:"local"}]);
 assert.equal(validatePiccMutation(before,after).ok,true);
 assert.equal(after.state.picc[0].id,undefined);
 assert.equal(legacyDate(old),"2024-02-28");
 assert.equal(legacyDate({when:"inválida"}),null);
});
test("month boundary, leap year, historical month, multiple devices",()=>{
 const rows=[{...active({insertDate:"2024-02-28"}),status:"Retirado",removalDate:"2024-03-02"},{...active({id:"b",insertDate:"2024-02-29"}),status:"Retirado",removalDate:"2024-03-01"}];
 assert.equal(piccDaysInMonth(rows,"2024-02","2026-11-22"),3);
 assert.equal(piccDaysInMonth(rows,"2024-03","2026-11-22"),3);
 assert.equal(piccDaysInMonth([{...active({insertDate:"2024-01-10"})}],"2024-01","2026-11-22"),22);
 assert.equal(piccDaysInMonth([{...active({insertDate:"2024-01-10"})}],"2024-01","2024-01-12"),3);
});
test("retification event requires justification, existing event immutable",()=>{
 const before=payload([active()],[{id:"event1",type:"Inserção",recordIndex:0}]);
 const after=payload([active()],[...structuredClone(before.state.piccEvents),{type:"Retificação",recordIndex:0,justification:"Revisão",correctionText:"Sítio correto"}]);
 assert.equal(validatePiccMutation(before,after).ok,true);
 const stamp=stampPiccEvents(before,after,"supervisor");
 assert.equal(stamp.length,1);assert.equal(stamp[0].recordedBy,"supervisor");
 after.state.piccEvents[0].type="Alterado";
 assert.equal(validatePiccMutation(before,after).code,"PICC_EVENTS_IMMUTABLE");
});
