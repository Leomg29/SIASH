const test=require("node:test");
const assert=require("node:assert/strict");
const {decideMidnightClosure,midnightBrazilUtc}=require("../census-midnight.cjs");
const now=new Date("2026-11-22T03:01:00.000Z");
const base={referenceDate:"2026-11-21",admissionRecord:{count:0,everAdmitted:false,recordedAt:"2026-11-22T02:58:00.000Z"},now};
test("00:00 Brasilia sem admissao fecha automaticamente",()=>{
 const result=decideMidnightClosure({...base,daily:{date:base.referenceDate,internados:4,admissoes:0}});
 assert.equal(result.status,"automatic");
 assert.equal(result.registeredAt,"2026-11-22T03:00:00.000Z");
 assert.match(result.note,/Fechamento automático do sistema/);
});
test("00:00 com admissao exige conferencia manual",()=>{
 assert.equal(decideMidnightClosure({...base,daily:{internados:4,admissoes:1}}).status,"pending");
});
test("fechamento manual anterior nao pode ser sobrescrito",()=>{
 assert.equal(decideMidnightClosure({...base,daily:{internados:4,admissoes:0,censusConference:{responsible:"Enfermagem"}}}).status,"manual");
});
test("sem registro diario ou com estado atualizado apos 00:00 nao fecha",()=>{
 assert.equal(decideMidnightClosure({...base,daily:null}).status,"pending");
 assert.equal(decideMidnightClosure({...base,admissionRecord:{count:0,everAdmitted:false,recordedAt:"2026-11-22T03:00:01.000Z"},daily:{internados:4,admissoes:0}}).status,"pending");
});
test("alterações de PICC, SAE e leitos não invalidam carimbo próprio de admissões",()=>{
 const result=decideMidnightClosure({...base,daily:{internados:4,admissoes:0,picc:2,sae:"evoluída",bedsUpdatedAt:"2026-11-22T03:01:00Z"}});
 assert.equal(result.status,"automatic");
});
test("admissão previamente registrada não pode ser ocultada por contador zerado",()=>{
 const result=decideMidnightClosure({...base,daily:{internados:4,admissoes:0},admissionRecord:{count:0,everAdmitted:true,recordedAt:"2026-11-22T02:58:00Z"}});
 assert.equal(result.status,"pending");
});
test("meia-noite America/Sao_Paulo independe do fuso do processo",()=>{
 assert.equal(midnightBrazilUtc("2026-11-22").toISOString(),"2026-11-22T03:00:00.000Z");
});
