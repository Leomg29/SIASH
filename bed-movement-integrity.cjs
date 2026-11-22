"use strict";

// PR #96: reject destructive changes without rewriting historical clinical data.
// Legacy events are compared byte-for-byte in their original order.
const HISTORY_KEYS = ["bedMoves", "profileHistory", "movements"];
const validBedNumber = n => Number.isInteger(n) && n >= 1 && n <= 10;
// PostgreSQL JSONB does not preserve object key order; compare values structurally.
function same(a,b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((v,i)=>same(v,b[i]));
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
  return ak.length===bk.length && ak.every((k,i)=>k===bk[i] && same(a[k],b[k]));
}
function stampNewEvents(previousPayload,nextPayload,username,now=new Date()){
 const old=previousPayload?.state||{},next=nextPayload?.state||{};
 for(const key of HISTORY_KEYS){
  if(!Array.isArray(next[key]))continue;
  const start=Array.isArray(old[key])?old[key].length:0;
  for(let i=start;i<next[key].length;i++){
   const event=next[key][i];
   if(!event||typeof event!=="object"||Array.isArray(event))return {ok:false,code:"BED_EVENT_INVALID",path:key};
   event.id=require("node:crypto").randomUUID();
   event.recordedBy=username;
   event.recordedAt=now.toISOString();
   event.recordedAtSaoPaulo=now.toLocaleString("sv-SE",{timeZone:"America/Sao_Paulo"});
   event.timeZone="America/Sao_Paulo";
  }
 }
 return {ok:true};
}
function validateBedMovementMutation(previousPayload, nextPayload) {
  const oldState = previousPayload?.state || {};
  const nextState = nextPayload?.state || {};
  for (const key of HISTORY_KEYS) {
    const before = oldState[key];
    if (before === undefined) continue;
    const after = nextState[key];
    if (!Array.isArray(before) || !Array.isArray(after))
      return {ok:false, code:"BED_HISTORY_IMMUTABLE", path:key};
    if (after.length < before.length || before.some((event,i) => !same(event,after[i])))
      return {ok:false, code:"BED_HISTORY_IMMUTABLE", path:key};
  }
  const beforeBeds = oldState.beds;
  const afterBeds = nextState.beds;
  if (Array.isArray(beforeBeds) && beforeBeds.length === 10 && beforeBeds.every(b => ["Livre","Ocupado","Bloqueado"].includes(b?.status) && ["Intensivo","Intermediário"].includes(b?.profile)) && !same(beforeBeds,afterBeds)) {
    if (!Array.isArray(afterBeds) || afterBeds.length !== 10)
      return {ok:false,code:"BED_STATE_INVALID",path:"beds"};
    const nums = new Set();
    for (const bed of afterBeds) {
      const n = bed?.n;
      if (!validBedNumber(n) || nums.has(n))
        return {ok:false,code:"BED_STATE_INVALID",path:"beds.n"};
      nums.add(n);
      if(bed.isolation!==undefined && bed.isolation!==(n===9||n===10))return {ok:false,code:"BED_ISOLATION_INVALID",path:"beds.isolation"};
      if (!["Livre","Ocupado","Bloqueado"].includes(bed.status) ||
          !["Intensivo","Intermediário"].includes(bed.profile))
        return {ok:false,code:"BED_STATE_INVALID",path:"beds.status/profile"};
      if (bed.status === "Ocupado" && !String(bed.rn||"").trim())
        return {ok:false,code:"BED_STATE_INVALID",path:"beds.rn"};
      if (bed.status !== "Ocupado" && String(bed.rn||"").trim())
        return {ok:false,code:"BED_STATE_INVALID",path:"beds.rn"};
    }
    for (let n=1;n<=10;n++) if (!nums.has(n))
      return {ok:false,code:"BED_STATE_INVALID",path:"beds.n"};
    const oldMap=new Map(beforeBeds.map(b=>[b.n,b])),newMap=new Map(afterBeds.map(b=>[b.n,b]));
    const newMoves=(nextState.bedMoves||[]).slice((oldState.bedMoves||[]).length);
    const newProfiles=(nextState.profileHistory||[]).slice((oldState.profileHistory||[]).length);
    for(const e of newMoves){
      const origin=oldMap.get(Number(e?.origin)),dest=oldMap.get(Number(e?.target));
      const nextOrigin=newMap.get(Number(e?.origin)),nextDest=newMap.get(Number(e?.target));
      if(!origin||!dest||!nextOrigin||!nextDest||origin.n===dest.n||
         origin.status!=="Ocupado"||!String(origin.rn||"").trim()||dest.status!=="Livre"||
         nextOrigin.status!=="Livre"||String(nextOrigin.rn||"").trim()||
         nextDest.status!=="Ocupado"||nextDest.rn!==origin.rn||
         nextDest.profile!==origin.profile||e.rn!==origin.rn||e.profile!==origin.profile)
        return {ok:false,code:"BED_MOVE_INVALID",path:"bedMoves"};
    }
    for(const e of newProfiles){
      const old=oldMap.get(Number(e?.bed)),next=newMap.get(Number(e?.bed));
      if(!old||!next||old.status!=="Ocupado"||next.status!=="Ocupado"||
         old.rn!==next.rn||e.rn!==old.rn||old.profile!==e.from||
         next.profile!==e.to||old.profile===next.profile)
        return {ok:false,code:"BED_PROFILE_TRANSITION_INVALID",path:"profileHistory"};
    }
    for(const old of beforeBeds){
      const next=newMap.get(old.n);
      if(old.status==="Ocupado"&&next.status==="Ocupado"&&old.rn!==next.rn)
        return {ok:false,code:"BED_OCCUPANT_REPLACEMENT_BLOCKED",path:"beds"};
      if(old.status==="Ocupado"&&next.status==="Ocupado"&&old.rn===next.rn&&old.profile!==next.profile&&
         !newProfiles.some(e=>Number(e.bed)===old.n&&e.rn===old.rn&&e.from===old.profile&&e.to===next.profile))
        return {ok:false,code:"BED_PROFILE_AUDIT_REQUIRED",path:"profileHistory"};
    }

  }
  return {ok:true};
}
module.exports = {validateBedMovementMutation,stampNewEvents};
