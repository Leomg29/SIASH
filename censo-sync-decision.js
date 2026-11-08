/* SIASH — decisão segura após falha de sincronização.
 * Sem gravação, exclusão ou fusão automática.
 * localBaseRevision: revisão conhecida quando o profissional iniciou a edição.
 */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.SIASH_SYNC_DECISION=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
function decideSync({localBaseRevision,remoteRevision,localDirty,remoteAvailable}){
 if(typeof localDirty!=="boolean"||typeof remoteAvailable!=="boolean")
  throw Error("Estado de sincronização inválido");
 if(!Number.isSafeInteger(localBaseRevision)||localBaseRevision<1)
  throw Error("Revisão local inválida");
 if(!remoteAvailable)return {action:"preserve-local",canWrite:false,reason:"Rede indisponível; preservar alterações locais"};
 if(!Number.isSafeInteger(remoteRevision)||remoteRevision<1)
  throw Error("Revisão remota inválida");
 if(remoteRevision<localBaseRevision)
  return {action:"investigate",canWrite:false,reason:"Servidor retornou revisão inferior à versão local"};
 if(remoteRevision>localBaseRevision)
  return {action:localDirty?"manual-reconcile":"refresh-remote",canWrite:false,reason:"Revisão remota mais recente"};
 if(!localDirty)return {action:"no-write",canWrite:false,reason:"Nenhuma alteração local pendente"};
 return {action:"write-with-base-revision",canWrite:true,base_revision:localBaseRevision};
}
return {decideSync};
});
