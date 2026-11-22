"use strict";
const crypto=require("node:crypto");
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const dateOK=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
const legacyKey=(x,i)=>x?.id||"legacy:"+i;
function validatePiccMutation(previous,incoming){
 const old=previous?.state?.picc??[],next=incoming?.state?.picc;
 if(!Array.isArray(old)||!Array.isArray(next))return {ok:false,code:"PICC_INVALID_COLLECTION"};
 if(next.length<old.length)return {ok:false,code:"PICC_HISTORY_REMOVAL_BLOCKED"};
 const ids=new Set();
 for(const x of next){if(!x||typeof x!=="object")return {ok:false,code:"PICC_INVALID_RECORD"};if(x.id){if(ids.has(x.id))return {ok:false,code:"PICC_DUPLICATE_ID"};ids.add(x.id)}}
 for(let i=0;i<old.length;i++){
  const a=old[i],b=next[i];
  // The historical array is append-only and positional for legacy entries without UUID.
  if(!b||!a||a.id!==b.id)return {ok:false,code:"PICC_HISTORY_REORDER_BLOCKED",index:i};
  if(!same(a.insertDate,b.insertDate)||!same(a.when,b.when))return {ok:false,code:"PICC_INSERTION_IMMUTABLE",index:i};
  if(a.status==="Retirado"){
   if(!same(a,b))return {ok:false,code:"PICC_REMOVAL_IMMUTABLE",index:i};
   continue;
  }
  if(a.status!=="Ativo"&&a.status!==undefined)return {ok:false,code:"PICC_LEGACY_REVIEW_REQUIRED",index:i};
  if(b.status==="Retirado"){
   if(!dateOK(b.removalDate)||!dateOK(a.insertDate||b.insertDate)||b.removalDate<(a.insertDate||b.insertDate)||!String(b.removalReason||"").trim())return {ok:false,code:"PICC_INVALID_REMOVAL",index:i};
   const allowed=new Set(["status","removalDate","removalReason","removalNote","removedAt","updated"]);
   for(const k of new Set([...Object.keys(a),...Object.keys(b)]))if(!allowed.has(k)&&!same(a[k],b[k]))return {ok:false,code:"PICC_INSERTION_IMMUTABLE",index:i};
  }else if(b.status==="Ativo"||b.status===undefined){
   if(!same(a,b))return {ok:false,code:"PICC_CORRECTION_REQUIRES_EVENT",index:i};
  }else return {ok:false,code:"PICC_INVALID_STATUS",index:i};
 }
 for(let i=old.length;i<next.length;i++){
  const x=next[i];if(x.status!=="Ativo"||!dateOK(x.insertDate)||!x.id||!String(x.vein||"").trim()||!/^([1-9]|10)$/.test(String(Number(x.bed))))return {ok:false,code:"PICC_INVALID_INSERTION",index:i};
 }
 const oldEvents=previous?.state?.piccEvents??[],events=incoming?.state?.piccEvents??[];
 if(!Array.isArray(oldEvents)||!Array.isArray(events)||events.length<oldEvents.length)return {ok:false,code:"PICC_EVENTS_IMMUTABLE"};
 for(let i=0;i<oldEvents.length;i++)if(!same(oldEvents[i],events[i]))return {ok:false,code:"PICC_EVENTS_IMMUTABLE",index:i};
 for(let i=oldEvents.length;i<events.length;i++){
  const e=events[i];if(!e||e.type!=="Retificação"||!String(e.justification||"").trim()||!Number.isSafeInteger(e.recordIndex)||e.recordIndex<0||e.recordIndex>=next.length)return {ok:false,code:"PICC_INVALID_CORRECTION",index:i};
 }
 return {ok:true};
}
function stampPiccEvents(previous,incoming,user){
 const old=previous?.state?.picc??[],next=incoming.state.picc,events=incoming.state.piccEvents??(incoming.state.piccEvents=[]);
 const now=new Date(),at=now.toISOString(),atSaoPaulo=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(now);
 const stamps=[];
 const add=(type,index,details)=>{const e={id:crypto.randomUUID(),type,recordIndex:index,deviceRef:legacyKey(next[index],index),recordedBy:user,recordedAt:at,recordedAtSaoPaulo:atSaoPaulo,...details};events.push(e);stamps.push(e)};
 for(let i=0;i<next.length;i++){
  if(i>=old.length)add("Inserção",i,{insertDate:next[i].insertDate});
  else if(old[i].status!=="Retirado"&&next[i].status==="Retirado")add("Retirada",i,{removalDate:next[i].removalDate,removalReason:next[i].removalReason});
 }
 const previousEvents=previous?.state?.piccEvents??[];
 for(let i=previousEvents.length;i<events.length;i++){
  const e=events[i];if(e.type!=="Retificação"||e.recordedAt)continue;
  e.id=crypto.randomUUID();e.recordedBy=user;e.recordedAt=at;e.recordedAtSaoPaulo=atSaoPaulo;
  e.deviceRef=legacyKey(next[e.recordIndex],e.recordIndex);stamps.push(e);
 }
 return stamps;
}
function piccDaysBetween(a,b){
 if(!dateOK(a)||!dateOK(b)||b<a)return null;
 return Math.floor((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000)+1;
}
function piccDaysInMonth(records,month,today){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return 0;
 const [y,m]=month.split("-").map(Number),start=month+"-01",end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),stopToday=today<end?today:end;
 return records.reduce((sum,x)=>{const insert=x.insertDate||null,stop=x.status==="Retirado"?x.removalDate:stopToday;if(!dateOK(insert)||!dateOK(stop))return sum;return sum+(piccDaysBetween(insert>start?insert:start,stop<end?stop:end)||0)},0);
}
module.exports={validatePiccMutation,stampPiccEvents,piccDaysBetween,piccDaysInMonth,dateOK};
