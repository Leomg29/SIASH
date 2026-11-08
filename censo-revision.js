/* SIASH — controle otimista de revisão, sem persistência nem dados reais.
 * A camada de banco deverá executar comparação e gravação em UMA transação.
 */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SIASH_REVISION=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
function applyRevision(current,command){
 if(!current||typeof current!=="object"||!Number.isSafeInteger(current.revision)||current.revision<0)
  throw Error("Estado ou revisão inválida");
 if(!command||typeof command!=="object"||!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0)
  throw Error("Revisão esperada inválida");
 if(current.revision!==command.expectedRevision)throw Error("Conflito de revisão: recarregue antes de salvar");
 if(typeof command.actorId!=="string"||!command.actorId.trim())throw Error("Usuário responsável obrigatório");
 if(typeof command.eventId!=="string"||!command.eventId.trim())throw Error("ID de evento obrigatório");
 if(!Array.isArray(current.events))throw Error("Histórico de eventos inválido");
 if(current.events.some(e=>e.eventId===command.eventId))throw Error("ID de evento duplicado");
 if(current.revision===Number.MAX_SAFE_INTEGER)throw Error("Limite de revisão atingido");
 const event={eventId:command.eventId,actorId:command.actorId,type:command.type,admissionId:command.admissionId,at:command.at};
 if(!["admission","rename","transfer","discharge","census-close","census-amend"].includes(event.type))
  throw Error("Tipo de evento inválido");
 if(typeof event.admissionId!=="string"||!event.admissionId.trim())throw Error("Internação obrigatória");
 if(typeof event.at!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.at)||!Number.isFinite(Date.parse(event.at)))
  throw Error("Horário de evento inválido");
 // Somente dados mínimos no log; payload clínico deve ser persistido sob autorização e trilha próprias.
 return {revision:current.revision+1,events:[...current.events,event]};
}
return {applyRevision};
});
