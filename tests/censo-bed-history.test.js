const {test}=require("node:test");
const assert=require("node:assert/strict");
const {occupancyIntervals,bedAt}=require("../censo-bed-history.js");
const t=s=>"2026-11-"+s+"-03:00";
const baby=(id,bedHistory,discharge=null)=>({id,admittedAt:t("01T08:00:00"),originMunicipality:"Pirapora",bedHistory,discharge});
test("remanejamento preserva identificação e posição histórica",()=>{
 const rows=[baby("RN1",[
  {bed:1,from:t("01T08:00:00"),to:t("02T10:00:00")},
  {bed:2,from:t("02T10:00:00")}
 ])];
 assert.deepEqual(bedAt(rows,t("02T09:59:59")),[{admissionId:"RN1",bed:1}]);
 assert.deepEqual(bedAt(rows,t("02T10:00:00")),[{admissionId:"RN1",bed:2}]);
});
test("permite passagem imediata de um RN para outro no mesmo leito",()=>{
 const a=baby("RN1",[{bed:1,from:t("01T08:00:00"),to:t("02T10:00:00")}],{id:"e1",type:"Alta",at:t("02T10:00:00")});
 const b={id:"RN2",admittedAt:t("02T10:00:00"),originMunicipality:"Ibiaí",bedHistory:[{bed:1,from:t("02T10:00:00")}]};
 assert.equal(occupancyIntervals([a,b]).length,2);
});
test("rejeita ocupações simultâneas por RNs diferentes",()=>{
 assert.throws(()=>occupancyIntervals([
  baby("RN1",[{bed:1,from:t("01T08:00:00")}]),
  baby("RN2",[{bed:1,from:t("01T08:00:00")}])
 ]),/Sobreposição/);
});
test("rejeita lacuna entre remanejamentos",()=>{
 assert.throws(()=>occupancyIntervals([baby("RN1",[
  {bed:1,from:t("01T08:00:00"),to:t("02T10:00:00")},
  {bed:2,from:t("02T10:00:01")}
 ])]),/Lacuna/);
});
test("rejeita histórico incompleto antes da alta",()=>{
 assert.throws(()=>occupancyIntervals([baby("RN1",[
  {bed:1,from:t("01T08:00:00"),to:t("02T10:00:00")}
 ],{id:"e1",type:"Alta",at:t("03T10:00:00")})]),/não cobre/);
});
test("rejeita leito inexistente",()=>{
 assert.throws(()=>occupancyIntervals([baby("RN1",[{bed:11,from:t("01T08:00:00")}])]),/Leito inválido/);
});
