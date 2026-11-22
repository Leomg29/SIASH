"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {STATES,validateRequest,decideReview}=require("../census-late-regularization.cjs");
const now=new Date("2026-11-23T12:00:00Z");
const sample={referenceDate:"2026-11-22",justification:"Intercorrência clínica prolongada no plantão noturno",evidence:"Censo do plantão e registros de admissão e alta",proposedCount:4,actor:"enfermeiro1",now};
test("seis estados definidos sem tocar nos indicadores",()=>{assert.equal(STATES.length,6);assert.ok(STATES.includes("pendente_validacao_clinica"))});
test("solicitação exige evidências, justificativa, data passada e contagem",()=>{
 const ok=validateRequest(sample);assert.equal(ok.ok,true);assert.equal(ok.requestedAt,now.toISOString());
 for(const changes of [{justification:"curto"},{evidence:""},{referenceDate:"2026-11-23"},{referenceDate:"2026-02-30"},{proposedCount:-1},{actor:""}])assert.equal(validateRequest({...sample,...changes}).ok,false);
});
test("autoaprovação bloqueada e revisão só a partir do estado correto",()=>{
 const request={requester:"enfermeiro1",status:"aguardando_supervisor"};
 assert.equal(decideReview({request,supervisor:"enfermeiro1",approved:true,reason:"Conferência dos registros e evidências",now}).code,"SELF_APPROVAL_FORBIDDEN");
 assert.equal(decideReview({request:{...request,status:"regularizacao_aprovada"},supervisor:"supervisor2",approved:true,reason:"Conferência dos registros e evidências",now}).code,"INVALID_REVIEW_STATE");
 const ok=decideReview({request,supervisor:"supervisor2",approved:true,reason:"Conferência dos registros e evidências",now});
 assert.equal(ok.status,"regularizacao_aprovada");assert.equal(ok.reviewedAt,now.toISOString());
 const rejected=decideReview({request,supervisor:"supervisor2",approved:false,reason:"Evidências clínicas insuficientes",now});
 assert.equal(rejected.status,"regularizacao_rejeitada");
});
