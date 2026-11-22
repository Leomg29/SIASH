"use strict";
const crypto=require("node:crypto");
const stable=x=>JSON.stringify(x);
const arr=x=>Array.isArray(x)?x:[];
const bad=(code,path)=>({ok:false,code,path});
function validateShiftMutation(previous,next){
 const old=previous?.state||{},cur=next?.state||{};
 for(const key of ["shiftHistory","checklistHistory","careHistory","shiftEvents"]){
  const before=arr(old[key]),after=arr(cur[key]);
  if(after.length<before.length)return bad("SHIFT_HISTORY_REMOVAL_BLOCKED",key);
  for(let i=0;i<before.length;i++)if(stable(before[i])!==stable(after[i]))return bad("SHIFT_HISTORY_IMMUTABLE",key+"."+i);
 }
 const priorEvents=arr(old.events),nextEvents=arr(cur.events);
 if(priorEvents.length&&!priorEvents.every(e=>nextEvents.some(n=>stable(e)===stable(n)))&&!arr(cur.shiftHistory).some(x=>arr(x.events).some(n=>priorEvents.some(e=>stable(e)===stable(n)))))
  return bad("SHIFT_EVENTS_REMOVAL_BLOCKED","events");
 if(old.shiftId&&cur.shiftId!==old.shiftId){
  const closed=arr(cur.shiftHistory).find(x=>x.shiftId===old.shiftId);
  if(!closed||!closed.closedAt||!closed.checklist||!closed.events)return bad("SHIFT_CLOSURE_REQUIRED","shiftId");
 }
 if(old.shiftId&&cur.shiftId===old.shiftId&&arr(old.checklist).some((x,i)=>x?.status!==cur.checklist?.[i]?.status)){
  if(arr(cur.checklistHistory).length<=arr(old.checklistHistory).length)return bad("CHECKLIST_AUDIT_REQUIRED","checklistHistory");
 }
 if(stable(old.care||{})!==stable(cur.care||{})&&arr(cur.careHistory).length<=arr(old.careHistory).length)return bad("CARE_AUDIT_REQUIRED","careHistory");
 return {ok:true};
}
function stampShiftMutation(previous,next,actor,now=new Date()){
 const old=previous?.state||{},cur=next?.state||{};
 const official=now.toISOString(),stamps={};
 for(const key of ["shiftHistory","checklistHistory","careHistory","shiftEvents"]){
  const before=arr(old[key]).length,after=arr(cur[key]);
  stamps[key]=[];
  for(let i=before;i<after.length;i++){
   const event=after[i];if(!event||typeof event!=="object")continue;
   event.id=crypto.randomUUID();event.recordedBy=actor;event.recordedAt=official;event.timeZone="America/Sao_Paulo";
   if(key==="shiftHistory")event.closedAt=official;
   stamps[key].push({index:i,event});
  }
 }
 return stamps;
}
module.exports={validateShiftMutation,stampShiftMutation};
