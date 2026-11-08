/* Validação preliminar de ocupação de leitos por intervalo de internação.
 * Não cobre remanejamentos: antes da integração, modelar intervalos por leito.
 * Uso isolado em testes Node; sem acesso ao banco de dados.
 */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SIASH_BED_RULES=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const assertAdmission=(typeof module==="object"&&module.exports)?require("./censo-core.js").assertAdmission:globalThis.SIASH_CENSO.assertAdmission;
function validateBedIntervals(admissions,capacity=10){
 if(!Number.isInteger(capacity)||capacity<1)throw Error("Capacidade inválida");
 const seen=new Set(),byBed=new Map();
 for(const row of admissions){
  assertAdmission(row);
  if(seen.has(row.id))throw Error("ID de internação duplicado");
  seen.add(row.id);
  const bed=Number(row.bed);
  if(!Number.isInteger(bed)||bed<1||bed>capacity)throw Error("Leito inválido");
  const start=Date.parse(row.admittedAt),end=row.discharge?Date.parse(row.discharge.at):Infinity;
  if(end<=start)throw Error("Intervalo de internação inválido");
  const events=byBed.get(bed)||[];
  events.push({id:row.id,start,end});
  byBed.set(bed,events);
 }
 for(const [bed,intervals] of byBed){
  intervals.sort((a,b)=>a.start-b.start);
  for(let i=1;i<intervals.length;i++)if(intervals[i].start<intervals[i-1].end)
   throw Error("Sobreposição de ocupação no leito "+bed);
 }
 return true;
}
return {validateBedIntervals};
});
