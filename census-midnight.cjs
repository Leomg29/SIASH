"use strict";
const TZ="America/Sao_Paulo";
const NOTE="Fechamento automático do sistema (00:00 — sem admissões pendentes)";
const parts=(date)=>Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(date).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
function dateInBrazil(now){const p=parts(now);return p.year+"-"+p.month+"-"+p.day}
function previousDate(today){const d=new Date(today+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
function midnightBrazilUtc(today){
 // Find the exact UTC instant for local midnight without assuming a fixed UTC offset.
 const target=today+" 00";
 const rough=Date.parse(today+"T03:00:00Z");
 for(let delta=-12*60;delta<=12*60;delta++){
  const time=rough+delta*60000,p=parts(new Date(time));
  if(p.year+"-"+p.month+"-"+p.day+" "+p.hour===target){
   // The first minute of the local midnight hour.
   return new Date(time);
  }
 }
 throw new Error("Não foi possível resolver meia-noite em America/Sao_Paulo");
}
function decideMidnightClosure({daily,referenceDate,admissionRecord,now=new Date()}){
 const today=dateInBrazil(now);
 if(referenceDate!==previousDate(today))return {status:"skip",reason:"Somente o último dia encerrado é elegível."};
 if(!daily)return {status:"pending",reason:"Lançamento diário ausente: conferência manual necessária."};
 const conference=daily.censusConference;
 if(conference&&conference.referenceDate===referenceDate&&Number(conference.count)===Number(daily.internados)&&
    typeof conference.responsible==="string"&&conference.responsible.trim()&&
    Number.isFinite(new Date(conference.registeredAt).getTime()))
  return {status:"manual",referenceDate,registeredAt:conference.registeredAt,responsible:conference.responsible,reason:"Conferência manual válida registrada para a data de referência."};
 if(conference)return {status:"pending",reason:"Conferência anterior não corresponde à data ou à contagem atual; revisar manualmente."};
 const admissions=Number(daily.admissoes);
 if(!Number.isSafeInteger(admissions)||admissions<0)return {status:"pending",reason:"Admissões sem contagem válida."};
 if(admissions>0)return {status:"pending",reason:"Admissão registrada: conferência manual obrigatória."};
 const count=Number(daily.internados);
 if(!Number.isSafeInteger(count)||count<0||count>10)return {status:"pending",reason:"Censo inválido: conferência manual obrigatória."};
 const cutoff=midnightBrazilUtc(today);
 if(!admissionRecord||!Number.isFinite(new Date(admissionRecord.recordedAt).getTime())||new Date(admissionRecord.recordedAt)>=cutoff)
  return {status:"pending",reason:"Registro de admissões anterior à meia-noite não comprovado; conferência manual necessária."};
 if(admissionRecord.everAdmitted||Number(admissionRecord.count)!==0)
  return {status:"pending",reason:"Admissão identificada no registro próprio: conferência manual obrigatória."};
 return {status:"automatic",referenceDate,registeredAt:cutoff.toISOString(),count,note:NOTE};
}
module.exports={TZ,NOTE,dateInBrazil,previousDate,midnightBrazilUtc,decideMidnightClosure};
