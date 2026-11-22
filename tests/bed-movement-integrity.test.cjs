"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateBedMovementMutation:check}=require("../bed-movement-integrity.cjs");
const beds=()=>Array.from({length:10},(_,i)=>({n:i+1,status:"Livre",profile:"Intensivo",rn:"",isolation:i>=8}));
const wrap=state=>({state});
test("preserves all three historical event streams, including legacy records",()=>{
 const before=wrap({beds:beds(),bedMoves:[{when:"legacy",origin:1,target:2}],profileHistory:[{when:"old",bed:2}],movements:[{type:"Alta"}]});
 assert.equal(check(before,before).ok,true);
 for(const key of ["bedMoves","profileHistory","movements"]){
   const after=structuredClone(before);after.state[key]=[];
   assert.equal(check(before,after).code,"BED_HISTORY_IMMUTABLE",key);
   const edit=structuredClone(before);edit.state[key][0].when="rewritten";
   assert.equal(check(before,edit).code,"BED_HISTORY_IMMUTABLE",key);
 }
 const append=structuredClone(before);append.state.bedMoves.push({origin:2,target:3});
 assert.equal(check(before,append).ok,true);
});
test("rejects duplicate, missing and invalid beds on changes",()=>{
 const before=wrap({beds:beds()});
 for(const mutated of [
   beds().slice(0,9),
   beds().map((x,i)=>({...x,n:i===9?9:x.n})),
   beds().map((x,i)=>({...x,status:i===0?"Invalid":x.status})),
   beds().map((x,i)=>({...x,status:i===0?"Ocupado":x.status})),
   beds().map((x,i)=>({...x,rn:i===0?"RN1":x.rn})),
   beds().map((x,i)=>({...x,profile:i===0?"Unknown":x.profile}))
 ]){
  assert.equal(check(before,wrap({beds:mutated})).code,"BED_STATE_INVALID");
 }
});
test("permits a valid occupied bed and separate intermediate profile",()=>{
 const before=wrap({beds:beds()});
 const after=structuredClone(before);after.state.beds[0].status="Ocupado";after.state.beds[0].rn="RN-001";after.state.beds[0].profile="Intermediário";
 assert.equal(check(before,after).ok,true);
 assert.equal(after.state.beds[8].isolation,true);
});
test("does not rewrite unchanged legacy bed data",()=>{
 const legacy=wrap({beds:[{n:1,status:"Legacy"}],bedMoves:[]});
 const next=structuredClone(legacy);next.state.movements=[{when:"new"}];
 assert.equal(check(legacy,next).ok,true);
});

test("JSONB reordered object keys do not falsely trigger historical mutation",()=>{
 const before=wrap({bedMoves:[{when:"old",origin:1,target:2,note:"ok"}]});
 const after=wrap({bedMoves:[{note:"ok",target:2,origin:1,when:"old"}]});
 assert.equal(check(before,after).ok,true);
});

test("legacy 10-bed records without canonical status are not rewritten or rejected",()=>{
 const before=wrap({beds:Array.from({length:10},(_,i)=>({n:i+1,patient:"LEGACY"}))});
 const after=structuredClone(before);after.state.beds[0].patient="LEGACY-UPDATED";
 assert.equal(check(before,after).ok,true);
});

test("occupied destination, profile without audit and wrong isolation rejected",()=>{
 const before=wrap({beds:beds(),bedMoves:[],profileHistory:[]});
 before.state.beds[0]={...before.state.beds[0],status:"Ocupado",rn:"RN-A"};
 before.state.beds[1]={...before.state.beds[1],status:"Ocupado",rn:"RN-B"};
 const wrong=structuredClone(before);wrong.state.beds[0].rn="RN-B";
 assert.equal(check(before,wrong).code,"BED_OCCUPANT_REPLACEMENT_BLOCKED");
 const profile=structuredClone(before);profile.state.beds[0].profile="Intermediário";
 assert.equal(check(before,profile).code,"BED_PROFILE_AUDIT_REQUIRED");
 profile.state.profileHistory.push({bed:1,rn:"RN-A",from:"Intensivo",to:"Intermediário"});
 assert.equal(check(before,profile).ok,true);
 const isolation=structuredClone(before);isolation.state.beds[8].isolation=false;
 assert.equal(check(before,isolation).code,"BED_ISOLATION_INVALID");
 const occupied=structuredClone(before);
 occupied.state.beds[0].status="Livre";occupied.state.beds[0].rn="";
 occupied.state.beds[1].rn="RN-A";
 occupied.state.bedMoves.push({origin:1,target:2,rn:"RN-A",profile:"Intensivo"});
 assert.equal(check(before,occupied).code,"BED_MOVE_INVALID");
});
test("physical move into free bed retains RN profile and preserves historical event",()=>{
 const before=wrap({beds:beds(),bedMoves:[]});
 before.state.beds[0]={...before.state.beds[0],status:"Ocupado",rn:"RN-A",profile:"Intermediário"};
 const after=structuredClone(before);
 after.state.beds[0]={...after.state.beds[0],status:"Livre",rn:"",profile:"Intensivo"};
 after.state.beds[8]={...after.state.beds[8],status:"Ocupado",rn:"RN-A",profile:"Intermediário"};
 after.state.bedMoves.push({origin:1,target:9,rn:"RN-A",profile:"Intermediário"});
 assert.equal(check(before,after).ok,true);
});
test("server stamps are authoritative and do not alter legacy events",()=>{
 const {stampNewEvents}=require("../bed-movement-integrity.cjs");
 const before=wrap({movements:[{when:"old"}]});
 const after=wrap({movements:[{when:"old"},{when:"new",recordedBy:"forged",id:"forged"}]});
 const result=stampNewEvents(before,after,"nurse-ci",new Date("2026-11-22T12:00:00Z"));
 assert.equal(result.ok,true);
 assert.deepEqual(after.state.movements[0],{when:"old"});
 assert.equal(after.state.movements[1].recordedBy,"nurse-ci");
 assert.notEqual(after.state.movements[1].id,"forged");
 assert.equal(after.state.movements[1].timeZone,"America/Sao_Paulo");
});
