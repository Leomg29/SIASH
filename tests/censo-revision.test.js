const {test}=require("node:test");
const assert=require("node:assert/strict");
const {applyRevision}=require("../censo-revision.js");
const base={revision:7,events:[]};
const cmd={expectedRevision:7,actorId:"enfermeiro-a",eventId:"evt-1",type:"admission",admissionId:"internacao-1",at:"2026-11-08T07:00:00-03:00"};
test("salva uma revisão sem alterar objeto original",()=>{
 const next=applyRevision(base,cmd);
 assert.equal(next.revision,8);
 assert.equal(next.events.length,1);
 assert.equal(base.revision,7);
 assert.equal(base.events.length,0);
});
test("impede gravação concorrente com revisão obsoleta",()=>{
 const next=applyRevision(base,cmd);
 assert.throws(()=>applyRevision(next,{...cmd,eventId:"evt-2",actorId:"enfermeiro-b"}),/Conflito/);
});
test("impede reaproveitamento de ID de evento",()=>{
 const next=applyRevision(base,cmd);
 assert.throws(()=>applyRevision(next,{...cmd,expectedRevision:8}),/duplicado/);
});
test("rejeita usuário ausente e revisão inválida",()=>{
 assert.throws(()=>applyRevision(base,{...cmd,actorId:" "}),/Usuário/);
 assert.throws(()=>applyRevision(base,{...cmd,expectedRevision:-1}),/Revisão/);
});
test("rejeita evento sem horário explícito",()=>{
 assert.throws(()=>applyRevision(base,{...cmd,at:"2026-11-08T07:00:00"}),/Horário/);
});
