"use strict";
// Regras puras: nenhuma gravação clínica ou fechamento automático.
const {TZ,dateInBrazil,previousDate}=require("./census-midnight.cjs");
const clockParts=instant=>Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(instant).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
function censusWindow(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new TypeError("Horário do servidor inválido");
 const p=clockParts(now),minute=Number(p.hour)*60+Number(p.minute),today=dateInBrazil(now);
 if(minute>=23*60+55)return {phase:"preparation",referenceDate:today,canPrepare:true,canConfirm:false,expiresAtLocal:"00:10"};
 if(minute<=10){
  const referenceDate=previousDate(today);
  return minute===10?{phase:"expired",referenceDate,canPrepare:false,canConfirm:false,requiresJustification:true}:{phase:"confirmation",referenceDate,canPrepare:false,canConfirm:true};
 }
 return {phase:"expired",referenceDate:previousDate(today),canPrepare:false,canConfirm:false,requiresJustification:true};
}
function censusAttention({now=new Date(),officiallyClosed=false}={}){
 const window=censusWindow(now);
 if(officiallyClosed)return {...window,attention:"closed"};
 if(window.phase==="expired")return {...window,attention:"overdue"};
 if(window.phase==="confirmation"&&Number(clockParts(now).minute)>=5)return {...window,attention:"warning"};
 return {...window,attention:window.phase==="confirmation"?"open":"none"};
}
function effectiveAdmissionDate({effectiveAt,recordedAt}){
 if(typeof effectiveAt!=="string"||!/(Z|[+-]\d{2}:\d{2})$/.test(effectiveAt))throw new TypeError("Data/hora efetiva deve conter fuso horário");
 const effective=new Date(effectiveAt);
 if(!Number.isFinite(effective.getTime()))throw new TypeError("Data/hora efetiva inválida");
 if(recordedAt!==undefined){
  const recorded=new Date(recordedAt);
  if(!Number.isFinite(recorded.getTime()))throw new TypeError("Horário do registro inválido");
  if(effective.getTime()>recorded.getTime())throw new RangeError("Admissão efetiva posterior ao registro");
 }
 return dateInBrazil(effective);
}
function validateConferenceMutation({before,after,referenceDate,now=new Date()}){
 const oldRecord=before?.censusConference,newRecord=after?.censusConference;
 if(JSON.stringify(oldRecord??null)===JSON.stringify(newRecord??null))return {ok:true,changed:false};
 if(oldRecord)return {ok:false,code:"CENSUS_CONFERENCE_IMMUTABLE",reason:"Conferência anterior não pode ser substituída nem removida."};
 if(!newRecord||typeof newRecord!=="object")return {ok:false,code:"CENSUS_CONFERENCE_INVALID"};
 if(typeof referenceDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)||!Number.isFinite(Date.parse(referenceDate+"T00:00:00Z"))||new Date(referenceDate+"T00:00:00Z").toISOString().slice(0,10)!==referenceDate||referenceDate>=dateInBrazil(now))return {ok:false,code:"CENSUS_OUTSIDE_WINDOW",reason:"Confirme somente datas encerradas à meia-noite, inclusive lançamentos atrasados."};
 if(newRecord.referenceDate!==referenceDate||!Number.isSafeInteger(newRecord.count)||newRecord.count<0||newRecord.count>10||!Number.isSafeInteger(after.internados)||newRecord.count!==after.internados||!String(newRecord.responsible||"").trim())return {ok:false,code:"CENSUS_CONFERENCE_INVALID",reason:"Data, contagem ou responsável inválidos."};
 return {ok:true,changed:true};
}
module.exports={censusWindow,censusAttention,effectiveAdmissionDate,validateConferenceMutation};
