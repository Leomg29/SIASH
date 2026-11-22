"use strict";
const {dateInBrazil}=require("./census-midnight.cjs");
const STATES=Object.freeze(["pendente","regularizacao_solicitada","aguardando_supervisor","regularizacao_aprovada","regularizacao_rejeitada","pendente_validacao_clinica"]);
const MIN_REASON_LENGTH=15;
function validDate(s){return typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+"T12:00:00Z"))&&new Date(s+"T12:00:00Z").toISOString().slice(0,10)===s}
function validateRequest({referenceDate,justification,evidence,proposedCount,actor,now=new Date()}){
 if(!validDate(referenceDate))return {ok:false,code:"INVALID_REFERENCE_DATE"};
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))return {ok:false,code:"INVALID_SERVER_CLOCK"};
 if(referenceDate>=dateInBrazil(now))return {ok:false,code:"REFERENCE_DATE_NOT_PAST"};
 const {censusWindow}=require("./census-window.cjs");
 const window=censusWindow(now);
 if(referenceDate===window.referenceDate&&window.phase==="confirmation")return {ok:false,code:"OFFICIAL_WINDOW_STILL_OPEN"};
 if(typeof actor!=="string"||!actor.trim())return {ok:false,code:"MISSING_REQUESTER"};
 if(typeof justification!=="string"||justification.trim().length<MIN_REASON_LENGTH)return {ok:false,code:"JUSTIFICATION_REQUIRED"};
 if(typeof evidence!=="string"||!evidence.trim())return {ok:false,code:"EVIDENCE_REQUIRED"};
 if(!Number.isSafeInteger(proposedCount)||proposedCount<0)return {ok:false,code:"INVALID_COUNT"};
 return {ok:true,requester:actor.trim(),referenceDate,proposedCount,justification:justification.trim(),evidence:evidence.trim(),requestedAt:now.toISOString()};
}
function decideReview({request,supervisor,approved,reason,now=new Date()}){
 if(!request||request.status!=="aguardando_supervisor")return {ok:false,code:"INVALID_REVIEW_STATE"};
 if(typeof supervisor!=="string"||!supervisor.trim())return {ok:false,code:"SUPERVISOR_REQUIRED"};
 if(supervisor.trim()===request.requester)return {ok:false,code:"SELF_APPROVAL_FORBIDDEN"};
 if(approved!==true&&approved!==false&&approved!==null)return {ok:false,code:"DECISION_REQUIRED"};
 if(typeof reason!=="string"||reason.trim().length<MIN_REASON_LENGTH)return {ok:false,code:"REVIEW_REASON_REQUIRED"};
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))return {ok:false,code:"INVALID_SERVER_CLOCK"};
 return {ok:true,status:approved===null?"pendente_validacao_clinica":approved?"regularizacao_aprovada":"regularizacao_rejeitada",reviewedBy:supervisor.trim(),reviewedAt:now.toISOString(),reviewReason:reason.trim()};
}
module.exports={STATES,validateRequest,decideReview};
