"use strict";
const crypto=require("node:crypto");
const arr=x=>Array.isArray(x)?x:[];
const stable=x=>JSON.stringify(x);
const bad=(code,path)=>({ok:false,code,path});
const uuid=x=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const same=(a,b)=>stable(a)===stable(b);
function validateShiftMutation(previous,next){
 const old=previous?.state||{},cur=next?.state||{};
 for(const key of ["shiftHistory","checklistHistory","careHistory","shiftEvents"]){
  if(old[key]!==undefined&&!Array.isArray(cur[key]))return bad("SHIFT_HISTORY_REMOVAL_BLOCKED",key);
  const before=arr(old[key]),after=arr(cur[key]);
  if(after.length<before.length)return bad("SHIFT_HISTORY_REMOVAL_BLOCKED",key);
  for(let i=0;i<before.length;i++)if(!same(before[i],after[i]))return bad("SHIFT_HISTORY_IMMUTABLE",key+"."+i);
  for(let i=before.length;i<after.length;i++){
   const x=after[i];if(!x||typeof x!=="object"||Array.isArray(x))return bad("SHIFT_EVENT_INVALID",key+"."+i);
   if(x.recordedBy||x.recordedAt||x.id||x.closedAt&&key!=="shiftHistory")return bad("SHIFT_PROVENANCE_CLIENT_FORBIDDEN",key+"."+i);
   if(key!=="shiftHistory"&&x.shiftId!==cur.shiftId&&x.shiftId!=="legado")return bad("SHIFT_EVENT_SHIFT_MISMATCH",key+"."+i);
   if(key==="careHistory"&&(!/^(?:[1-9]|10)$/.test(String(x.bed))||!x.episodeRn))return bad("CARE_BED_EPISODE_REQUIRED",key+"."+i);
  }
 }
 const oldEvents=arr(old.events),newEvents=arr(cur.events),closures=arr(cur.shiftHistory).slice(arr(old.shiftHistory).length);
 const closed=closures.find(x=>x.shiftId===old.shiftId)||(old.shiftClosed?arr(old.shiftHistory).find(x=>x.shiftId===old.shiftId):null);
 if(old.shiftId&&cur.shiftId!==old.shiftId){
  if(!closed||!Array.isArray(closed.events)||!Array.isArray(closed.checklist)||!same(closed.events,oldEvents)||!same(closed.checklist,arr(old.checklist)))return bad("SHIFT_CLOSURE_REQUIRED","shiftId");
  if(!uuid(cur.shiftId))return bad("SHIFT_ID_UUID_REQUIRED","shiftId");
 }
 if(old.shiftId&&!old.shiftClosed&&cur.shiftClosed){
  if(!closed||!same(closed.events,oldEvents)||!same(closed.checklist,arr(old.checklist)))return bad("SHIFT_CLOSURE_REQUIRED","shiftHistory");
 }
 if(old.shiftClosed&&cur.shiftId===old.shiftId){
  if(!cur.shiftClosed||!same(oldEvents,newEvents)||!same(old.checklist,cur.checklist)||!same(old.care,cur.care))return bad("SHIFT_CLOSED_IMMUTABLE","shiftId");
 }
 if(!same(oldEvents,newEvents)){
  const removing=oldEvents.some(e=>!newEvents.some(n=>same(n,e)));
  if(removing&&(!closed||!same(closed.events,oldEvents)))return bad("SHIFT_EVENTS_REMOVAL_BLOCKED","events");
  if(!removing&&arr(cur.shiftEvents).length<=arr(old.shiftEvents).length)return bad("SHIFT_EVENTS_AUDIT_REQUIRED","shiftEvents");
 }
 if(!same(old.checklist,cur.checklist)&&!(closed&&same(closed.checklist,arr(old.checklist)))){
  const changes=arr(old.checklist).filter((x,i)=>!same(x,arr(cur.checklist)[i])).length;
  if(changes&&arr(cur.checklistHistory).length-arr(old.checklistHistory||[]).length<changes)return bad("CHECKLIST_AUDIT_REQUIRED","checklistHistory");
 }
 if(!same(old.care||{},cur.care||{})){
  const changed=Object.keys({...old.care,...cur.care}).filter(k=>!same(old.care?.[k],cur.care?.[k]));
  if(changed.some(k=>old.care?.[k]&&!cur.care?.[k]))return bad("CARE_DESTRUCTIVE_REMOVAL_BLOCKED","care");
  if(arr(cur.careHistory).length-arr(old.careHistory||[]).length<changed.length)return bad("CARE_AUDIT_REQUIRED","careHistory");
 }
 return {ok:true};
}
function stampShiftMutation(previous,next,actor,now=new Date()){
 const old=previous?.state||{},cur=next?.state||{},official=now.toISOString(),stamps={};
 for(const key of ["shiftHistory","checklistHistory","careHistory","shiftEvents"]){
  const before=arr(old[key]).length,after=arr(cur[key]);stamps[key]=[];
  for(let i=before;i<after.length;i++){
   const event=after[i];event.id=crypto.randomUUID();event.recordedBy=actor;event.recordedAt=official;event.timeZone="America/Sao_Paulo";
   if(key==="shiftHistory")event.closedAt=official;
   stamps[key].push({index:i,event});
  }
 }
 return stamps;
}
module.exports={validateShiftMutation,stampShiftMutation};
