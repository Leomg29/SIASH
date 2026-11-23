"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {validateShiftMutation:v,stampShiftMutation:stamp}=require("../shift-care-integrity.cjs");
const w=state=>({state});const copy=x=>structuredClone(x);
const shift="5e541b87-07cb-4d32-992a-130bdc37d14e";
const base=()=>w({shiftId:shift,shiftClosed:false,events:[{text:"Registro de intercorrência"}],checklist:[{text:"SAE",status:"Pendente"}],care:{"1":{sae:"Pendente",episodeRn:"RN-A"}},shiftHistory:[],checklistHistory:[],careHistory:[],shiftEvents:[]});
test("bloqueia exclusão e adulteração de históricos consolidados",()=>{for(const key of ["shiftHistory","checklistHistory","careHistory","shiftEvents"]){const a=base();a.state[key]=[{id:"legado",recordedBy:"autor",recordedAt:"original"}];const b=copy(a);b.state[key]=[];assert.equal(v(a,b).ok,false,key);b.state[key]=[{id:"legado",recordedBy:"intruso"}];assert.equal(v(a,b).ok,false,key)}});
test("impede limpar eventos e adulterar checklist sem trilha",()=>{const a=base(),b=copy(a);b.state.events=[];assert.equal(v(a,b).code,"SHIFT_EVENTS_REMOVAL_BLOCKED");const c=copy(a);c.state.checklist[0].status="Realizado";assert.equal(v(a,c).code,"CHECKLIST_AUDIT_REQUIRED")});
test("rejeita carimbo forjado pelo cliente",()=>{const a=base(),b=copy(a);b.state.checklistHistory.push({recordedBy:"intruso",shiftId:shift});assert.equal(v(a,b).code,"SHIFT_PROVENANCE_CLIENT_FORBIDDEN")});
test("exige episódio e leito físico válido para SAE",()=>{const a=base(),b=copy(a);b.state.careHistory.push({bed:11,episodeRn:"RN-A",shiftId:shift});assert.equal(v(a,b).code,"CARE_BED_EPISODE_REQUIRED")});
test("bloqueia mudança de turno sem snapshot",()=>{const a=base(),b=copy(a);b.state.shiftId="acef6d60-62bb-42dd-aeef-765b0b51f18e";assert.equal(v(a,b).code,"SHIFT_CLOSURE_REQUIRED")});
test("encerramento preserva eventos e checklist; carimbo vem do servidor",()=>{const a=base(),b=copy(a);b.state.shiftClosed=true;b.state.shiftHistory.push({shiftId:shift,events:copy(a.state.events),checklist:copy(a.state.checklist),care:copy(a.state.care),closedAt:"Aguardando servidor"});assert.equal(v(a,b).ok,true);const x=stamp(a,b,"enfermeiro",new Date("2026-11-22T12:00:00Z"));assert.equal(x.shiftHistory[0].event.recordedBy,"enfermeiro");assert.equal(x.shiftHistory[0].event.closedAt,"2026-11-22T12:00:00.000Z")});
test("legado sem UUID continua consultável e preservado",()=>{const a=w({events:[{text:"Legado"}],checklist:[{status:"Pendente"}],care:{}});assert.equal(v(a,copy(a)).ok,true)});

test("bloqueia snapshot de encerramento adulterado",()=>{const a=base(),b=copy(a);b.state.shiftClosed=true;b.state.shiftHistory.push({shiftId:shift,events:[],checklist:copy(a.state.checklist),care:copy(a.state.care)});assert.equal(v(a,b).code,"SHIFT_CLOSURE_SNAPSHOT_INVALID")});
test("não aceita encerramento sem histórico",()=>{const a=base(),b=copy(a);b.state.shiftClosed=true;assert.equal(v(a,b).code,"SHIFT_CLOSURE_REQUIRED")});
test("novo turno após encerramento preserva o histórico anterior",()=>{const a=base();a.state.shiftClosed=true;a.state.shiftHistory=[{shiftId:shift,events:copy(a.state.events),checklist:copy(a.state.checklist),care:copy(a.state.care),closedAt:"2026-11-22T12:00:00Z"}];const b=copy(a);b.state.shiftId="73f2c4b0-fc75-4bca-9b68-216e2fd9457c";b.state.shiftClosed=false;b.state.events=[];assert.equal(v(a,b).ok,true)});
