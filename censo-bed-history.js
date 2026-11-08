/* SIASH — intervalos temporais de ocupação por leito, incluindo remanejamentos.
 * Puro, sem gravação. bedHistory: [{bed,from,to?}] em ISO 8601 com fuso.
 * A última ocupação pode omitir 'to'; nesse caso termina na saída ou segue ativa.
 */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SIASH_BED_HISTORY=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const core=(typeof module==="object"&&module.exports)?require("./censo-core.js"):globalThis.SIASH_CENSO;
function occupancyIntervals(admissions,capacity=10){
 if(!Array.isArray(admissions))throw Error("Internações inválidas");
 if(!Number.isInteger(capacity)||capacity<1)throw Error("Capacidade inválida");
 const ids=new Set(),intervals=[];
 for(const row of admissions){
  core.assertAdmission(row);
  if(ids.has(row.id))throw Error("ID de internação duplicado");
  ids.add(row.id);
  const start=Date.parse(row.admittedAt),end=row.discharge?Date.parse(row.discharge.at):Infinity;
  if(end<=start)throw Error("Intervalo de internação inválido");
  const history=row.bedHistory;
  if(!Array.isArray(history)||!history.length)throw Error("Histórico de leitos obrigatório");
  let previousEnd=start;
  for(let i=0;i<history.length;i++){
   const move=history[i],bed=Number(move.bed);
   if(!Number.isInteger(bed)||bed<1||bed>capacity)throw Error("Leito inválido");
   const from=parseTime(move.from);
   const to=move.to==null?end:parseTime(move.to);
   if(i===0&&from!==start)throw Error("Histórico não inicia na admissão");
   if(from!==previousEnd)throw Error("Lacuna ou sobreposição no histórico de leitos");
   if(to<=from||to>end)throw Error("Intervalo de leito inválido");
   if(i<history.length-1&&to===Infinity)throw Error("Remanejamento sem horário de saída");
   if(i===history.length-1&&to!==end)throw Error("Histórico não cobre a internação");
   intervals.push({admissionId:row.id,bed,from,to});
   previousEnd=to;
  }
 }
 const grouped=new Map();
 for(const it of intervals){if(!grouped.has(it.bed))grouped.set(it.bed,[]);grouped.get(it.bed).push(it);}
 for(const [bed,items] of grouped){
  items.sort((a,b)=>a.from-b.from);
  let lastEnd=-Infinity;
  for(const it of items){if(it.from<lastEnd)throw Error("Sobreposição de ocupação no leito "+bed);lastEnd=Math.max(lastEnd,it.to);}
 }
 return intervals;
}
function parseTime(value){
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error("Horário inválido ou sem fuso");
 return Date.parse(value);
}
function bedAt(admissions,at,capacity=10){
 const time=parseTime(at);
 return occupancyIntervals(admissions,capacity).filter(i=>i.from<=time&&time<i.to).map(i=>({admissionId:i.admissionId,bed:i.bed}));
}
return {occupancyIntervals,bedAt};
});
