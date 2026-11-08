const {test}=require("node:test");
const assert=require("node:assert/strict");
const {validateBedIntervals}=require("../censo-bed-rules.js");
const baby=(id,bed,admittedAt,discharge=null)=>({id,bed,admittedAt,originMunicipality:"Pirapora",discharge});
test("permite ocupações consecutivas do mesmo leito",()=>{
 assert.equal(validateBedIntervals([
  baby("a",1,"2026-11-01T08:00:00-03:00",{id:"x",type:"Alta",at:"2026-11-02T09:00:00-03:00"}),
  baby("b",1,"2026-11-02T09:00:00-03:00")
 ]),true);
});
test("impede ocupação simultânea do mesmo leito",()=>{
 assert.throws(()=>validateBedIntervals([
  baby("a",1,"2026-11-01T08:00:00-03:00"),
  baby("b",1,"2026-11-02T09:00:00-03:00")
 ]),/Sobreposição/);
});
test("impede leito fora da capacidade",()=>{
 assert.throws(()=>validateBedIntervals([baby("a",11,"2026-11-01T08:00:00-03:00")]),/Leito inválido/);
});
test("impede internação com duração zero",()=>{
 assert.throws(()=>validateBedIntervals([
  baby("a",1,"2026-11-01T08:00:00-03:00",{id:"x",type:"Alta",at:"2026-11-01T08:00:00-03:00"})
 ]),/Intervalo/);
});
