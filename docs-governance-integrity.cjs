"use strict";
const crypto=require("node:crypto");
const LEVELS=Object.freeze({reader:1,editor:2,validator:3,owner:4});
function allowed(level,action,sector,documentSector){
 const rank=LEVELS[level]||0;
 if(level!=="owner"&&sector!=="*"&&sector!==documentSector)return false;
 return rank>=({read:1,edit:2,approve:3}[action]||99);
}
function periodicity(months){const n=Number(months);if(![12,24,36].includes(n))throw Object.assign(new Error("INVALID_PERIOD"),{status:422});return n}
function hash(data){return crypto.createHash("sha256").update(data).digest("hex")}
function cpfValid(value){const d=String(value).replace(/\D/g,"");if(d.length!==11||/^(\d)\1+$/.test(d))return false;for(let t=9;t<11;t++){let sum=0;for(let i=0;i<t;i++)sum+=Number(d[i])*(t+1-i);let check=(sum*10)%11;if(check===10)check=0;if(check!==Number(d[t]))return false}return true}
function privacyFindings(text){
 const s=String(text||""),hits=[];
 if(/\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b/g.test(s)&&[...s.matchAll(/\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b/g)].some(m=>cpfValid(m[0])))hits.push("CPF");
 if(/\b(?:CNS|cart[aã]o\s+nacional\s+de\s+sa[uú]de)\s*[:#-]?\s*\d{15}\b/i.test(s))hits.push("CNS");
 if(/\b(?:prontu[aá]rio|registro\s+do\s+paciente|n[úu]mero\s+de\s+atendimento)\s*(?:n[ºo.]*)?\s*[:#-]\s*[A-Z0-9-]{4,}\b/i.test(s))hits.push("PRONTUARIO");
 if(/\b(?:data\s+de\s+nascimento|nascid[oa]\s+em|DN)\s*[:#-]\s*\d{2}[/.-]\d{2}[/.-]\d{4}\b/i.test(s))hits.push("NASCIMENTO");
 if(/\b(?:paciente|RN(?:\s+de)?|rec[eé]m[- ]nascido|nome\s+do\s+paciente)\s*[:#-]?\s*[a-záàâãéêíóôõúç]{2,}(?:\s+[a-záàâãéêíóôõúç]{2,}){1,3}\b/i.test(s))hits.push("NOME_CLINICO");
 return [...new Set(hits)]
}
function validateDocsMutation(oldDocs,newDocs){
 if(!Array.isArray(oldDocs)||!Array.isArray(newDocs))return {ok:false,code:"DOCS_INVALID"};
 const incoming=new Map(newDocs.map(d=>[String(d?.id||d?.code||""),d]));
 for(const d of oldDocs){
  const next=incoming.get(String(d?.id||d?.code||""));if(!next)return {ok:false,code:"DOC_DELETION_FORBIDDEN"};
  const oldVersions=Array.isArray(d.versions)?d.versions:[];
  const newVersions=Array.isArray(next.versions)?next.versions:[];
  for(const v of oldVersions){
   const nv=newVersions.find(x=>String(x.revision)===String(v.revision)&&String(x.createdAt||"")===String(v.createdAt||""));
   if(!nv)return {ok:false,code:"DOC_VERSION_DELETION_FORBIDDEN"};
   for(const field of ["wordKey","pdfKey","wordPath","pdfPath"]){
    if(v[field]&&v[field]!==nv[field]){
      const priorKeyField=field==="wordKey"?"previousWordKey":field==="pdfKey"?"previousPdfKey":null;
      const allowedPreparation=v.workflow!=="Vigente"&&v.workflow!=="Obsoleto"&&priorKeyField&&nv[priorKeyField]===v[field]&&typeof nv[field]==="string"&&nv[field].includes("|")&&nv.workflow!=="Vigente";
      if(!allowedPreparation)return {ok:false,code:"DOC_ARTIFACT_REBIND_FORBIDDEN"};
    }
   }
   if(v.workflow==="Vigente"&&nv.workflow!=="Vigente"&&nv.workflow!=="Obsoleto")return {ok:false,code:"DOC_VIGENTE_INVALID_TRANSITION"};
   if(v.workflow!=="Vigente"&&nv.workflow==="Vigente")return {ok:false,code:"DOC_PUBLICATION_REQUIRES_SERVER"};
  }
  if(newVersions.some(v=>v.workflow==="Vigente"&&!oldVersions.some(x=>String(x.revision)===String(v.revision)&&x.workflow==="Vigente")))return {ok:false,code:"DOC_PUBLICATION_REQUIRES_SERVER"};
 }
 if(newDocs.some(d=>!oldDocs.some(x=>String(x?.id||x?.code||"")===String(d?.id||d?.code||""))&&d.versions?.some(v=>v.workflow==="Vigente")))return {ok:false,code:"DOC_INITIAL_PUBLICATION_REQUIRES_SERVER"};
 return {ok:true};
}

// Only exact trusted hosts and their subdomains; lookalike domains are rejected.
const SCIENTIFIC_HOSTS=Object.freeze(["fiocruz.br","iff.fiocruz.br","sbp.com.br","who.int","cofen.gov.br","scielo.br","bvsalud.org","pubmed.ncbi.nlm.nih.gov"]);
function scientificSourceUrl(raw){
 try{
  const u=new URL(String(raw||"").trim());
  if(u.protocol!=="https:"||u.username||u.password||u.port)return null;
  const host=u.hostname.toLowerCase().replace(/\.$/,"");
  const institutional=SCIENTIFIC_HOSTS.some(domain=>host===domain||host.endsWith("."+domain));
  const government=host==="gov.br"||host.endsWith(".gov.br");
  if(!institutional&&!government)return null;
  if(government&&!(/^\/saude(?:\/|$)/.test(u.pathname)||/^\/anvisa(?:\/|$)/.test(u.pathname)||host==="saude.gov.br"||host==="anvisa.gov.br"))return null;
  return u.toString();
 }catch{return null}
}
function scientificReferencesVerified(refs,observedUrls){
 const observed=new Set((observedUrls||[]).map(scientificSourceUrl).filter(Boolean));
 return Array.isArray(refs)&&refs.length>0&&refs.every(r=>{
  const url=scientificSourceUrl(r?.url);
  return Boolean(url&&observed.has(url)&&String(r?.title||"").trim()&&/^\d{4}$/.test(String(r?.year||"")));
 });
}
module.exports={allowed,periodicity,hash,cpfValid,privacyFindings,validateDocsMutation,scientificSourceUrl,scientificReferencesVerified};
