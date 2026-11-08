const assert = require("node:assert/strict");
const { test } = require("node:test");
const { censusAtMidnight, pipaReferrals, pipaByMunicipality } = require("../censo-core.js");
const baby = (id, admittedAt, discharge = null, originMunicipality = "Buritizeiro") =>
  ({ id, admittedAt, discharge, originMunicipality });
test("censo às 00h inclui admissão exatamente no corte e exclui alta exatamente no corte", () => {
  const rows = [
    baby("a", "2026-11-07T23:59:59-03:00"),
    baby("b", "2026-11-08T00:00:00-03:00"),
    baby("c", "2026-11-07T12:00:00-03:00", {id:"x",at:"2026-11-08T00:00:00-03:00",type:"Alta",pipaReferred:false}),
    baby("d", "2026-11-08T00:00:01-03:00")
  ];
  assert.deepEqual(censusAtMidnight(rows, "2026-11-08").map(x => x.id), ["a","b"]);
});
test("PIPA conta apenas encaminhamentos confirmados após alta, por município de origem", () => {
  const rows = [
    baby("a","2026-10-01T08:00:00-03:00",{id:"x",at:"2026-11-01T00:00:00-03:00",type:"Alta",pipaReferred:true}),
    baby("b","2026-10-01T08:00:00-03:00",{id:"y",at:"2026-11-02T12:00:00-03:00",type:"Alta",pipaReferred:true}),
    baby("c","2026-10-01T08:00:00-03:00",{id:"z",at:"2026-11-02T12:00:00-03:00",type:"Alta",pipaReferred:false}),
    baby("d","2026-10-01T08:00:00-03:00",{id:"w",at:"2026-11-02T12:00:00-03:00",type:"Transferência",pipaReferred:false}),
    baby("e","2026-10-01T08:00:00-03:00",{id:"q",at:"2026-11-02T12:00:00-03:00",type:"Alta",pipaReferred:true},"Ibiaí")
  ];
  assert.equal(pipaReferrals(rows,"2026-10").length,0);
  assert.deepEqual(pipaByMunicipality(rows,"2026-11"),[
    {municipality:"Buritizeiro",count:2},{municipality:"Ibiaí",count:1}
  ]);
});
test("bloqueia IDs duplicados e PIPA vinculado a óbito", () => {
  const a=baby("a","2026-11-01T12:00:00-03:00");
  assert.throws(()=>censusAtMidnight([a,a],"2026-11-02"),/duplicado/);
  assert.throws(()=>pipaReferrals([baby("b","2026-11-01T12:00:00-03:00",{id:"q",at:"2026-11-02T12:00:00-03:00",type:"Óbito",pipaReferred:true})],"2026-11"),/somente após alta/);
});
test("exige fuso explícito e não aceita data inválida", () => {
  assert.throws(()=>censusAtMidnight([baby("a","2026-11-01T12:00:00")],"2026-11-02"),/fuso/);
  assert.throws(()=>censusAtMidnight([],"2026-02-30"),/inexistente/);
});

test("alta às 00h e 02h59 locais permanece na competência correta", () => {
  const rows=[
    baby("m1","2026-10-01T08:00:00-03:00",{id:"e1",at:"2026-11-01T00:00:00-03:00",type:"Alta",pipaReferred:true}),
    baby("m2","2026-10-01T08:00:00-03:00",{id:"e2",at:"2026-11-01T02:59:59-03:00",type:"Alta",pipaReferred:true}),
    baby("m3","2026-10-01T08:00:00-03:00",{id:"e3",at:"2026-10-31T23:59:59-03:00",type:"Alta",pipaReferred:true})
  ];
  assert.equal(pipaReferrals(rows,"2026-11").length,2);
  assert.equal(pipaReferrals(rows,"2026-10").length,1);
});

test("rejeita competência inexistente, município vazio e internação sem duração",()=>{
 assert.throws(()=>pipaReferrals([],"2026-13"),/Competência inválida/);
 assert.throws(()=>pipaReferrals([],"2026-00"),/Competência inválida/);
 assert.throws(()=>censusAtMidnight([baby("a","2026-11-01T08:00:00-03:00",null,"  ")],"2026-11-02"),/município inválido/);
 assert.throws(()=>censusAtMidnight([baby("a","2026-11-01T08:00:00-03:00",{id:"x",at:"2026-11-01T08:00:00-03:00",type:"Alta",pipaReferred:false})],"2026-11-02"),/anterior à admissão/);
});
