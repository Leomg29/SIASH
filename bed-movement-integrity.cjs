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
  if (Array.isArray(beforeBeds) && beforeBeds.length === 10 && !same(beforeBeds,afterBeds)) {
    if (!Array.isArray(afterBeds) || afterBeds.length !== 10)
      return {ok:false,code:"BED_STATE_INVALID",path:"beds"};
    const nums = new Set();
    for (const bed of afterBeds) {
      const n = bed?.n;
      if (!validBedNumber(n) || nums.has(n))
        return {ok:false,code:"BED_STATE_INVALID",path:"beds.n"};
      nums.add(n);
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
  }
  return {ok:true};
}
module.exports = {validateBedMovementMutation};
