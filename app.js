const $=id=>document.getElementById(id);
const STORE="siash_utin_consolidada_v08";
const SECURITY_STORE="siash_security_v09";
let SESSION={authenticated:false,role:null,user:null};
const OPERATIONAL_USERS={"coordenacao.utin":"siash"};
const LAST_LOGIN_STORE="siash_last_login";
function rememberedLogin(){try{return localStorage.getItem(LAST_LOGIN_STORE)||""}catch(e){return ""}}
function rememberLogin(user=""){try{if(String(user).trim())localStorage.setItem(LAST_LOGIN_STORE,String(user).trim())}catch(e){}}

const SIASH_CLOUD={
 enabled:location.protocol==="http:"||location.protocol==="https:",
 token:sessionStorage.getItem("siash_cloud_token")||"",
 lastSync:null,
 syncing:false,
 revision:null,
 conflict:false,
 editGeneration:0,
 retryCount:0
};
// Snapshot imutável da última revisão confirmada. Não usar o estado local como base.
let cloudBaseSnapshot=null,cloudBaseRevision=null,cloudBaseUser=null;
function cloudSetBase(state){cloudBaseSnapshot=JSON.parse(JSON.stringify(state));cloudBaseRevision=SIASH_CLOUD.revision;cloudBaseUser=SESSION.user||null;}
function cloudRestoreDraftBase(pending){cloudBaseSnapshot=null;cloudBaseRevision=null;cloudBaseUser=null;if(pending?.user&&pending.user===SESSION.user&&Number.isSafeInteger(pending.revision)&&pending.revision>0&&pending.baseRevision===pending.revision&&pending.baseState&&typeof pending.baseState==="object"&&!Array.isArray(pending.baseState)){cloudBaseSnapshot=JSON.parse(JSON.stringify(pending.baseState));cloudBaseRevision=pending.baseRevision;cloudBaseUser=pending.user;}}
function cloudThreeWayMerge(base,local,server){
 const eq=cloudStatesEqual;
 const conflicts=[];
 function merge(b,l,r,path){
  if(eq(l,b))return structuredCloneSafe(r);
  if(eq(r,b)||eq(l,r))return structuredCloneSafe(l);
  if(Array.isArray(b)&&Array.isArray(l)&&Array.isArray(r)){
   if(path==="beds"){
    const keyed=a=>a.every(x=>x&&Number.isSafeInteger(Number(x.n)))&&new Set(a.map(x=>Number(x.n))).size===a.length;
    if(!keyed(b)||!keyed(l)||!keyed(r)){conflicts.push({path,base:b,local:l,server:r});return structuredCloneSafe(r)}
    const bm=new Map(b.map(x=>[Number(x.n),x])),lm=new Map(l.map(x=>[Number(x.n),x])),rm=new Map(r.map(x=>[Number(x.n),x]));
    const keys=[...new Set([...bm.keys(),...lm.keys(),...rm.keys()])].sort((a,z)=>a-z);
    return keys.map(k=>merge(bm.get(k),lm.get(k),rm.get(k),path+"["+k+"]")).filter(x=>x!==undefined);
   }
   if(path==="daily"){
    const valid=a=>a.every(x=>x&&typeof x.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x.date))&&new Set(a.map(x=>x.date)).size===a.length;
    if(!valid(b)||!valid(l)||!valid(r)){conflicts.push({path,base:b,local:l,server:r,reason:"invalid-or-duplicate-date"});return structuredCloneSafe(r);}
    const bm=new Map(b.map(x=>[x.date,x])),lm=new Map(l.map(x=>[x.date,x])),rm=new Map(r.map(x=>[x.date,x]));
    return [...new Set([...bm.keys(),...lm.keys(),...rm.keys()])].sort().map(k=>{
     const bv=bm.get(k),lv=lm.get(k),rv=rm.get(k);
     if(eq(lv,bv))return structuredCloneSafe(rv);
     if(eq(rv,bv)||eq(lv,rv))return structuredCloneSafe(lv);
     // Same clinical day changed by both sessions: never synthesize a census.
     conflicts.push({path:"daily["+k+"]",base:bv,local:lv,server:rv});return structuredCloneSafe(rv);
    }).filter(x=>x!==undefined);
   }
   if(path==="picc"||path==="pipa"){
    const valid=a=>a.every(x=>x&&typeof x.id==="string"&&x.id.length>0)&&new Set(a.map(x=>x.id)).size===a.length;
    if(!valid(b)||!valid(l)||!valid(r)){
     conflicts.push({path,base:b,local:l,server:r,reason:"legacy-or-duplicate-id"});
     return structuredCloneSafe(r);
    }
    const bm=new Map(b.map(x=>[x.id,x])),lm=new Map(l.map(x=>[x.id,x])),rm=new Map(r.map(x=>[x.id,x]));
    const ids=[...new Set(path==="pipa"?[...rm.keys(),...lm.keys(),...bm.keys()]:[...bm.keys(),...rm.keys(),...lm.keys()])];
    return ids.map(id=>{
     const bv=bm.get(id),lv=lm.get(id),rv=rm.get(id);
     if(bv===undefined){
      if(lv!==undefined&&rv!==undefined&&!eq(lv,rv)){conflicts.push({path:path+"["+id+"]",base:bv,local:lv,server:rv});return structuredCloneSafe(rv)}
      return structuredCloneSafe(lv===undefined?rv:lv);
     }
     if(lv===undefined||rv===undefined){
      if(eq(lv,bv))return structuredCloneSafe(rv);
      if(eq(rv,bv))return structuredCloneSafe(lv);
      conflicts.push({path:path+"["+id+"]",base:bv,local:lv,server:rv});return structuredCloneSafe(rv);
     }
     return merge(bv,lv,rv,path+"["+id+"]");
    }).filter(x=>x!==undefined);
   }
   // Without stable identity, changed array sizes or ordering are unsafe.
   if(b.length!==l.length||b.length!==r.length){conflicts.push({path,base:b,local:l,server:r});return structuredCloneSafe(r)}
   return b.map((x,i)=>merge(x,l[i],r[i],path+"["+i+"]"));
  }
  if(b&&l&&r&&typeof b==="object"&&typeof l==="object"&&typeof r==="object"&&!Array.isArray(b)&&!Array.isArray(l)&&!Array.isArray(r)){
   const out={};for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    if(k==="__proto__"||k==="constructor"||k==="prototype")continue;
    const v=merge(b[k],l[k],r[k],path?path+"."+k:k);if(v!==undefined)out[k]=v;
   }return out;
  }
  conflicts.push({path,base:b,local:l,server:r});
  return structuredCloneSafe(r);
 }
 function structuredCloneSafe(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v))}
 return {state:merge(base,local,server,""),conflicts};
}
const SIASH_PENDING_KEY="siash_cloud_pending_v1";
function cloudPending(){try{return JSON.parse(localStorage.getItem(SIASH_PENDING_KEY)||"null")}catch(e){return null}}
function preserveCloudDraft(reason){try{localStorage.setItem(SIASH_PENDING_KEY,JSON.stringify({user:SESSION.user||null,reason,revision:cloudBaseUser===SESSION.user&&cloudBaseSnapshot?cloudBaseRevision:SIASH_CLOUD.revision,baseRevision:cloudBaseUser===SESSION.user&&cloudBaseSnapshot?cloudBaseRevision:null,baseState:cloudBaseUser===SESSION.user?cloudBaseSnapshot:null,updatedAt:new Date().toISOString(),state:S}));localStorage.setItem(STORE,JSON.stringify(S))}catch(e){console.error("Não foi possível preservar o rascunho local",e);updateCloudBadge("ERRO · armazenamento local indisponível",true)}}
function clearCloudDraft(){try{localStorage.removeItem(SIASH_PENDING_KEY)}catch(e){console.error(e)}}
// PR #102: deterministic local LGPD gate; same patterns and CPF checksum as docs-governance-integrity.cjs.
function localCpfValid(value){const d=String(value).replace(/\D/g,"");if(d.length!==11||/^(\d)\1+$/.test(d))return false;for(let t=9;t<11;t++){let sum=0;for(let i=0;i<t;i++)sum+=Number(d[i])*(t+1-i);let check=(sum*10)%11;if(check===10)check=0;if(check!==Number(d[t]))return false}return true}
function localPrivacyFindings(text){
 const s=String(text||""),hits=[];
 if(/\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b/g.test(s)&&[...s.matchAll(/\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b/g)].some(m=>localCpfValid(m[0])))hits.push("CPF");
 if(/\b(?:CNS|cart[aã]o\s+nacional\s+de\s+sa[uú]de)\s*[:#-]?\s*\d{15}\b/i.test(s))hits.push("CNS");
 if(/\b(?:prontu[aá]rio|registro\s+do\s+paciente|n[úu]mero\s+de\s+atendimento)\s*(?:n[ºo.]*)?\s*[:#-]\s*[A-Z0-9-]{4,}\b/i.test(s))hits.push("PRONTUARIO");
 if(/\b(?:data\s+de\s+nascimento|nascid[oa]\s+em|DN)\s*[:#-]\s*\d{2}[/.-]\d{2}[/.-]\d{4}\b/i.test(s))hits.push("NASCIMENTO");
 if(/\b(?:paciente|RN(?:\s+de)?|rec[eé]m[- ]nascido|nome\s+do\s+paciente)\s*[:#-]\s*[a-záàâãéêíóôõúç]{2,}(?:\s+[a-záàâãéêíóôõúç]{2,}){1,3}\b/i.test(s))hits.push("NOME_CLINICO");
 return [...new Set(hits)];
}
async function localDocPrivacyCheck(input){
 let text=String(input??"");
 if(input instanceof Blob){
  if(typeof JSZip==="undefined")throw Error("LGPD: leitor DOCX indisponível; envio bloqueado.");
  const zip=await JSZip.loadAsync(await input.arrayBuffer(),{checkCRC32:true});
  const documentXml=zip.file("word/document.xml");if(!documentXml)throw Error("LGPD: documento Word inválido; envio bloqueado.");
  const xml=await documentXml.async("string");
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  if(doc.querySelector("parsererror"))throw Error("LGPD: XML do Word inválido; envio bloqueado.");
  text=Array.from(doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","t")).map(x=>x.textContent).join(" ");
 }
 return localPrivacyFindings(text);
}
window.localDocPrivacyCheck=localDocPrivacyCheck;
// Exact structural equality; array order remains significant.
function cloudStatesEqual(a,b){
 if(a===b)return true;
 if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
 if(Array.isArray(a))return a.length===b.length&&a.every((v,i)=>cloudStatesEqual(v,b[i]));
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&cloudStatesEqual(a[k],b[k]));
}
function cloudDraftIsCurrent(pending,remote){return !!(pending&&remote?.exists&&Number.isSafeInteger(pending.revision)&&pending.revision===remote.revision)}

function cloudHeaders(extra={}){return {...extra,...(SIASH_CLOUD.token?{Authorization:"Bearer "+SIASH_CLOUD.token}:{})}}
async function cloudJson(url,opts={}){
 const res=await fetch(url,{...opts,headers:cloudHeaders({"Content-Type":"application/json",...(opts.headers||{})})});
 const data=await res.json().catch(()=>({}));
 if(!res.ok){const err=new Error(data.error||`Erro Cloud ${res.status}`);err.status=res.status;err.conflict=!!data.conflict;throw err;}
 return data;
}
async function cloudHealth(){if(!SIASH_CLOUD.enabled)return {ok:false,local:true};try{return await cloudJson("/api/health")}catch(e){return {ok:false,error:e.message}}}
async function cloudAuthenticate(username,password,bootstrap=false){
 if(!SIASH_CLOUD.enabled)throw new Error("Abra a SIASH pelo endereço Cloud (http/https), não pelo arquivo index.html.");
 const data=await cloudJson(bootstrap?"/api/bootstrap":"/api/login",{method:"POST",body:JSON.stringify({username,password})});
 SIASH_CLOUD.token=data.token;sessionStorage.setItem("siash_cloud_token",data.token);return data;
}
function cloudPayload(){return {state:S,security:securityState(),schema:"siash-0.14.19",savedAt:new Date().toISOString()}}
function parkCloudDraft(){
 const pending=cloudPending();
 if(!pending||!SESSION.user||pending.user!==SESSION.user||!cloudStatesEqual(pending.state,S))return false;
 const key=SIASH_PENDING_KEY+":parked:"+encodeURIComponent(SESSION.user);
 try{const raw=JSON.stringify(pending),existing=localStorage.getItem(key);if(existing&&existing!==raw)return false;if(!existing)localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw||localStorage.getItem(SIASH_PENDING_KEY)!==raw)return false;localStorage.removeItem(SIASH_PENDING_KEY);return localStorage.getItem(SIASH_PENDING_KEY)===null;}catch(e){return false;}
}
function restoreParkedCloudDraft(){
 if(!SESSION.user)return;
 const key=SIASH_PENDING_KEY+":parked:"+encodeURIComponent(SESSION.user);
 const raw=localStorage.getItem(key);if(!raw)return;
 const pending=JSON.parse(raw);if(pending.user!==SESSION.user)throw new Error("Autoria do rascunho inválida.");
 const active=localStorage.getItem(SIASH_PENDING_KEY);
 if(active&&active!==raw)return;
 if(!active)localStorage.setItem(SIASH_PENDING_KEY,raw);
 if(localStorage.getItem(SIASH_PENDING_KEY)===raw)localStorage.removeItem(key);
}
async function cloudLoadAfterLogin(){
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return false;
 restoreParkedCloudDraft();
 const pending=cloudPending();
 if(pending){
   if(pending.user&&pending.user!==SESSION.user)throw new Error("Existe um rascunho pendente de outro usuário neste navegador. Acesse com o usuário original para conciliar os dados.");
   // Recuperar o rascunho antes de consultar a rede: falha na consulta não pode impedir acesso à cópia local.
   SIASH_CLOUD.conflict=true;
   cloudRestoreDraftBase(pending);
   S=pending.state;normalize();localStorage.setItem(STORE,JSON.stringify(S));
   let remote=null;
   try{remote=await cloudJson("/api/state");SIASH_CLOUD.revision=remote.exists?remote.revision:null}
   catch(e){console.error("Consulta da revisão indisponível",e);SIASH_CLOUD.revision=null}
   // A lost response or legacy draft can already match the confirmed server.
   // Never infer equivalence from revision alone or discard another user's draft.
   if(pending.user===SESSION.user&&remote?.exists&&Number.isSafeInteger(remote.revision)&&remote.revision>0&&remote.payload?.state&&cloudStatesEqual(pending.state,remote.payload.state)&&cloudStatesEqual(S,remote.payload.state)){
     SIASH_CLOUD.revision=remote.revision;cloudSetBase(remote.payload.state);
     if(remote.payload.security)setSecurityState(remote.payload.security);
     SIASH_CLOUD.conflict=false;clearCloudDraft();SIASH_CLOUD.lastSync=remote.updated_at||new Date().toISOString();updateCloudBadge("Sincronizado");loadSharedPending();return true;
   }
   updateCloudBadge(!remote?"OFFLINE · rascunho local protegido":cloudDraftIsCurrent(pending,remote)?"PENDENTE · revisão conferida, conciliação necessária":"CONFLITO · revisão remota diferente",true);
   alert("Existe um rascunho não sincronizado. O salvamento permanece bloqueado. Abra a Conciliação de Rascunhos para inspecionar as versões antes de decidir.");
   void showCloudConflictPanel();
   return true;
 }
 // Uma edição local iniciada durante o GET não pode ser substituída pela resposta atrasada.
 const loadGeneration=SIASH_CLOUD.editGeneration;
 const remote=await cloudJson("/api/state");
 if(SIASH_CLOUD.editGeneration!==loadGeneration||cloudPending()){
   preserveCloudDraft("load-race");
   SIASH_CLOUD.conflict=true;
   updateCloudBadge("CONFLITO · edição local durante carregamento",true);
   alert("Houve uma edição local enquanto os dados remotos eram carregados. Rascunho protegido; conciliação necessária.");
   return true;
 }
 if(remote.exists&&remote.payload?.state){
   if(!Number.isSafeInteger(remote.revision)||remote.revision<1){
     preserveCloudDraft("revision-unavailable");SIASH_CLOUD.conflict=true;
     updateCloudBadge("REVISÃO REMOTA INVÁLIDA · rascunho protegido",true);
     throw new Error("Estado remoto sem revisão válida; conciliação necessária.");
   }
   SIASH_CLOUD.revision=remote.revision;SIASH_CLOUD.conflict=false;
   cloudSetBase(remote.payload.state);
   S=remote.payload.state; if(remote.payload.security)setSecurityState(remote.payload.security);
   normalize();localStorage.setItem(STORE,JSON.stringify(S));SIASH_CLOUD.lastSync=remote.updated_at||new Date().toISOString();updateCloudBadge("Sincronizado");loadSharedPending();return true;
 }
 if(remote.exists){
   preserveCloudDraft("remote-state-invalid");SIASH_CLOUD.conflict=true;
   updateCloudBadge("ESTADO REMOTO INVÁLIDO · rascunho protegido",true);
   throw new Error("O servidor informou estado existente sem dados válidos. Rascunho preservado; conciliação necessária.");
 }
 const localRaw=localStorage.getItem(STORE);
 if(localRaw){
   let initialized;
   try{
     initialized=await cloudJson("/api/state/init",{method:"PUT",body:JSON.stringify({payload:cloudPayload()})});
   }catch(e){
     // Um 409 indica que outra sessão inicializou o banco. Uma falha de rede
     // pode ocorrer depois do commit. Em ambos os casos, nunca substituir
     // silenciosamente a cópia local pelo estado remoto no próximo login.
     preserveCloudDraft(e.status===409||e.conflict?"initialization-conflict":"initialization-unconfirmed");
     SIASH_CLOUD.conflict=true;
     updateCloudBadge("MIGRAÇÃO NÃO CONFIRMADA · rascunho protegido",true);
     throw new Error("Migração inicial não confirmada. O rascunho local foi preservado para conciliação: "+e.message);
   }
   if(!Number.isSafeInteger(initialized.revision)||initialized.revision<1){preserveCloudDraft("revision-unavailable");SIASH_CLOUD.conflict=true;throw new Error("Inicialização sem revisão válida. O rascunho foi preservado e a sincronização foi bloqueada.");}
   SIASH_CLOUD.revision=initialized.revision;cloudSetBase(S);SIASH_CLOUD.conflict=false;SIASH_CLOUD.lastSync=new Date().toISOString();updateCloudBadge("Dados locais migrados");loadSharedPending();return true;
 }
 return false;
}
let censusConferencePending=null;
function censusConferenceFeedback(message,error=false){const el=$("census-midnight-alert"),btn=$("census-close");if(el){el.textContent=message;el.style.color=error?"#b45309":"";}if(btn)btn.disabled=Boolean(censusConferencePending);}
let cloudSaveTimer=null;
let cloudRetryTimer=null;
function retryCloudWhenOnline(){
 if(SIASH_CLOUD.conflict||!SIASH_CLOUD.token)return;
 clearTimeout(cloudRetryTimer);
 const delay=Math.min(30000,1000*Math.pow(2,Math.min(SIASH_CLOUD.retryCount++,5)));
 cloudRetryTimer=setTimeout(()=>{if(navigator.onLine!==false&&!SIASH_CLOUD.syncing)scheduleCloudSave({retry:true});else retryCloudWhenOnline()},delay);
}
if(typeof window!=="undefined")window.addEventListener("online",()=>{if(cloudPending()&&!SIASH_CLOUD.conflict&&SIASH_CLOUD.token)retryCloudWhenOnline()});
function scheduleCloudSave({retry=false}={}){
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return;
 if(!retry){SIASH_CLOUD.editGeneration++;preserveCloudDraft("pending")}
 else if(!cloudPending())return;
 if(SIASH_CLOUD.conflict){if(censusConferencePending){censusConferencePending=null;censusConferenceFeedback("Conflito de sincronização. Conferência local preservada; concilie antes de repetir.",true);}updateCloudBadge("CONFLITO · cópia local preservada",true);return;}
 clearTimeout(cloudSaveTimer);
 cloudSaveTimer=setTimeout(async()=>{
   if(SIASH_CLOUD.syncing){scheduleCloudSaveRetry();return;}
   if(SIASH_CLOUD.conflict)return;
   if(!Number.isSafeInteger(SIASH_CLOUD.revision)){if(censusConferencePending){censusConferencePending=null;censusConferenceFeedback("Sem revisão válida no servidor. Conferência local preservada.",true);}preserveCloudDraft("revision-unavailable");updateCloudBadge("Sessão sem revisão · rascunho protegido",true);return;}
   SIASH_CLOUD.syncing=true;updateCloudBadge("Salvando…");
   const generation=SIASH_CLOUD.editGeneration;
   const sentState=JSON.parse(JSON.stringify(S));
   try{
     const r=await cloudJson("/api/state",{method:"PUT",body:JSON.stringify({payload:cloudPayload(),base_revision:SIASH_CLOUD.revision})});
     SIASH_CLOUD.revision=r.revision;
     // Incorporar metadados oficiais do servidor na base e no rascunho atual.
     // Nunca sobrescrever edições feitas durante o envio.
     if(r.bed_event_stamps){
       for(const key of ["bedMoves","profileHistory","movements"]){
         for(const stamp of r.bed_event_stamps[key]||[]){
           if(Array.isArray(sentState[key])&&sentState[key][stamp.index]){
             sentState[key][stamp.index]=stamp.event;
             if(Array.isArray(S[key])&&S[key][stamp.index]){
               const current=S[key][stamp.index],official=stamp.event;
               const core=x=>JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>!["id","recordedBy","recordedAt","recordedAtSaoPaulo","timeZone"].includes(k))));
               if(core(current)===core(official))S[key][stamp.index]=official;
             }
           }
         }
       }
       localStorage.setItem(STORE,JSON.stringify(S));
     }
     if(r.shift_event_stamps){for(const key of ["shiftHistory","checklistHistory","careHistory","shiftEvents"]){for(const stamp of r.shift_event_stamps[key]||[]){if(S[key]?.[stamp.index])S[key][stamp.index]=stamp.event;if(sentState[key]?.[stamp.index])sentState[key][stamp.index]=stamp.event;}}localStorage.setItem(STORE,JSON.stringify(S));}
     if(Array.isArray(r.picc_event_stamps)){
       for(const stamp of r.picc_event_stamps){
         const index=stamp.recordIndex;
         if(!Array.isArray(sentState.piccEvents))sentState.piccEvents=[];
         if(!Array.isArray(S.piccEvents))S.piccEvents=[];
         const existing=sentState.piccEvents.findIndex(e=>e.id===stamp.id||(!e.id&&e.type===stamp.type&&e.recordIndex===index&&e.justification===stamp.justification));
         if(existing>=0){sentState.piccEvents[existing]=stamp;if(S.piccEvents[existing])S.piccEvents[existing]=stamp;}
         else{sentState.piccEvents.push(stamp);S.piccEvents.push(stamp);}
       }
       localStorage.setItem(STORE,JSON.stringify(S));
     }
     if(Array.isArray(r.census_conference_stamps)){
       for(const stamp of r.census_conference_stamps){
         const sent=sentState.daily?.find(d=>d.date===stamp.date);
         const current=S.daily?.find(d=>d.date===stamp.date);
         if(!sent?.censusConference||!stamp.conference)continue;
         const original=sent.censusConference;
         sent.censusConference=stamp.conference;
         if(current&&cloudStatesEqual(current.censusConference,original))current.censusConference=stamp.conference;
       }
       localStorage.setItem(STORE,JSON.stringify(S));
     }
     cloudSetBase(sentState);
     // O servidor é a fonte de verdade para autor e horário do cancelamento.
     // Se houve novas edições durante o PUT, não sobrescrever o rascunho atual.
     if(Array.isArray(r.pipa_cancellations)&&r.pipa_cancellations.length){
       // Aplicar somente o carimbo do registro cancelado: outras edições locais
       // feitas durante a requisição continuam intactas e pendentes de envio.
       for(const item of r.pipa_cancellations){
         const record=S.pipa[item.index];
         if(record&&record.cancelledAt&&record.cancelReason){
           record.cancelledAt=item.cancelledAt;
           record.cancelledBy=item.cancelledBy;
           if(typeof item.cancelReason==="string")record.cancelReason=item.cancelReason;
         }
       }
       localStorage.setItem(STORE,JSON.stringify(S));
       if(generation!==SIASH_CLOUD.editGeneration)preserveCloudDraft("pending");
     }
     SIASH_CLOUD.lastSync=r.updated_at||new Date().toISOString();
     if(generation===SIASH_CLOUD.editGeneration){clearCloudDraft();SIASH_CLOUD.retryCount=0;clearTimeout(cloudRetryTimer);updateCloudBadge("Sincronizado");if(censusConferencePending&&generation>=censusConferencePending.generation){const pending=censusConferencePending;censusConferencePending=null;censusConferenceFeedback("Conferência enviada; verificando confirmação do servidor…");(typeof refreshMidnightCensusStatus==="function"?refreshMidnightCensusStatus():Promise.resolve()).then(()=>{const el=$("census-midnight-alert");if(el&&el.textContent.includes("pendente"))censusConferenceFeedback("A conferência foi sincronizada, mas o censo ainda requer revisão: "+el.textContent,true);});}else if(typeof refreshMidnightCensusStatus==="function")void refreshMidnightCensusStatus()}else{preserveCloudDraft("pending");updateCloudBadge("Alterações pendentes…",true)}
   }catch(e){
     if(censusConferencePending){censusConferencePending=null;censusConferenceFeedback("Falha na confirmação da conferência. Registro local preservado; verifique o estado de sincronização antes de tentar novamente.",true);}
     console.error(e);
     preserveCloudDraft(e.status===401?"session-expired":e.conflict||e.status===409||e.status===428||e.status===422?"conflict":"network");
     if(e.status===401){SIASH_CLOUD.conflict=true;updateCloudBadge("Sessão expirada · rascunho protegido",true);alert("Sessão expirada. Seu rascunho foi preservado neste navegador. Entre novamente para conciliar os dados.");}
     else if(e.conflict||e.status===409||e.status===428||e.status===422){
       SIASH_CLOUD.conflict=true;
       localStorage.setItem(STORE,JSON.stringify(S));
       void showCloudConflictPanel();
       updateCloudBadge(e.status===422?"INTEGRIDADE PIPA / LEITOS / PICC · revisão necessária":"CONFLITO · dados locais preservados",true);
       alert(e.status===422?"O servidor recusou uma alteração do PIPA por inconsistência de integridade, ou outra alteração clínica protegida (leitos ou PICC): "+e.message+" Seu rascunho está preservado e o envio automático foi bloqueado. Solicite conciliação à coordenação.":"ATENÇÃO: outro profissional alterou os dados ou sua sessão está desatualizada. Seu trabalho permanece neste navegador. Não recarregue nem feche a página antes de conferir e salvar uma cópia dos lançamentos. Contate a coordenação para conciliar as alterações.");
     }else{
       // A resposta pode ter sido perdida depois do commit: conferir a revisão antes de reenviar.
       try{
         const remote=await cloudJson("/api/state");
         if(remote.exists&&Number.isSafeInteger(remote.revision)&&remote.revision!==SIASH_CLOUD.revision){
           SIASH_CLOUD.conflict=true;
           updateCloudBadge("CONFIRMAÇÃO INCERTA · conciliação necessária",true);
           alert("A conexão caiu e o servidor apresenta outra revisão. O rascunho local está protegido. Não reenvie antes de conciliar os dados.");
         }else if(remote.exists&&Number.isSafeInteger(remote.revision)&&remote.revision===SIASH_CLOUD.revision){
           updateCloudBadge("Falha de rede · aguardando reconexão",true);
           retryCloudWhenOnline();
         }else{
           // Uma resposta incompleta não comprova que a gravação anterior falhou.
           SIASH_CLOUD.conflict=true;
           preserveCloudDraft("confirmation-unknown");
           updateCloudBadge("SALVAMENTO INCERTO · conciliação necessária",true);
           alert("O servidor não confirmou uma revisão válida após a falha de rede. Seu rascunho foi preservado e o reenvio automático bloqueado para evitar conflitos.");
         }
       }catch(checkError){
         if(checkError.status===401){
           SIASH_CLOUD.conflict=true;
           preserveCloudDraft("session-expired");
           updateCloudBadge("Sessão expirada · rascunho protegido",true);
           alert("A sessão expirou durante a conferência do salvamento. Entre novamente para conciliar o rascunho protegido.");
         }else{
           // Sem leitura de confirmação, o PUT pode ter sido gravado apesar da falha de rede.
           // Bloquear qualquer reenvio automático, inclusive edições feitas durante a requisição.
           SIASH_CLOUD.conflict=true;
           preserveCloudDraft("confirmation-unknown");
           updateCloudBadge("SALVAMENTO INCERTO · conciliação necessária",true);
           alert("Não foi possível confirmar se o último salvamento chegou ao servidor. Seu rascunho permanece neste navegador. O reenvio automático foi bloqueado para evitar duplicidades ou conflitos; solicite conciliação antes de continuar.");
         }
       }
     }
   }finally{
     SIASH_CLOUD.syncing=false;
     if(!SIASH_CLOUD.conflict&&generation!==SIASH_CLOUD.editGeneration){clearTimeout(cloudRetryTimer);scheduleCloudSaveRetry();}
   }
 },350);
}
function scheduleCloudSaveRetry(){
 clearTimeout(cloudSaveTimer);
 cloudSaveTimer=setTimeout(()=>{if(!SIASH_CLOUD.syncing&&!SIASH_CLOUD.conflict)scheduleCloudSave({retry:true})},450);
}
async function showCloudConflictPanel(){
 const panel=document.getElementById("cloud-conflict-panel");
 if(!panel)return;
 const localEl=document.getElementById("cloud-conflict-local");
 const remoteEl=document.getElementById("cloud-conflict-remote");
 const msg=document.getElementById("cloud-conflict-message");
 const refresh=document.getElementById("cloud-conflict-refresh");
 const exportBtn=document.getElementById("cloud-conflict-export");
 const discardBtn=document.getElementById("cloud-conflict-discard");
 if(exportBtn)exportBtn.onclick=exportCloudPendingDraft;
 if(discardBtn)discardBtn.onclick=discardCloudPendingDraft;
 const close=document.getElementById("cloud-conflict-close");
 const confirm=document.getElementById("cloud-conflict-confirm");
 const resolutions=document.getElementById("cloud-conflict-resolutions");
 panel.hidden=false;
 if(close)close.onclick=()=>{panel.hidden=true};
 let proposal=null,remoteRevision=null,localGeneration=null,remoteState=null;
 async function loadRemote(){
  proposal=null;if(confirm)confirm.disabled=true;
  if(resolutions)resolutions.replaceChildren();
  const pending=cloudPending(),local=pending?.state||S;
  localGeneration=SIASH_CLOUD.editGeneration;
  if(localEl)localEl.textContent=JSON.stringify(local,null,2);
  if(remoteEl)remoteEl.textContent="Consultando servidor...";
  try{
   const remote=await cloudJson("/api/state");
   if(!remote.exists||!remote.payload?.state||!Number.isSafeInteger(remote.revision)||remote.revision<1)throw Error("Estado ou revisão inválidos");
   remoteRevision=remote.revision;remoteState=remote.payload.state;
   if(remoteEl)remoteEl.textContent=JSON.stringify(remoteState,null,2);
   if(!cloudBaseSnapshot){
    if(msg)msg.textContent="Base original indisponível. Conciliação automática bloqueada; rascunho protegido.";
    return;
   }
   proposal=cloudThreeWayMerge(cloudBaseSnapshot,local,remoteState);
   if(!resolutions||!confirm){if(msg)msg.textContent="Interface de resolução indisponível. Rascunho preservado.";return}
   const choices=new Map();
   function setReady(){
    confirm.disabled=proposal.conflicts.some(c=>!choices.has(c.path))||SIASH_CLOUD.editGeneration!==localGeneration;
   }
   for(const c of proposal.conflicts){
    const wrap=document.createElement("div");
    const title=document.createElement("p");title.textContent="Conflito no campo: "+c.path;wrap.appendChild(title);
    const select=document.createElement("select");
    const opts=[["","Selecione uma decisão"],["server","Manter versão do servidor"],["local","Aplicar minha alteração"]];
    for(const [value,label] of opts){const o=document.createElement("option");o.value=value;o.textContent=label;select.appendChild(o)}
    select.onchange=()=>{if(select.value)choices.set(c.path,select.value);else choices.delete(c.path);setReady()};
    wrap.appendChild(select);resolutions.appendChild(wrap);
   }
   if(msg)msg.textContent=proposal.conflicts.length?"Existem "+proposal.conflicts.length+" divergências. Escolha cada resolução antes de salvar.":"Alterações independentes identificadas. Confira as duas versões antes de confirmar.";
   setReady();
   confirm.onclick=async()=>{
    if(!proposal||SIASH_CLOUD.editGeneration!==localGeneration||confirm.disabled)return;
    confirm.disabled=true;
    // Aplicar escolhas exclusivamente sobre a proposta calculada; não alterar S até commit confirmado.
    const merged=JSON.parse(JSON.stringify(proposal.state));
    for(const c of proposal.conflicts){
     const selected=choices.get(c.path);
     if(!selected){if(msg)msg.textContent="Há conflitos sem decisão.";return}
     const tokens=c.path.match(/[^.\[\]]+/g)||[];
     let target=merged;
     for(let i=0;i<tokens.length-1;i++){
      const key=tokens[i];
      if(key==="beds"||key==="picc"||key==="pipa"){target=target[key];continue}
      if(Array.isArray(target)&&i>0&&["beds","picc","pipa"].includes(tokens[i-1]))target=target.find(x=>tokens[i-1]==="beds"?Number(x.n)===Number(key):x.id===key);
      else target=target[key];
      if(target===undefined||target===null)throw Error("Caminho de conciliação inválido");
     }
     const key=tokens[tokens.length-1],value=selected==="local"?c.local:c.server;
     if(tokens.length===0){if(msg)msg.textContent="Conflito global requer revisão técnica.";return}
     if(Array.isArray(target)&&["beds","picc","pipa"].includes(tokens[tokens.length-2])){
      const idx=target.findIndex(x=>tokens[tokens.length-2]==="beds"?Number(x.n)===Number(key):x.id===key);
      if(idx<0){if(msg)msg.textContent="Registro removido; revisão técnica necessária.";return}
      target[idx]=value;
     }else if(value===undefined)delete target[key];
     else target[key]=value;
    }
    try{
     const response=await cloudJson("/api/state",{method:"PUT",body:JSON.stringify({payload:{state:merged,security:securityState(),schema:"siash-0.14.19",savedAt:new Date().toISOString()},base_revision:remoteRevision})});
     if(SIASH_CLOUD.editGeneration!==localGeneration){preserveCloudDraft("merge-concurrent-edit");SIASH_CLOUD.conflict=true;updateCloudBadge("Nova edição durante conciliação · rascunho protegido",true);return}
     S=merged;SIASH_CLOUD.revision=response.revision;cloudSetBase(merged);
     SIASH_CLOUD.conflict=false;clearCloudDraft();localStorage.setItem(STORE,JSON.stringify(S));
     normalize();renderAll();panel.hidden=true;updateCloudBadge("Conciliação salva");
    }catch(e){
     preserveCloudDraft("merge-rejected");SIASH_CLOUD.conflict=true;
     if(msg)msg.textContent="Conciliação não confirmada: "+e.message+". Rascunho preservado; consulte novamente o servidor.";
     updateCloudBadge("Conciliação não confirmada",true);
    }
   };
  }catch(e){
   if(remoteEl)remoteEl.textContent="Consulta indisponível: "+e.message;
   if(msg)msg.textContent="Sem conexão ou revisão válida. Rascunho preservado; reenvio bloqueado.";
  }
 }
 if(refresh)refresh.onclick=loadRemote;
 await loadRemote();
}
function exportCloudPendingDraft(){
 const pending=cloudPending();if(!pending){alert("Nenhum rascunho pendente.");return false}
 const blob=new Blob([JSON.stringify(pending,null,2)],{type:"application/json"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="siash-rascunho-pendente-"+new Date().toISOString().slice(0,10)+".json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return true;
}
function discardCloudPendingDraft(){
 const pending=cloudPending();if(!pending)return;
 if(pending.user&&pending.user!==SESSION.user){alert("Rascunho de outro usuário: descarte bloqueado.");return}
 if(!confirm("ATENÇÃO: descartar este rascunho local não sincronizado? Faça antes uma cópia de segurança. Esta ação NÃO altera dados do servidor."))return;
 if(!confirm("Confirma definitivamente o descarte? O conteúdo local pendente poderá ser perdido."))return;
 // Never replace the working state with an unverified remote snapshot.
 clearCloudDraft();SIASH_CLOUD.conflict=true;updateCloudBadge("Rascunho descartado · recarregue o estado remoto antes de editar",true);
 const panel=document.getElementById("cloud-conflict-panel");if(panel)panel.hidden=true;
}
function updateCloudBadge(text,bad=false){
 const el=document.getElementById("cloud-status");if(!el)return;el.textContent="Cloud: "+text;el.classList.toggle("cloud-bad",!!bad);if(document.getElementById("bed-sync-status"))renderBedReconciliation();const piccSync=document.getElementById("picc-sync-status");if(piccSync)piccSync.textContent=SIASH_CLOUD.conflict?"Conflito HTTP 409 / 422 · rascunho local preservado":SIASH_CLOUD.syncing?"Sincronizando":cloudPending()?"Rascunho local · aguardando PostgreSQL":SIASH_CLOUD.lastSync?"Salvo no PostgreSQL":"Rascunho local";
}
async function uploadDocCloud(key,file){
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token||!file)return;
 const res=await fetch("/api/doc/"+encodeURIComponent(key),{method:"PUT",headers:cloudHeaders({"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name||key)}),body:file});
 if(!res.ok)throw new Error(res.status===422?"Arquivo imutável: crie nova versão.":"Falha ao sincronizar documento");
}
async function getDocCloud(key){
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return null;
 const res=await fetch("/api/doc/"+encodeURIComponent(key),{headers:cloudHeaders()});
 if(res.status===404)return null;if(!res.ok)throw new Error("Falha ao buscar documento no banco central");
 return await res.blob();
}



function isLegacyWordName(name=""){return /\.doc$/i.test(String(name||"").trim())&&!/\.docx$/i.test(String(name||"").trim())}
async function blobToBase64Payload(blob){const buf=await blob.arrayBuffer(),bytes=new Uint8Array(buf);let bin="";for(let o=0;o<bytes.length;o+=0x8000)bin+=String.fromCharCode(...bytes.subarray(o,o+0x8000));return btoa(bin)}
async function convertLegacyWordBlob(blob,fileName){
 if(!blob||!isLegacyWordName(fileName))return null;
 const data=await cloudJson("/api/docs/convert-legacy-word",{method:"POST",body:JSON.stringify({file_name:fileName,file_base64:await blobToBase64Payload(blob)})});
 if(!data?.ok||!data.file_base64||!data.file_name)throw new Error("O servidor não confirmou a conversão segura do .doc legado.");
 const out=Uint8Array.from(atob(data.file_base64),c=>c.charCodeAt(0));return new File([out],data.file_name,{type:data.mime_type||"application/vnd.openxmlformats-officedocument.wordprocessingml.document"})
}
async function ensureVersionWordIsDocx(d,v,{silent=false}={}){
 if(!d||!v)return {converted:false,reason:"version-missing"};
 const name=String(v.wordName||v.wordPath||"");if(!isLegacyWordName(name))return {converted:false,reason:"already-docx-or-not-word"};
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)throw new Error("A conversão automática de Word .doc exige a SIASH Cloud autenticada.");
 let blob=null;if(v.wordKey)blob=await getDocBlob(v.wordKey);else if(v.wordPath){const r=await fetch(v.wordPath);if(r.ok)blob=await r.blob()}
 if(!blob)throw new Error(`Word legado não localizado para ${d.code}; o vínculo original foi preservado.`);
 const converted=await convertLegacyWordBlob(blob,v.wordName||pathBasenameCompat(v.wordPath)||`${d.code}.doc`);
 const newKey=`${d.id}|${v.revision}|word|docx-migrated-${Date.now()}`;await putDocBlob(newKey,converted);
 const oldName=v.wordName||pathBasenameCompat(v.wordPath)||"arquivo.doc";
 v.legacyDocOriginalName=oldName;v.legacyDocOriginalKey=v.wordKey||"";v.wordKey=newKey;v.wordName=converted.name;v.convertedFromLegacyDoc=true;v.legacyDocConvertedAt=new Date().toISOString();v.legacyDocConvertedBy=SESSION.user||"SIASH";
 auditAdmin(`SIASH Docs: ${d.code} revisão ${v.revision} teve o Word legado ${oldName} convertido para ${converted.name}, sem criar revisão ou alterar vigência.`);
 if(!silent)showToast(`Word antigo convertido para .docx · ${d.code}`,2200);
 return {converted:true,oldName,newName:converted.name};
}
function pathBasenameCompat(p=""){return String(p||"").split(/[\\/]/).pop()||""}
let LEGACY_DOC_MIGRATION_RUNNING=false;
async function migrateLegacyWordDocsIfNeeded(){
 if(LEGACY_DOC_MIGRATION_RUNNING||!isOwner()||!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return;
 const targets=[];(S.docs||[]).forEach(d=>(d.versions||[]).forEach(v=>{if(isLegacyWordName(v.wordName||v.wordPath||""))targets.push({d,v})}));if(!targets.length)return;
 LEGACY_DOC_MIGRATION_RUNNING=true;updateCloudBadge(`Convertendo ${targets.length} Word .doc…`);
 let ok=0,failed=[];
 try{for(const x of targets){try{const r=await ensureVersionWordIsDocx(x.d,x.v,{silent:true});if(r.converted)ok++}catch(e){console.error("Falha na migração .doc",x.d?.code,e);failed.push(`${x.d?.code||"documento"}: ${e.message}`)}}
   if(ok){save();renderDocs();}
   updateCloudBadge(failed.length?`Sincronizado · ${ok} .doc convertido(s), ${failed.length} pendente(s)`:"Sincronizado");
   if(ok||failed.length)alert(`Migração de Word antigo concluída.\n\nConvertidos para .docx: ${ok}\nPendentes: ${failed.length}${failed.length?"\n\n"+failed.slice(0,5).join("\n"):""}\n\nNenhuma revisão, vigência ou aprovação foi alterada.`)
 }finally{LEGACY_DOC_MIGRATION_RUNNING=false}
}

async function exportLocalBackup(){
 try{
   const backup={schema:"siash-backup-0.11.0",createdAt:new Date().toISOString(),state:S,security:securityState(),documents:[]};
   if(window.indexedDB){
     const db=await docsDb();
     const rows=await new Promise((resolve,reject)=>{const tx=db.transaction(DOCS_DB_STORE,"readonly"),req=tx.objectStore(DOCS_DB_STORE).getAllKeys();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)});
     db.close();
     for(const key of rows){const blob=await getDocBlob(key);if(blob){const buf=await blob.arrayBuffer();let bin="";new Uint8Array(buf).forEach(b=>bin+=String.fromCharCode(b));backup.documents.push({key,type:blob.type||"application/octet-stream",data:btoa(bin)})}}
   }
   const blob=new Blob([JSON.stringify(backup)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`SIASH_BACKUP_${todayISO()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);
   showToast("Backup local exportado",1600)
 }catch(e){alert("Não foi possível exportar o backup: "+e.message)}
}
let PENDING_BACKUP=null;
function normalizeBackupObject(data){
 if(data?.state)return data;
 // Backup legado exportado diretamente do localStorage da v0.10.10.
 if(data&&typeof data==="object"&&data[STORE]){
   const state=typeof data[STORE]==="string"?JSON.parse(data[STORE]):data[STORE];
   const security=data[SECURITY_STORE]?(typeof data[SECURITY_STORE]==="string"?JSON.parse(data[SECURITY_STORE]):data[SECURITY_STORE]):null;
   return {schema:"siash-legacy-localstorage-v0.10.10",createdAt:new Date().toISOString(),state,security,documents:[],legacy:true};
 }
 throw new Error("Backup SIASH inválido ou incompatível.");
}
async function applyBackupData(data,toCloud=false){
 data=normalizeBackupObject(data);S=data.state;if(data.security){const safeSec={...data.security};delete safeSec.ownerHash;delete safeSec.ownerUser;const current=securityState()||{};setSecurityState({...safeSec,ownerHash:current.ownerHash,ownerUser:current.ownerUser})}normalize();localStorage.setItem(STORE,JSON.stringify(S));
 for(const d of data.documents||[]){const bytes=Uint8Array.from(atob(d.data),c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:d.type||"application/octet-stream"});await putDocBlob(d.key,blob)}
 if(toCloud&&SIASH_CLOUD.enabled&&SIASH_CLOUD.token){await cloudJson("/api/state",{method:"PUT",body:JSON.stringify({payload:cloudPayload(),base_revision:SIASH_CLOUD.revision,reason:"Migração de backup autorizada"})});updateCloudBadge("Backup migrado para Cloud")}
 renderAll();showToast(toCloud?"Backup migrado para Cloud":"Backup preparado",1800);return data
}
async function importBackupFile(file,toCloud=false){
 const data=normalizeBackupObject(JSON.parse(await file.text()));
 if(SIASH_CLOUD.enabled&&!SIASH_CLOUD.token){PENDING_BACKUP=data;showToast("Backup conferido e preparado · faça login para migrar",2200);alert(`Backup reconhecido${data.legacy?" (v0.10.10)":""}. Nenhum dado Cloud foi alterado. Agora faça login como Administrador Proprietário; a SIASH pedirá confirmação antes da migração.`);return}
 return applyBackupData(data,toCloud)
}
async function applyPendingBackupAfterLogin(){
 if(!PENDING_BACKUP||!isOwner())return;const data=PENDING_BACKUP;PENDING_BACKUP=null;
 if(!confirm("Backup preparado para migração. A SIASH criará automaticamente um snapshot do estado Cloud atual antes de importar. Deseja continuar?"))return;
 await applyBackupData(data,true);alert("Migração do estado concluída. Agora vamos conferir os documentos Word armazenados no navegador antigo antes de considerar a migração encerrada.")
}

async function sha256(text){const data=new TextEncoder().encode(text);const hash=await crypto.subtle.digest("SHA-256",data);return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("")}
function securityState(){try{return JSON.parse(localStorage.getItem(SECURITY_STORE)||"null")}catch(e){return null}}
function setSecurityState(x){localStorage.setItem(SECURITY_STORE,JSON.stringify(x));if(typeof scheduleCloudSave==="function")scheduleCloudSave()}
function isOwner(){return SESSION.authenticated&&SESSION.role==="owner"}
function canReviewLateCensus(){return SESSION.authenticated&&["owner","clinical_supervisor"].includes(SESSION.role)}
function docAccessState(){const sec=securityState()||{};return sec.docAccess||{}}
function currentDocAccess(){if(isOwner())return {sector:"*",level:"owner"};return docAccessState()[SESSION.user]||{sector:"UTIN",level:"reader"}}
function docLevelRank(level){return {reader:1,editor:2,validator:3,owner:4}[level]||0}
function canDocEdit(doc){const a=currentDocAccess();return isOwner()||(docLevelRank(a.level)>=2&&(a.sector==="*"||!doc||a.sector===doc.sector))}
function canDocValidate(doc){const a=currentDocAccess();return isOwner()||(docLevelRank(a.level)>=3&&(a.sector==="*"||!doc||a.sector===doc.sector))}

function auditAdmin(action){if(!isOwner())return;const sec=securityState()||{};sec.audit=sec.audit||[];sec.audit.unshift({when:nowBR(),user:SESSION.user,action});sec.audit=sec.audit.slice(0,100);setSecurityState(sec)}
function requireOwner(action="esta alteração estrutural"){if(isOwner())return true;alert(`Acesso bloqueado. Somente o Administrador Proprietário pode executar ${action}.`);return false}
function showToast(message="Dados salvos",duration=1000){let toast=document.getElementById("siash-toast");if(!toast){toast=document.createElement("div");toast.id="siash-toast";toast.className="siash-toast";toast.setAttribute("role","status");toast.setAttribute("aria-live","polite");document.body.appendChild(toast)}clearTimeout(showToast._hideTimer);clearTimeout(showToast._removeTimer);toast.textContent=message;toast.classList.add("show");showToast._hideTimer=setTimeout(()=>{toast.classList.remove("show")},duration);showToast._removeTimer=setTimeout(()=>{toast.textContent=""},duration+250)}
function applyPermissions(){
 const owner=isOwner(),a=currentDocAccess(),canEdit=owner||docLevelRank(a.level)>=2;
 document.querySelectorAll(".owner-only").forEach(el=>el.classList.toggle("hidden",!owner));
 document.querySelectorAll(".doc-editor-only").forEach(el=>el.classList.toggle("hidden",!canEdit));
 if(!canEdit){if($("doc-new-panel"))$("doc-new-panel").classList.add("hidden");if($("doc-revision-panel"))$("doc-revision-panel").classList.add("hidden")}
 if($("logged-role"))$("logged-role").textContent=owner?"Administrador Proprietário":SESSION.role==="clinical_supervisor"?"Supervisor Clínico":"Usuário Operacional";
 if(owner&&$("admin-owner-name"))$("admin-owner-name").textContent=SESSION.user||"Proprietário";
 if($("doc-access-badge"))$("doc-access-badge").textContent=owner?"Super Admin · todos os setores":`${a.sector} · ${a.level==="validator"?"Validador":a.level==="editor"?"Editor/Revisor":"Leitor"}`;
}
function validStrongPassword(password){return typeof password==="string"&&password.length>=10&&password.length<=128&&/[!@#$%^&*._-]/.test(password)}
function initRememberedLogin(){const el=$("login-user");if(el&&!el.value)el.value=rememberedLogin()||"leomg29"}
function initSecurityUI(){initRememberedLogin();
 if(SIASH_CLOUD.enabled){
   $("owner-setup").classList.add("hidden");$("normal-login").classList.remove("hidden");
   cloudHealth().then(h=>{if(h.ok&&!h.configured){$("owner-setup").classList.remove("hidden");$("normal-login").classList.add("hidden");updateCloudBadge("Configuração inicial")}else if(h.ok)updateCloudBadge("Servidor disponível");else updateCloudBadge("Servidor indisponível",true)});
   return;
 }
 const sec=securityState();$("owner-setup").classList.toggle("hidden",!!(sec&&sec.ownerHash));$("normal-login").classList.toggle("hidden",!(sec&&sec.ownerHash));
}

const CHECKS=["Receber plantão da enfermagem","Participar da passagem multiprofissional","Confeccionar/validar lista de dieta","Conferir checklist de urgência e materiais","Controlar temperatura de equipamentos conforme rotina","Realizar conferência de materiais","Realizar SAE / prescrição de enfermagem","Realizar evolução/avaliação do enfermeiro","Acompanhar checklist de boas práticas quando aplicável","Checar incubadora/berço e condições do leito","Registrar intercorrências e pendências para continuidade","Preparar entrega do plantão"];
const STEPS=["Receber plantão","Passagem multiprofissional","Checklist do plantão","SAE / evolução","Cuidados e intercorrências","Pendências","Entrega do plantão"];
const pad=n=>String(n).padStart(2,"0");
const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const monthOf=d=>d.slice(0,7);
const fmt=(n,d=1)=>Number(n||0).toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d});
const safe=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
function blankState(){return{
 settings:{unit:"UTI Neonatal",beds:10,intensive:8,intermediate:2,target:85,hospital:"Fundação Hospitalar Dr. Moisés Magalhães Freire",aiProvider:"auto"},
 daily:[],beds:Array.from({length:10},(_,i)=>({n:i+1,isolation:i>=8,status:"Livre",profile:"Intensivo",rn:"",note:""})),
 bedMoves:[],profileHistory:[],movements:[],checklist:CHECKS.map(x=>({text:x,status:"Pendente"})),events:[],care:{},picc:[],pipa:[],pending:[],thermalEvents:[],docs:[],huddle:[],rh:[],shiftStarted:new Date().toISOString()
}}
let S=JSON.parse(localStorage.getItem(STORE)||"null")||blankState();
function normalize(){if(!S.settings)S.settings=blankState().settings;if(!S.daily)S.daily=[];if(!S.beds||S.beds.length!==10)S.beds=blankState().beds;
S.beds.forEach((b,i)=>{if(typeof b.isolation==="undefined")b.isolation=i>=8;if(!b.profile)b.profile=b.type||"Intensivo";delete b.type});
if(!S.bedMoves)S.bedMoves=[];if(!S.profileHistory)S.profileHistory=[];if(!S.movements)S.movements=[];if(!S.checklist)S.checklist=blankState().checklist;if(!S.events)S.events=[];if(!S.care)S.care={};if(!S.picc)S.picc=[];if(!S.piccEvents)S.piccEvents=[];if(!S.pipa)S.pipa=[];if(!S.pending)S.pending=[];if(!S.thermalEvents)S.thermalEvents=[];if(!S.docs)S.docs=[];normalizeDocs();if(!S.huddle)S.huddle=[];if(!S.rh)S.rh=[];if(!S.shiftHistory)S.shiftHistory=[];if(!S.checklistHistory)S.checklistHistory=[];if(!S.careHistory)S.careHistory=[];if(!S.shiftEvents)S.shiftEvents=[]}
normalize();localStorage.setItem(STORE,JSON.stringify(S));
function save(){localStorage.setItem(STORE,JSON.stringify(S));scheduleCloudSave();renderAll()}
function shiftUid(){return crypto.randomUUID()}
function shiftAudit(kind,data){const key=kind==="checklist"?"checklistHistory":kind==="care"?"careHistory":"shiftEvents";S[key].push({shiftId:S.shiftId||"legado",...data})}
function shiftAlerts(){const pending=S.checklist.filter(x=>x.status==="Pendente"||x.status==="Não realizado").length;const critical=sharedPending.filter(x=>x.priority==="Crítica"&&x.status!=="Concluída").length;return {pending,critical}}
function showShiftHistory(){const rows=S.shiftHistory.map(x=>`<div class="event"><strong>${safe(x.shiftId)} · ${safe(x.closedAt||"Aguardando carimbo do servidor")}</strong> · ${safe(x.recordedBy||"Legado")}<br>Eventos: ${(x.events||[]).map(e=>safe(e.text)).join("; ")||"Sem eventos"}<br>Checklist: ${(x.checklist||[]).map(c=>safe(c.text)+": "+safe(c.status)).join("; ")||"Sem registros"}<br>SAE operacional: ${Object.keys(x.care||{}).map(b=>"Leito "+safe(b)+" — "+safe(x.care[b]?.episodeRn||"Legado")).join("; ")||"Sem registros"}</div>`).join("");$("shift-history").innerHTML=rows||"<p class=muted>Sem plantões encerrados.</p>"}
function currentMonth(){return monthOf(todayISO())}
function pipaMunicipalityKey(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}
function pipaPossibleDuplicates(candidate){return S.pipa.filter(x=>!x.cancelledAt&&(x.date||"")===candidate.date&&(x.date?monthOf(x.date):x.month)===candidate.month&&pipaMunicipalityKey(x.city)===pipaMunicipalityKey(candidate.city)&&Number(x.qty)===Number(candidate.qty))}
function pipaCountOn(date){return S.pipa.filter(x=>!x.cancelledAt&&x.date===date).reduce((n,x)=>n+(Number(x.qty)||0),0)}
function pipaDailyAudit(date){
 const daily=S.daily.find(x=>x.date===date);
 const dated=pipaCountOn(date),legacy=daily?Number(daily.pipa)||0:0;
 return {dated,legacy,hasDated:S.pipa.some(x=>!x.cancelledAt&&x.date===date),requiresReview:dated>0&&legacy>0};
}
function pipaReconciliationSummary(month){
 const dated=S.pipa.filter(x=>!x.cancelledAt&&x.date&&monthOf(x.date)===month).reduce((n,x)=>n+(Number(x.qty)||0),0);
 const monthlyOnly=S.pipa.filter(x=>!x.cancelledAt&&!x.date&&x.month===month).reduce((n,x)=>n+(Number(x.qty)||0),0);
 const legacyDaily=S.daily.filter(x=>monthOf(x.date)===month).reduce((n,x)=>n+(Number(x.pipa)||0),0);
 const overlapDays=S.daily.filter(x=>monthOf(x.date)===month&&pipaDailyAudit(x.date).requiresReview).length;
 return {dated,monthlyOnly,legacyDaily,overlapDays,needsReview:monthlyOnly>0||overlapDays>0};
}
function pipaMonthTotal(m){return S.pipa.filter(x=>!x.cancelledAt&&(x.date?monthOf(x.date):x.month)===m).reduce((total,row)=>total+(Number(row.qty)||0),0)}
function thermalCount(date,type){return S.thermalEvents.filter(x=>x.date===date&&x.type===type).length}
function thermalMonthCount(m,type){return S.thermalEvents.filter(x=>monthOf(x.date)===m&&x.type===type).length}
function canguruSourceOverlap(m){
 return S.daily.filter(r=>monthOf(r.date)===m&&Number(r.canguru)>0&&Number(r.altaCanguru)>0).map(r=>({date:r.date,legacy:Number(r.canguru),current:Number(r.altaCanguru)}));
}
function canguruConsistencyAudit(m){
 return S.daily.filter(r=>monthOf(r.date)===m).filter(r=>{const total=(Number(r.canguru)||0)+(Number(r.altaCanguru)||0);return total>0&&total>(Number(r.altas)||0)}).map(r=>({date:r.date,altas:Number(r.altas)||0,canguru:(Number(r.canguru)||0)+(Number(r.altaCanguru)||0)}));
}
// Advisory only: never mutate daily records or infer missing census values.
function auditDailyBalance(records,month){
 const rows=(Array.isArray(records)?records:[]).filter(r=>r&&typeof r.date==="string");
 const counts=new Map(),warnings=[];
 for(const r of rows)counts.set(r.date,(counts.get(r.date)||0)+1);
 const unique=[...new Map(rows.map(r=>[r.date,r])).entries()].sort(([a],[b])=>a.localeCompare(b));
 const validDate=d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;const x=new Date(d+"T00:00:00Z");return !Number.isNaN(x.getTime())&&x.toISOString().slice(0,10)===d};
 const count=r=>Number.isSafeInteger(r)&&r>=0?r:(typeof r==="string"&&/^(0|[1-9]\d*)$/.test(r)&&Number.isSafeInteger(Number(r))?Number(r):null);
 for(let i=0;i<unique.length;i++){
  const [date,r]=unique[i];
  if(!validDate(date)){warnings.push({date,type:"invalid-date"});continue}
  if(counts.get(date)>1){warnings.push({date,type:"duplicate",occurrences:counts.get(date)});continue}
  if(i===0)continue;
  const [prior,previous]=unique[i-1];
  if(!validDate(prior)||counts.get(prior)>1){warnings.push({date,type:"not-comparable"});continue}
  const days=(Date.parse(date+"T00:00:00Z")-Date.parse(prior+"T00:00:00Z"))/86400000;
  if(days!==1){warnings.push({date,type:"gap",prior});continue}
  const nums=[count(previous.internados),count(r.internados),count(r.admissoes),count(r.altas),count(r.transferencias),count(r.obitos)];
  if(nums.some(n=>n===null)){warnings.push({date,type:"invalid-count"});continue}
  const expected=nums[0]+nums[2]-nums[3]-nums[4]-nums[5];
  if(!Number.isSafeInteger(expected)||nums[1]!==expected)warnings.push({date,type:"balance",expected,actual:nums[1],difference:nums[1]-expected});
 }
 return warnings.filter(w=>w.date.slice(0,7)===month);
}
function monthStats(m){
 const rows=S.daily.filter(r=>monthOf(r.date)===m).sort((a,b)=>a.date.localeCompare(b.date));
 const sum=k=>rows.reduce((a,b)=>a+(+b[k]||0),0);
 const dateCounts=new Map();for(const row of rows)dateCounts.set(row.date,(dateCounts.get(row.date)||0)+1);
 const censusRows=rows.filter(row=>dateCounts.get(row.date)===1&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&Number.isFinite(Date.parse(row.date+"T00:00:00Z"))&&new Date(row.date+"T00:00:00Z").toISOString().slice(0,10)===row.date&&(typeof row.internados==="number"||typeof row.internados==="string"&&/^(0|[1-9]|10)$/.test(row.internados))&&Number.isSafeInteger(Number(row.internados))&&Number(row.internados)>=0&&Number(row.internados)<=10);
 const pd=censusRows.reduce((total,row)=>total+Number(row.internados),0),days=censusRows.length,ld=(S.settings.beds||10)*days,outs=sum("altas")+sum("transferencias")+sum("obitos");
 const latest=rows.length?rows[rows.length-1]:null;
 return{rows,pd,days,ld,outs,occ:ld?pd/ld*100:0,los:outs?pd/outs:0,adm:sum("admissoes"),altas:sum("altas"),transf:sum("transferencias"),deaths:sum("obitos"),pipa:pipaMonthTotal(m),canguru:sum("canguru")+sum("altaCanguru"),altaPediatria:sum("altaPediatria"),altaCanguru:sum("altaCanguru"),picc:S.picc.filter(x=>monthOf(piccInsertDate(x))===m).length,piccDays:piccDaysInMonth(m),piccActive:S.picc.filter(x=>(!x.status||x.status==="Ativo")).length,piccRemoved:S.picc.filter(x=>x.status==="Retirado"&&x.removalDate&&monthOf(x.removalDate)===m).length,pezinho:sum("pezinho"),vmDays:sum("vm"),vmCurrent:latest?(+latest.vm||0):0,intub:sum("intub"),extubProg:sum("extubProg"),extub:sum("extub"),lpp:sum("lpp"),hypothermia:thermalMonthCount(m,"Hipotermia"),hyperthermia:thermalMonthCount(m,"Hipertermia")}
}
function monthCoverage(m,days){const parts=String(m||"").split("-").map(Number);if(parts.length!==2||!parts[0]||parts[1]<1||parts[1]>12)return null;const calendarDays=new Date(parts[0],parts[1],0).getDate();return{registered:days,calendarDays,incomplete:days<calendarDays};}
function allMonths(){const months=[...S.daily.map(r=>monthOf(r.date)),...S.pipa.filter(r=>!r.cancelledAt).map(r=>r.date?monthOf(r.date):r.month),...S.picc.map(x=>monthOf(piccInsertDate(x))),...S.picc.filter(x=>x.removalDate).map(x=>monthOf(x.removalDate)),currentMonth()];return [...new Set(months.filter(Boolean))].sort()}
function dateBR(s){return s?s.split("-").reverse().join("/"):"—"}
function nowBR(){return new Date().toLocaleString("pt-BR")}
function parseISODate(s){if(!s)return null;const p=s.split("-").map(Number);if(p.length!==3||p.some(Number.isNaN))return null;return new Date(Date.UTC(p[0],p[1]-1,p[2]))}
function isoFromLegacyWhen(s){const m=String(s||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(!m)return null;const date=`${m[3]}-${pad(m[2])}-${pad(m[1])}`;return new Date(Date.UTC(+m[3],+m[2]-1,+m[1])).toISOString().slice(0,10)===date?date:null}
function piccInsertDate(x){return x.insertDate||isoFromLegacyWhen(x.when)}
function piccDaysBetween(start,end){const a=parseISODate(start),b=parseISODate(end);if(!a||!b||b<a)return 0;return Math.floor((b-a)/86400000)+1}
function piccDays(x,end=todayISO()){const last=x.status==="Retirado"&&x.removalDate?x.removalDate:end;return piccInsertDate(x)?piccDaysBetween(piccInsertDate(x),last):null}
function piccInsertedOn(date){return S.picc.filter(x=>piccInsertDate(x)===date).length}
function piccDaysInMonth(m){const y=+m.slice(0,4),mo=+m.slice(5,7),monthStart=`${m}-01`,monthEnd=`${m}-${pad(new Date(y,mo,0).getDate())}`,today=todayISO();let total=0;S.picc.forEach(x=>{const start=piccInsertDate(x);if(!start)return;const stop=x.status==="Retirado"&&x.removalDate?x.removalDate:(today<monthEnd?today:monthEnd);const a=start>monthStart?start:monthStart;const b=stop<monthEnd?stop:monthEnd;if(b>=a)total+=piccDaysBetween(a,b)});return total}
function populateBedSelects(){document.querySelectorAll(".bed-select").forEach(sel=>{const current=sel.value;let first=sel.id==="pending-bed"?'<option value="Geral / Setor">Geral / Setor</option>':'<option value="">Selecione</option>';sel.innerHTML=first+S.beds.map(b=>`<option value="${b.n}">Leito ${pad(b.n)} — ${b.profile}${b.isolation?" — Isolamento":""} — ${b.status}</option>`).join("");if([...sel.options].some(o=>o.value===current))sel.value=current})}
function renderClock(){const d=new Date();$("clock-date").textContent=d.toLocaleDateString("pt-BR");$("clock-time").textContent=d.toLocaleTimeString("pt-BR");const h=d.getHours();$("shift-label").textContent=h>=7&&h<19?"Diurno 07h–19h":"Noturno 19h–07h"}
function renderDashboard(){const m=currentMonth(),c=monthStats(m);$("m-pacientedias").textContent=c.pd;$("m-ocupacao").textContent=fmt(c.occ,1)+"%";$("m-permanencia").textContent=c.outs?fmt(c.los,1)+" d":"—";$("m-admissoes").textContent=c.adm;$("m-transferencias").textContent=c.transf;$("m-pipa").textContent=pipaMonthTotal(m);$("m-leitosdia").textContent=c.ld;$("m-diaslancados").textContent=c.days;const totalDays=new Date(+m.slice(0,4),+m.slice(5,7),0).getDate();$("m-diaspendentes").textContent=Math.max(0,totalDays-c.days);$("m-pendencias").textContent=pendingLoaded?sharedPending.filter(x=>x.status!=="Concluída").length:S.pending.filter(x=>!x.done).length;
 const recent=[...c.rows].sort((a,b)=>a.date.localeCompare(b.date)).slice(-10);$("occupancy-bars").innerHTML=recent.length?recent.map(r=>{const p=Math.min(100,(r.internados/(S.settings.beds||10))*100);return`<div class="bar-item"><div class="bar-value">${p.toFixed(0)}%</div><div class="bar" style="height:${p}%"></div><div class="bar-label">${r.date.slice(8)}</div></div>`}).join(""):'<span class="muted">Sem lançamentos nesta competência.</span>';
 const alerts=[];if(c.days===0)alerts.push({t:"warn",x:"Ainda não há lançamento diário nesta competência."});else if(c.occ<S.settings.target)alerts.push({t:"warn",x:`Taxa de ocupação (${fmt(c.occ,1)}%) abaixo da meta configurada (${S.settings.target}%).`});else alerts.push({t:"ok",x:"Taxa de ocupação em ou acima da meta configurada."});if((pendingLoaded?sharedPending.some(x=>x.status!=="Concluída"&&x.priority==="Crítica"):S.pending.some(x=>!x.done&&x.priority==="Crítica")))alerts.push({t:"bad",x:"Existe pendência crítica aberta para continuidade."});if(S.docs.some(d=>docStatus(d).key==="expired"))alerts.push({t:"bad",x:"Há documento/POP com revisão vencida no SIASH Docs."});$("alerts").innerHTML=alerts.map(a=>`<div class="alert ${a.t}">${safe(a.x)}</div>`).join("");
 $("executive-summary").textContent=c.days?`Na competência ${m.split("-").reverse().join("/")}, foram registrados ${c.pd} pacientes-dia em ${c.days} dia(s), com taxa de ocupação de ${fmt(c.occ,1)}%. Houve ${c.adm} admissões, ${c.altas} altas, ${c.transf} transferências e ${c.deaths} óbitos. ${c.outs?`A média de permanência calculada é ${fmt(c.los,1)} dias.`:"Ainda não há saídas suficientes para média de permanência."}`:"O painel será atualizado automaticamente à medida que os lançamentos diários forem salvos."}
function renderShift(){showShiftHistory();const score=checkScore();$("shift-steps").innerHTML=STEPS.map((x,i)=>`<div class="check-row"><strong>${i+1}</strong><span>${x}</span></div>`).join("");$("timeline").innerHTML=S.events.length?S.events.map(e=>`<div class="event"><strong>${safe(e.when)} • ${safe(e.type)}</strong><br>${e.bed?`Leito ${safe(e.bed)} — `:""}${safe(e.text)}</div>`).join(""):'<span class="muted">Nenhum evento registrado neste plantão.</span>';$("shift-summary").innerHTML=`<div class="cards"><article class="metric-card"><span>Checklist</span><strong>${score}%</strong></article><article class="metric-card"><span>Pendências abertas</span><strong>${(pendingLoaded?sharedPending.filter(x=>x.status!=="Concluída").length:S.pending.filter(x=>!x.done).length)}</strong></article><article class="metric-card"><span>Eventos registrados</span><strong>${S.events.length}</strong></article><article class="metric-card"><span>Leitos ocupados</span><strong>${S.beds.filter(b=>b.status==="Ocupado").length}/10</strong></article></div>`}
function checkScore(){const app=S.checklist.filter(c=>c.status!=="N/A");return app.length?Math.round(app.filter(c=>c.status==="Realizado").length/app.length*100):0}
const DAILY_FIELD_MAP={internados:"d-internados",admissoes:"d-admissoes",altas:"d-altas",transferencias:"d-transferencias",obitos:"d-obitos",pipa:"d-pipa",altaCanguru:"d-alta-canguru",picc:"d-picc",pezinho:"d-pezinho",intub:"d-intub",vm:"d-vm",extubProg:"d-extub-prog",extub:"d-extub",lpp:"d-lpp",hypothermia:"d-hypothermia",hyperthermia:"d-hyperthermia"};
function validateDailyCanguruSubset(altas,altaCanguru,legacyCanguru){
 const a=Number(altas),c=Number(altaCanguru),legacy=Number(legacyCanguru)||0;
 if(!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(c)||c<0)return "Informe quantidades inteiras e não negativas para Altas e Leito Canguru.";
 if(c>a)return "Alta para Leito Canguru não pode superar o total de Altas do dia. Confira os valores antes de salvar.";
 if(c>0&&legacy>0&&c+legacy>a)return "O total de Canguru atual e histórico supera as Altas do dia. Confira os registros antes de salvar.";
 return "";
}
function syncAllDischargesToCanguru(){
 if(!$("d-altas-todas-canguru").checked)return;
 $("d-alta-canguru").value=String(Math.max(0,Number($("d-altas").value)||0));
}
function loadDailyForm(date){const r=S.daily.find(x=>x.date===date);Object.entries(DAILY_FIELD_MAP).forEach(([k,id])=>{$(id).value=k==="pipa"?pipaCountOn(date):k==="picc"?piccInsertedOn(date):k==="hypothermia"?thermalCount(date,"Hipotermia"):k==="hyperthermia"?thermalCount(date,"Hipertermia"):(k==="internados"?(r?.internados??""):(r?(+r[k]||0):0))});$("d-obs").value=r?(r.obs||""):"";$("d-altas-todas-canguru").checked=false}
function registerCensusConference(date,responsible){
 const daily=S.daily.find(r=>r.date===date);
 if(!daily)return {ok:false,reason:"Salve o lançamento diário antes da conferência."};
 if(!String(responsible||"").trim())return {ok:false,reason:"Informe o responsável pelo plantão noturno."};
 if(date>=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date()))return {ok:false,reason:"Confirme somente datas encerradas à meia-noite."};
 if(daily.censusConference)return {ok:false,reason:"Censo já confirmado. Utilize o fluxo de retificação."};
 if($("d-internados").value.trim()===""||daily.internados==null)return {ok:false,reason:"Informe explicitamente o total de internados."};
 if(Number($("d-internados").value)!==Number(daily.internados))return {ok:false,reason:"O valor exibido no formulário difere do lançamento salvo. Salve ou recarregue os dados antes de conferir."};
 const count=Number(daily.internados);
 if(!Number.isSafeInteger(count)||count<0||count>(S.settings.beds||10))return {ok:false,reason:"Confira o total de pacientes e a capacidade de leitos antes de registrar."};
 if(daily.censusConference){daily.censusConferenceHistory=[...(Array.isArray(daily.censusConferenceHistory)?daily.censusConferenceHistory:[]),daily.censusConference];}
 daily.censusConference={referenceDate:date,registeredAt:new Date().toISOString(),responsible:String(responsible).trim(),registeredBy:SESSION.user||null,count,countSource:"manual_reference_date",bedOccupancyAtRegistration:S.beds.filter(b=>b.status==="Ocupado").length};
 return {ok:true};
}
async function refreshMidnightCensusStatus(){
 const el=$("census-midnight-alert"),attention=$("census-pending-attention");
 if(!el||!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return;
 try{
  const data=await cloudJson("/api/census/window-status");
  const ref=dateBR(data.referenceDate);
  const selected=$("d-date")?.value||todayISO();
  const context=selected===data.referenceDate?"":" Selecione "+ref+" no lançamento diário para conferir.";
  const pending=data.attention==="overdue",warning=data.attention==="warning";
  if(attention){attention.classList.toggle("hidden",!pending);attention.disabled=!pending;}
  lateCensusSetStatus(data);
  if(pending){el.textContent="ATENÇÃO — Censo de "+ref+" pendente após 00h10. Lançamento atrasado permitido. Confira a ocupação da data de referência."+context;el.style.color="#b45309";}
  else if(warning){el.textContent="Censo de "+ref+": lembrete de conferência; o lançamento continuará disponível."+context;el.style.color="#b45309";}
  else if(data.attention==="closed"){el.textContent="Conferência manual de "+ref+" registrada. A confirmação histórica não comprova, por si só, presença à meia-noite.";el.style.color="";}
  else if(data.phase==="preparation"){el.textContent="Preparação do censo de "+ref+" disponível; confirmação oficial somente após 00h00.";el.style.color="";}
  else if(data.phase==="confirmation"){el.textContent="Conferência manual do censo de "+ref+" disponível.";el.style.color="";}
  else{el.textContent="Verifique o censo de "+ref+" e o estado de sincronização.";el.style.color="";}
 }catch(err){if(attention)attention.classList.add("hidden");el.textContent="Não foi possível consultar o servidor. O status do censo está indisponível; não presuma fechamento.";el.style.color="#b45309";}
}
$("census-pending-attention")?.addEventListener("click",()=>{const selected=$("d-date")?.value||todayISO();$("census-closer")?.focus();$("census-midnight-alert")?.scrollIntoView({behavior:"smooth",block:"center"});});


/* Regularização tardia: estado local do formulário é preservado durante conflitos 409. */
let LATE_CENSUS_REFERENCE=null,LATE_CENSUS_SELECTED=null,LATE_CENSUS_REQUESTS=[];
const lateText=id=>$(id)?.value??"";
function lateCensusSetStatus(data){
 const panel=$("census-late-section");
 if(!panel)return;
 const overdue=data?.attention==="overdue";
 // Atraso simples não exige regularização supervisionada; mantenha acesso a solicitações históricas.
 panel.classList.toggle("hidden",false);
 if(overdue){LATE_CENSUS_REFERENCE=data.referenceDate;const input=$("census-late-date");if(input&&!input.value)input.value=data.referenceDate;}
 if(SIASH_CLOUD.token)void lateCensusLoadRequests();
}
function lateCensusMessage(id,message){const el=$(id);if(el)el.textContent=message;}
function lateCensusConflict(id){
 lateCensusMessage(id,"Conflito HTTP 409: outro plantão atualizou o estado. Os campos foram preservados. Atualize os dados e confira antes de reenviar.");
}
function lateCensusTime(value){return value?new Date(value).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}):"—"}
function lateCensusNode(tag,value){const el=document.createElement(tag);el.textContent=String(value??"");return el}
function lateCensusRow(container,label,value){
 const p=document.createElement("p");p.append(lateCensusNode("strong",label+": "),lateCensusNode("span",value));container.append(p);
}
async function lateCensusLoadRequests(){
 if(!SIASH_CLOUD.token)return;
 try{
  const result=await cloudJson("/api/census/late-requests");
  LATE_CENSUS_REQUESTS=Array.isArray(result.requests)?result.requests:[];
  const list=$("census-late-requests");if(!list)return;list.replaceChildren();
  for(const request of LATE_CENSUS_REQUESTS){
   const card=document.createElement("article");card.style.cssText="border-top:1px solid #ccc;padding:10px 0";
   lateCensusRow(card,"Protocolo",request.protocol);
   lateCensusRow(card,"Referência",request.reference_date);
   lateCensusRow(card,"Solicitante",request.requester);
   lateCensusRow(card,"Data/hora do servidor",lateCensusTime(request.requested_at));
   lateCensusRow(card,"Contagem proposta",request.midnight_count);
   lateCensusRow(card,"Justificativa",request.justification);
   lateCensusRow(card,"Evidências",request.evidence);
   lateCensusRow(card,"Estado",request.status+" — Tardio / Regularização");
   const history=document.createElement("button");history.type="button";history.textContent="Ver trilha de auditoria";
   history.addEventListener("click",()=>lateCensusShowEvents(request.protocol));card.append(history);
   const same=String(request.requester)===String(SESSION.user);
   const canReview=canReviewLateCensus()&&!same&&request.status==="aguardando_supervisor";
   if(canReview){const btn=document.createElement("button");btn.type="button";btn.textContent="Analisar solicitação";btn.addEventListener("click",()=>{
    LATE_CENSUS_SELECTED=request;
    $("census-late-review").classList.remove("hidden");
    lateCensusMessage("census-late-review-summary",request.protocol+" — "+request.reference_date+" — "+request.requester);
    lateCensusMessage("census-late-review-status","");
   });card.append(btn);}
   if(same&&request.status==="aguardando_supervisor")lateCensusRow(card,"Dupla custódia","Autoaprovação proibida");
   list.append(card);
  }
  lateCensusMessage("census-late-panel-status",LATE_CENSUS_REQUESTS.length+" solicitação(ões) consultada(s).");
 }catch(e){lateCensusMessage("census-late-panel-status","Não foi possível consultar as solicitações: "+e.message);}
}
async function lateCensusShowEvents(protocol){
 const box=$("census-late-events");if(!box)return;
 box.replaceChildren();
 try{
  const data=await cloudJson("/api/census/late-requests/"+encodeURIComponent(protocol)+"/events");
  for(const event of data.events||[]){
   const item=document.createElement("article");item.style.cssText="border-left:3px solid #98502b;margin:8px 0;padding:8px";
   lateCensusRow(item,"Protocolo",event.protocol);
   lateCensusRow(item,"Evento",event.event_type+" — Tardio / Regularização");
   lateCensusRow(item,"Autor",event.actor);
   lateCensusRow(item,"Data/hora oficial",lateCensusTime(event.occurred_at));
   lateCensusRow(item,"Revisão",event.state_revision);
   if(event.details?.reason)lateCensusRow(item,"Justificativa",event.details.reason);
   if(event.details?.evidence)lateCensusRow(item,"Evidências",event.details.evidence);
   box.append(item);
  }
 }catch(e){box.append(lateCensusNode("p","Falha ao consultar histórico: "+e.message));}
}
async function lateCensusSubmit(event){
 event?.preventDefault?.();
 const payload={referenceDate:lateText("census-late-date"),midnightCount:Number(lateText("census-late-count")),justification:lateText("census-late-justification"),evidence:lateText("census-late-evidence"),base_revision:SIASH_CLOUD.revision};
 const submit=$("census-late-submit");if(submit)submit.disabled=true;
 try{
  const result=await cloudJson("/api/census/late-requests",{method:"POST",body:JSON.stringify(payload)});
  lateCensusMessage("census-late-form-status","Solicitação tardia enviada. Protocolo: "+result.protocol+". Aguardando supervisor independente.");
  await lateCensusLoadRequests();await lateCensusShowEvents(result.protocol);
 }catch(e){if(e.status===409)lateCensusConflict("census-late-form-status");else lateCensusMessage("census-late-form-status","Solicitação não registrada: "+e.message);}
 finally{if(submit)submit.disabled=false;}
}
async function lateCensusDecide(approved){
 const selected=LATE_CENSUS_SELECTED;
 if(!selected)return;
 if(!canReviewLateCensus()){lateCensusMessage("census-late-review-status","Permissão clínica necessária.");return;}
 if(String(selected.requester)===String(SESSION.user)){lateCensusMessage("census-late-review-status","Autoaprovação proibida.");return;}
 const reason=lateText("census-late-review-reason");
 if(reason.trim().length<15){lateCensusMessage("census-late-review-status","Informe uma justificativa com pelo menos 15 caracteres.");return;}
 try{
  const result=await cloudJson("/api/census/late-requests/"+encodeURIComponent(selected.protocol)+"/decision",{method:"POST",body:JSON.stringify({approved,reason,base_revision:SIASH_CLOUD.revision})});
  lateCensusMessage("census-late-review-status","Decisão registrada: "+result.status);
  $("census-late-review")?.classList.add("hidden");
  await lateCensusLoadRequests();await lateCensusShowEvents(selected.protocol);
 }catch(e){if(e.status===409)lateCensusConflict("census-late-review-status");else lateCensusMessage("census-late-review-status","Decisão não registrada: "+e.message);}
}
$("census-late-open")?.addEventListener("click",()=>{$("census-late-form-wrap")?.classList.remove("hidden");});
$("census-late-cancel")?.addEventListener("click",()=>{$("census-late-form-wrap")?.classList.add("hidden");});
$("census-late-form")?.addEventListener("submit",lateCensusSubmit);
$("census-late-refresh")?.addEventListener("click",lateCensusLoadRequests);
$("census-late-approve")?.addEventListener("click",()=>lateCensusDecide(true));
$("census-late-reject")?.addEventListener("click",()=>lateCensusDecide(false));
$("census-late-clinical")?.addEventListener("click",()=>lateCensusDecide(null));

function renderCensusConference(date){
 const daily=S.daily.find(r=>r.date===date);
 const occupied=(Array.isArray(S.beds)?S.beds:[]).filter(b=>b.status==="Ocupado").length;
 const count=$("census-daily-count"),beds=$("census-beds-occupied"),difference=$("census-difference"),status=$("census-status");
 if(!count||!beds||!difference||!status)return;
 beds.textContent=occupied;
 if(!daily){
   const closure=$("census-closure-status");if(closure)closure.textContent="Sem conferência registrada para esta data.";
   count.textContent="—";difference.textContent="—";
   status.textContent="Sem lançamento para "+dateBR(date)+". O mapa de leitos atual não substitui o censo fechado à meia-noite.";
   return;
 }
 const census=Number(daily.internados)||0;
 const closure=$("census-closure-status");
 if(closure){
   const record=daily.censusConference;
   const historyCount=Array.isArray(daily.censusConferenceHistory)?daily.censusConferenceHistory.length:0;
   const historyNote=historyCount?` Histórico preservado: ${historyCount} conferência(s) anterior(es).`:"";
   closure.textContent=(record&&record.count===census
     ?`Conferência registrada por ${record.responsible} em ${new Date(record.registeredAt).toLocaleString("pt-BR")} (referência ${dateBR(record.referenceDate)}; ${record.count} RN). Ocupação atual no momento do registro (não corresponde necessariamente à meia-noite): ${record.bedOccupancyAtRegistration??"não informada"}. Contagem da referência declarada manualmente pelo responsável.`
     :record?"Conferência anterior desatualizada: o censo foi alterado. Registre nova conferência.":"Sem conferência registrada para esta data.")+historyNote;
 }
 count.textContent=census;
 const delta=occupied-census;
 difference.textContent=(delta>0?"+":"")+delta;
 status.textContent=delta===0
   ?"Totais coincidem numericamente. Confirme o horário de referência antes de validar o fechamento."
   :"Divergência de "+Math.abs(delta)+" RN(s) entre o lançamento de "+dateBR(date)+" e o mapa atual. Confira admissões, altas e horário; nenhum dado foi alterado automaticamente.";
}
function renderDaily(){const date=$("d-date").value||todayISO();if(!$("d-date").value)$("d-date").value=date;const m=monthOf(date),c=monthStats(m);$("competence-label").textContent="Competência "+m.split("-").reverse().join("/");if($("d-picc-month"))$("d-picc-month").textContent=c.picc;$("d-pipa").value=pipaCountOn(date);const pipaAudit=pipaDailyAudit(date),pipaNote=$("d-pipa-audit");if(pipaNote)pipaNote.textContent=pipaAudit.legacy?`Registro diário legado: ${pipaAudit.legacy}. PIPA datado: ${pipaAudit.dated}. Valores não somados automaticamente; conferir possível duplicidade.`:"Encaminhamentos datados do PIPA. Registros antigos sem data permanecem preservados.";$("d-hypothermia").value=thermalCount(date,"Hipotermia");$("d-hyperthermia").value=thermalCount(date,"Hipertermia");renderThermalEvents(date);renderCensusConference(date);$("d-kpi-pd").textContent=c.pd;$("d-kpi-ld").textContent=c.ld;$("d-kpi-occ").textContent=fmt(c.occ,1)+"%";$("d-kpi-outs").textContent=c.outs;$("d-kpi-los").textContent=c.outs?fmt(c.los,1)+" d":"—";$("d-kpi-days").textContent=c.days;if($("d-kpi-vm-current"))$("d-kpi-vm-current").textContent=c.vmCurrent;if($("d-kpi-vm-days"))$("d-kpi-vm-days").textContent=c.vmDays;$("daily-table").innerHTML=[...c.rows].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr><td>${dateBR(r.date)}</td><td>${r.internados}</td><td>${r.admissoes}</td><td>${r.altas}</td><td>${r.transferencias}</td><td>${r.obitos}</td><td>${pipaDailyAudit(r.date).hasDated?`${pipaDailyAudit(r.date).dated} (datado)${pipaDailyAudit(r.date).legacy?` / ${pipaDailyAudit(r.date).legacy} (legado, conferir)`:""}`:`${pipaDailyAudit(r.date).legacy} (legado)`}</td><td>${(+r.altaCanguru||0)+(+r.canguru||0)}</td><td>${piccInsertedOn(r.date)}</td><td>${r.pezinho}</td><td>${+r.intub||0}</td><td>${+r.vm||0}</td><td>${+r.extubProg||0}</td><td>${+r.extub||0}</td><td><button class="ghost" onclick="deleteDaily('${r.date}')">Excluir</button></td></tr>`).join("")||'<tr><td colspan="15">Nenhum lançamento.</td></tr>'}
function renderThermalEvents(date){
 const rows=S.thermalEvents.filter(x=>x.date===date).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
 $("thermal-table").innerHTML=rows.map(x=>`<tr><td>${dateBR(x.date)}</td><td>Leito ${pad(x.bed)}</td><td>${safe(x.rn||"Sem identificador")}</td><td>${safe(x.type)}</td><td>${safe(x.note||"—")}</td><td><button class="ghost" onclick="deleteThermalEvent('${x.id}')">Excluir</button></td></tr>`).join("")||'<tr><td colspan="6">Nenhum evento térmico registrado nesta data.</td></tr>';
}
window.deleteThermalEvent=id=>{if(confirm("Excluir este evento térmico?")){S.thermalEvents=S.thermalEvents.filter(x=>x.id!==id);save()}}
window.deleteDaily=date=>{alert("Exclusão de lançamento clínico bloqueada. Preserve o registro e solicite correção auditável à coordenação.");return false;}
function bedSyncStatus(){
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return "Rascunho local";
 if(SIASH_CLOUD.conflict)return "Conflito HTTP 409 / revisão clínica";
 if(SIASH_CLOUD.syncing)return "Sincronizando";
 if(cloudPending())return "Rascunho local · aguardando sincronização";
 return "Salvo no PostgreSQL";
}
function renderBedReconciliation(){
 const status=$("bed-sync-status"),alert=$("bed-reconciliation-alert");
 if(status)status.textContent="Persistência: "+bedSyncStatus();
 if(!alert)return;
 const today=todayISO(),day=(Array.isArray(S.daily)?S.daily:[]).find(d=>d.date===today);
 const occupied=S.beds.filter(b=>b.status==="Ocupado").length;
 const issues=[];
 if(day&&Number.isFinite(Number(day.internados))&&occupied!==Number(day.internados))
   issues.push("Mapa atual: "+occupied+" RN(s); lançamento de "+today+": "+Number(day.internados)+". Horários de referência podem diferir.");
 const recent=(Array.isArray(S.bedMoves)?S.bedMoves:[]).filter(m=>String(m.recordedAtSaoPaulo||m.when||"").startsWith(today));
 if(recent.length){
   const last=recent[recent.length-1],target=(S.beds||[]).find(b=>b.n===Number(last.target));
   if(target?.rn!==last.rn)issues.push("Último remanejamento do dia difere do mapa atual no leito "+pad(last.target)+". Conferir eventos posteriores.");
 }
 alert.textContent=issues.length?"Conferência humana necessária: "+issues.join(" ")+" Nenhum dado foi ajustado automaticamente.":"Sem divergência numérica identificada para hoje; conferir horários de referência.";
}
function renderBeds(){
 populateBedSelects();renderBedReconciliation();
 $("bed-grid").innerHTML=S.beds.map(b=>`<div class="bed-card ${b.status==="Ocupado"?"occupied":""} ${b.profile==="Intermediário"?"intermediate":""} ${b.status==="Bloqueado"?"blocked":""}">
 <div class="title"><span>Leito ${pad(b.n)}</span><span>${b.status}</span></div>
 <div class="type">${b.profile}${b.isolation?' • Isolamento':''}</div>
 <div class="patient">${safe(b.rn||"Sem identificador")}</div><small>${safe(b.note||"")}</small></div>`).join("");
 $("profile-history-table").innerHTML=[...S.profileHistory].reverse().map(x=>`<tr><td>${safe(x.recordedAtSaoPaulo||x.when)}${x.recordedBy?" · "+safe(x.recordedBy):""}</td><td>Leito ${pad(x.bed)}</td><td>${safe(x.rn)}</td><td>${safe(x.from)}</td><td>${safe(x.to)}</td><td>${safe(x.note)}</td></tr>`).join("")||'<tr><td colspan="6">Nenhuma alteração de perfil registrada.</td></tr>';
 $("bed-moves-table").innerHTML=[...S.bedMoves].reverse().map(x=>`<tr><td>${safe(x.recordedAtSaoPaulo||x.when)}${x.recordedBy?" · "+safe(x.recordedBy):""}</td><td>Leito ${pad(x.origin)}</td><td>Leito ${pad(x.target)}</td><td>${safe(x.rn)}</td><td>${safe(x.profile||"—")}</td><td>${safe(x.note)}</td></tr>`).join("")||'<tr><td colspan="6">Nenhum remanejamento físico registrado.</td></tr>';
}
function updateMovementFields(){const t=$("mv-type").value,lab=$("mv-context-label"),input=$("mv-context"),help=$("mv-help");input.disabled=false;if(t==="Admissão"){lab.childNodes[0].nodeValue="Município de origem";input.placeholder="Ex.: Pirapora";help.innerHTML="Na admissão, informe de qual município o RN é proveniente."}else if(t==="Alta"){lab.childNodes[0].nodeValue="Destino após alta";input.placeholder="Ex.: Domicílio";help.innerHTML="Registre o destino após a alta quando pertinente."}else if(t==="Transferência"){lab.childNodes[0].nodeValue="Destino da transferência";input.placeholder="Ex.: outro hospital / setor";help.innerHTML="Informe para onde o RN foi transferido."}else if(t==="Óbito"){lab.childNodes[0].nodeValue="Origem / Destino";input.value="";input.disabled=true;help.innerHTML="Para óbito, este campo não se aplica."}else if(t==="Encaminhamento PIPA"){lab.childNodes[0].nodeValue="Município do PIPA";input.placeholder="Município";help.innerHTML="Informe o município correspondente ao encaminhamento PIPA."}else{lab.childNodes[0].nodeValue="Destino";input.value="Pediatria / Leito Canguru";help.innerHTML="Alta da Neonatal com destino à Pediatria / leito Canguru."}}
function renderMovements(){$("movement-table").innerHTML=[...S.movements].reverse().map(x=>`<tr><td>${safe(x.recordedAtSaoPaulo||x.when)}${x.recordedBy?" · "+safe(x.recordedBy):""}</td><td>${safe(x.type)}</td><td>${safe(x.bedtype)}</td><td>${safe(x.context)}</td><td>${safe(x.note)}</td></tr>`).join("")||'<tr><td colspan="5">Nenhuma movimentação registrada.</td></tr>';updateMovementFields()}
function renderChecklist(){$("checklist-score").textContent="Adesão "+checkScore()+"%";$("checklist-list").innerHTML=S.checklist.map((c,i)=>`<div class="check-row"><span>${safe(c.text)}</span><select onchange="setCheck(${i},this.value)">${["Pendente","Realizado","Não realizado","N/A"].map(v=>`<option ${c.status===v?"selected":""}>${v}</option>`).join("")}</select></div>`).join("")}
window.setCheck=(i,v)=>{const before=S.checklist[i]?.status;if(before===v)return;shiftAudit("checklist",{index:i,text:S.checklist[i].text,previousStatus:before,newStatus:v});S.checklist[i].status=v;save()}
function renderCare(){$("care-table").innerHTML=Object.entries(S.care).sort((a,b)=>+a[0]-+b[0]).map(([bed,x])=>`<tr><td>Leito ${pad(bed)}</td><td>${safe(x.sae)}</td><td>${safe(x.evol)}</td><td>${safe(x.multi)}</td><td>${safe(x.updated)}</td></tr>`).join("")||'<tr><td colspan="5">Nenhum status assistencial registrado.</td></tr>'}
function renderPicc(){
 const m=currentMonth(),active=S.picc.map((x,i)=>({x,i})).filter(({x})=>(!x.status||x.status==="Ativo")).sort((a,b)=>+a.x.bed-+b.x.bed),removed=S.picc.map((x,i)=>({x,i})).filter(({x})=>x.status==="Retirado").sort((a,b)=>(b.x.removalDate||"").localeCompare(a.x.removalDate||""));
 $("picc-active-count").textContent=active.length;$("picc-days-month").textContent=piccDaysInMonth(m);$("picc-removed-month").textContent=S.picc.filter(x=>x.status==="Retirado"&&x.removalDate&&monthOf(x.removalDate)===m).length;
 $("picc-active-table").innerHTML=active.map(({x,i})=>`<tr>
 <td><strong>Leito ${pad(x.bed)}</strong></td><td>${dateBR(piccInsertDate(x))}</td><td><strong>${piccDays(x)===null?"Conferir data legada":"D"+piccDays(x)}</strong> (${piccDays(x)??"—"} dia${piccDays(x)===1?"":"s"})</td><td>${safe(x.vein)} / ${safe(x.side)}</td>
 <td>${x.punctures}</td><td>${safe(x.position)}</td><td class="${x.bundle?"status-ok":"status-bad"}">${x.bundle?"Conforme":"Não conforme"}</td><td><span class="device-status active">Ativo</span></td>
 <td><button class="ghost" onclick="editPicc(${i})">Retificar</button> <button class="secondary compact-btn" onclick="startPiccRemoval(${i})">Registrar retirada</button></td>
 </tr>`).join("")||'<tr><td colspan="9">Nenhum PICC ativo.</td></tr>';
 $("picc-history-table").innerHTML=removed.map(({x,i})=>`<tr><td>Leito ${pad(x.bed)}</td><td>${dateBR(piccInsertDate(x))}</td><td>${dateBR(x.removalDate)}</td><td>${piccDays(x)}</td><td>${safe(x.removalReason||"—")}</td><td>${safe(x.vein)} / ${safe(x.side)}</td><td><button class="ghost" onclick="editPicc(${i})">Retificar</button></td></tr>`).join("")||'<tr><td colspan="7">Nenhum PICC retirado registrado.</td></tr>';
 const events=$("picc-event-table");
 if(events)events.innerHTML=(S.piccEvents||[]).map(e=>`<tr><td>${safe(e.type)}</td><td>${safe(e.deviceRef||"Legado / pendente")}</td><td>${safe(e.recordedAtSaoPaulo||"Rascunho local")}</td><td>${safe(e.recordedBy||"Pendente")}</td><td>${safe(e.justification||e.correctionText||e.removalReason||e.insertDate||"—")}</td></tr>`).join("")||'<tr><td colspan="5">Nenhum evento PICC auditado nesta versão.</td></tr>';
 const sync=$("picc-sync-status");if(sync)sync.textContent=SIASH_CLOUD.conflict?"Conflito HTTP 409 · rascunho local preservado":SIASH_CLOUD.syncing?"Sincronizando":cloudPending()?"Rascunho local · aguardando PostgreSQL":SIASH_CLOUD.lastSync?"Salvo no PostgreSQL":"Rascunho local";
 const warnings=[];for(const x of active.map(v=>v.x)){const bed=S.beds.find(b=>String(b.n)===String(x.bed));if(!bed||bed.status!=="Ocupado")warnings.push(`PICC ativo associado ao leito ${pad(x.bed)} sem ocupação atual correspondente; confira remanejamento e identificação do RN.`);if(!piccInsertDate(x))warnings.push(`PICC legado do leito ${pad(x.bed)} sem data de inserção válida: conferência humana necessária.`);}
 const warn=$("picc-reconciliation");if(warn)warn.textContent=warnings.length?"Alertas informativos (sem baixa automática): "+warnings.join(" | "):"Nenhuma divergência identificada entre PICCs ativos e ocupação atual. Conferência clínica permanece necessária.";
}

function clearPiccForm(){
 $("picc-edit-index").value="";$("picc-date").value=todayISO();$("picc-bed").value="";$("picc-vein").value="";$("picc-side").value="Direita";$("picc-punctures").value=1;$("picc-length").value="";$("picc-external").value="";$("picc-position").value="Sim";$("picc-b1").value="Sim";$("picc-b2").value="Sim";$("picc-b3").value="Sim";$("picc-save-btn").textContent="Registrar PICC";$("picc-cancel-edit").classList.add("hidden");$("picc-edit-note").classList.add("hidden");
}
window.editPicc=i=>{
 const x=S.picc[i];if(!x)return;
 const justification=window.prompt("Retificação complementar de PICC (sem alterar o registro original). Informe a justificativa obrigatória:");
 if(justification===null)return;
 if(!justification.trim())return alert("A justificativa é obrigatória.");
 const correctionText=window.prompt("Descreva a informação correta e o campo retificado (o histórico original será preservado):");
 if(correctionText===null)return;
 if(!correctionText.trim())return alert("Descreva a retificação.");
 if(!window.confirm(`Confirmar retificação complementar do PICC do leito ${pad(x.bed)}?\\nRegistro original preservado.\\nJustificativa: ${justification}\\nRetificação: ${correctionText}`))return;
 if(!Array.isArray(S.piccEvents))S.piccEvents=[];
 S.piccEvents.push({type:"Retificação",recordIndex:i,justification:justification.trim(),correctionText:correctionText.trim()});
 save();
};
window.startPiccRemoval=i=>{
 const x=S.picc[i];if(!x||(x.status&&x.status!=="Ativo"))return;$("picc-removal-index").value=String(i);$("picc-removal-date").value=todayISO();$("picc-removal-reason").value="";$("picc-removal-note").value="";$("picc-removal-target").textContent=`Leito ${pad(x.bed)} • inserido em ${dateBR(piccInsertDate(x))} • D${piccDays(x)}`;$("picc-removal-panel").classList.remove("hidden");$("picc-removal-panel").scrollIntoView({behavior:"smooth",block:"center"});
}
function cancelPiccRemoval(){$("picc-removal-index").value="";$("picc-removal-reason").value="";$("picc-removal-note").value="";$("picc-removal-panel").classList.add("hidden")}


function renderPipa(){if(!$("pipa-date").value)$("pipa-date").value=todayISO();const m=$("pipa-month").value||monthOf($("pipa-date").value);if(!$("pipa-month").value)$("pipa-month").value=m;const rows=S.pipa.filter(x=>!x.cancelledAt&&(x.date?monthOf(x.date):x.month)===m),total=rows.reduce((a,b)=>a+(+b.qty||0),0),g={};const audit=pipaReconciliationSummary(m),auditEl=$("pipa-reconciliation");if(auditEl)auditEl.textContent=`Conferência: ${audit.dated} encaminhamento(s) datado(s); ${audit.monthlyOnly} registro(s) histórico(s) sem data; ${audit.legacyDaily} no censo diário legado; ${audit.overlapDays} dia(s) com possível sobreposição. Não somar as fontes sem conciliação.`;rows.forEach(r=>g[r.city]=(g[r.city]||0)+(+r.qty||0));$("pipa-total").textContent=total;$("pipa-cities").textContent=Object.values(g).filter(x=>x>0).length;$("pipa-competence").textContent=m.split("-").reverse().join("/");$("pipa-updated").textContent=S.pipa.length?S.pipa[S.pipa.length-1].updated:"—";const entries=Object.entries(g).filter(([,q])=>q>0),max=Math.max(1,...entries.map(([,q])=>q));$("pipa-bars").innerHTML=entries.length?entries.map(([c,q])=>`<div class="bar-item"><div class="bar-value">${q}</div><div class="bar" style="height:${Math.max(5,q/max*100)}%"></div><div class="bar-label">${safe(c)}</div></div>`).join(""):'<span class="muted">Sem encaminhamentos nesta competência.</span>';$("pipa-table").innerHTML=[...S.pipa].reverse().map((r,idx)=>{
 const i=S.pipa.length-1-idx;
 const origin=r.date?"Datado — "+dateBR(r.date):"Histórico sem data";
 const status=r.cancelledAt?"Cancelado":"Ativo";
 const audit=r.cancelledAt?`<div class="muted">Cancelado em ${safe(new Date(r.cancelledAt).toLocaleString("pt-BR"))} por ${safe(r.cancelledBy||"—")}. Motivo: ${safe(r.cancelReason||"—")}</div>`:"";
 return `<tr><td>${safe((r.month||monthOf(r.date)||"").split("-").reverse().join("/"))}</td><td>${safe(r.city)}</td><td>${safe(r.qty)}</td><td>${safe(r.note||"")}</td><td>${safe(origin)}</td><td>${status}${audit}</td><td>${r.cancelledAt?"—":`<button class="ghost" onclick="deletePipa(${i})">Cancelar</button> <button class="ghost" onclick="rectifyPipa(${i})">Retificar</button>`}</td></tr>`;
 }).join("")||'<tr><td colspan="7">Nenhum encaminhamento registrado.</td></tr>'}
window.rectifyPipa=async i=>{
 const record=S.pipa[i];if(!record)return;
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return alert("Retificação auditável requer conexão autenticada com o servidor.");
 const reason=window.prompt("Justificativa obrigatória (10 a 1000 caracteres):");if(reason===null)return;
 const correction=window.prompt("Descreva a correção complementar, sem modificar o registro original:");if(correction===null)return;
 if(reason.trim().length<10||reason.trim().length>1000||correction.trim().length<3||correction.trim().length>2000)return alert("Confira a justificativa e a descrição da retificação.");
 if(!window.confirm("Registrar retificação complementar auditável? O registro original será preservado."))return;
 try{await cloudJson("/api/pipa/rectifications",{method:"POST",body:JSON.stringify({base_revision:SIASH_CLOUD.revision,record_index:i,reason:reason.trim(),correction:correction.trim()})});showToast("Retificação complementar auditada no PostgreSQL.",2600);await refreshPipaRectifications();}
 catch(err){alert("Retificação não confirmada no servidor. Preserve a justificativa e confira a sessão antes de tentar novamente. "+err.message);}
};
async function refreshPipaRectifications(){
 const target=$("pipa-rectifications");if(!target||!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return;
 try{const result=await cloudJson("/api/pipa/rectifications");target.textContent=(result.events||[]).map(x=>x.record_index+" · "+x.username+" · "+new Date(x.created_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})+" · "+x.reason+" · "+x.correction).join("\\n")||"Nenhuma retificação complementar registrada.";}catch(_){target.textContent="Histórico de retificações indisponível. Não presumir ausência de registros.";}
}
window.deletePipa=i=>{
 const r=S.pipa[i];if(!r||r.cancelledAt)return;
 const ref=`${r.city} — ${r.qty} RN(s) — ${r.date?dateBR(r.date):"histórico sem data, competência "+r.month}`;
 if(!confirm(`Cancelar o encaminhamento PIPA: ${ref}?\n\nO registro será preservado no histórico e excluído dos indicadores. Esta ação será sincronizada com os demais usuários.`))return;
 const reason=prompt("Informe a justificativa obrigatória para cancelar este encaminhamento:");
 if(reason===null)return;
 const why=reason.trim();if(why.length<10||why.length>1000){alert("Justificativa obrigatória: informe entre 10 e 1000 caracteres.");return;}
 r.cancelledAt=new Date().toISOString();
 r.cancelledBy=String(SESSION.user||"Usuário autenticado");
 r.cancelReason=why;
 r.updated=nowBR();
 save();
 showToast("Encaminhamento cancelado e preservado para auditoria.",2400);
}
let sharedPending=[],pendingLoaded=false,pendingLoading=false;
async function loadSharedPending(){
 if(!SIASH_CLOUD.token||pendingLoading)return;
 pendingLoading=true;
 try{const data=await cloudJson("/api/pending");sharedPending=data.items||[];pendingLoaded=true;renderPending();const counter=$("m-pendencias");if(counter)counter.textContent=sharedPending.filter(p=>p.status!=="Concluída").length;}
 catch(e){pendingLoaded=false;renderPending();showToast("Não foi possível sincronizar pendências: "+e.message,3000)}
 finally{pendingLoading=false}
}
function renderPending(){
 const list=$("pending-list");if(!list)return;
 const cloud=sharedPending.map(p=>{
  const label=p.scope==="sector"?"Geral / Setor":"Leito "+pad(Number(p.bed));
  const options=["Pendente","Em andamento","Concluída"].map(st=>`<option value="${st}" ${p.status===st?"selected":""}>${st}</option>`).join("");
  return `<div class="pending-row" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid #ddd"><span style="flex:1;min-width:210px"><strong>${safe(label)}</strong> • ${safe(p.priority)} — ${safe(p.description)}<br><small>Criada por ${safe(p.created_by)} · ${safe(new Date(p.created_at).toLocaleString("pt-BR"))}${p.updated_by?" · Atualizada por "+safe(p.updated_by):""}</small></span><label>Situação<select data-pending-id="${p.id}">${options}</select></label>${p.status!=="Concluída"?`<button type="button" class="primary" data-complete-id="${p.id}">Marcar concluída</button>`:`<strong style="color:#28734b">✓ Concluída</strong>`}<button type="button" class="secondary" data-history-id="${p.id}">Histórico</button></div>`;
 }).join("");
 const legacy=!pendingLoaded&&S.pending.length?`<h4>Registros anteriores (aguardando migração)</h4>`+S.pending.map(p=>`<div class="pending-row"><span><strong>${safe(p.bed)}</strong> • ${safe(p.priority)} — ${safe(p.text)} · ${p.done?"Concluída":"Pendente"}</span></div>`).join(""):"";
 list.innerHTML=(pendingLoaded?(cloud||'<p class="muted">Nenhuma pendência compartilhada cadastrada.</p>'):'<p class="muted">Pendências compartilhadas aguardando sincronização.</p>')+legacy;
}
// Registros legados são migrados no servidor; evitar alterações locais que causem divergência.
async function changeSharedPending(id,status){
 const previous=sharedPending.find(x=>String(x.id)===String(id));let reason="",confirm_reopen=false;
 if(previous?.status==="Concluída"&&status!=="Concluída"){
  if(!confirm("Reabrir pendência concluída? A alteração será auditada.")){renderPending();return;}
  reason=prompt("Justificativa obrigatória da reabertura (mínimo 10 caracteres):")||"";
  if(reason.trim().length<10){alert("Justificativa insuficiente.");renderPending();return;}
  confirm_reopen=true;
 }
 try{await cloudJson("/api/pending/"+id,{method:"PATCH",body:JSON.stringify({status,reason,confirm_reopen})});await loadSharedPending();showToast("Pendência atualizada",1400)}
 catch(e){alert("Não foi possível atualizar: "+e.message);await loadSharedPending()}
}

function fillMonthSelect(id){const sel=$(id),cur=sel.value;sel.innerHTML=allMonths().map(m=>`<option value="${m}">${m.split("-").reverse().join("/")}</option>`).join("");sel.value=allMonths().includes(cur)?cur:currentMonth()}
function renderIndicators(){fillMonthSelect("indicator-month");const m=$("indicator-month").value,c=monthStats(m);$("i-pd").textContent=c.pd;$("i-occ").textContent=fmt(c.occ,1)+"%";$("i-los").textContent=c.outs?fmt(c.los,1)+" d":"—";$("i-adm").textContent=c.adm;$("i-transf").textContent=c.transf;$("i-deaths").textContent=c.deaths;const prod=[["Dias lançados",c.days],["Leitos-dia",c.ld],["Saídas",c.outs],["Altas",c.altas],["PIPA",c.pipa],["Altas → Leito Canguru",c.canguru],["PICCs inseridos",c.picc],["PICC-dia",c.piccDays],["PICCs ativos atualmente",c.piccActive],["PICCs retirados",c.piccRemoved],["Testes do pezinho",c.pezinho],["RN em VM atualmente",c.vmCurrent],["VM-dia no mês",c.vmDays],["Intubações no mês",c.intub],["Extubações programadas",c.extubProg],["Extubações acidentais",c.extub],["Lesões por pressão",c.lpp],["Hipotermia",c.hypothermia],["Hipertermia",c.hyperthermia]];const coverage=monthCoverage(m,c.days);const coverageAlert=$("indicator-coverage-alert");coverageAlert.hidden=!coverage?.incomplete;coverageAlert.textContent=coverage?.incomplete?`Cobertura parcial: ${coverage.registered} de ${coverage.calendarDays} dias com lançamento nesta competência. Leitos-dia e taxa de ocupação consideram somente os dias lançados; não representam necessariamente o mês completo. Nenhum valor foi ajustado automaticamente.`:"";const balanceWarnings=auditDailyBalance(S.daily,m);
 let balanceAlert=$("indicator-balance-alert");
 if(!balanceAlert){balanceAlert=document.createElement("div");balanceAlert.id="indicator-balance-alert";balanceAlert.setAttribute("role","status");balanceAlert.className="indicator-coverage-alert";coverageAlert.insertAdjacentElement("afterend",balanceAlert)}
 balanceAlert.hidden=balanceWarnings.length===0;
 balanceAlert.textContent=balanceWarnings.length?"Conferência de consistência: "+balanceWarnings.map(w=>w.type==="balance"?w.date+": saldo esperado "+w.expected+", informado "+w.actual+" (diferença "+w.difference+").":w.type==="duplicate"?w.date+": "+w.occurrences+" lançamentos na mesma data.":w.date+": "+({"gap":"lacuna entre dias","invalid-count":"contagem inválida","invalid-date":"data inválida","not-comparable":"comparação impedida por data anterior duplicada ou inválida"}[w.type]||"verificar lançamento")+".").join(" ")+" Nenhum registro foi alterado automaticamente.":"";
 const overlaps=canguruSourceOverlap(m),inconsistencies=canguruConsistencyAudit(m);$("indicator-production").innerHTML=prod.map(x=>`<tr><th>${x[0]}</th><td>${x[1]}</td></tr>`).join("")+(overlaps.length?`<tr><td colspan="2" role="status"><strong>Auditoria Leito Canguru:</strong> ${overlaps.length} dia(s) com preenchimento simultâneo dos campos histórico e atual (${overlaps.map(r=>safe(dateBR(r.date))).join(", ")}). A soma exibida foi preservada; conferir os registros antes de concluir que há duplicidade.</td></tr>`:"")+(inconsistencies.length?`<tr><td colspan="2" role="status"><strong>Conferência de consistência:</strong> ${inconsistencies.length} dia(s) com altas para Leito Canguru superiores ao total de altas registrado (${inconsistencies.map(r=>safe(dateBR(r.date))).join(", ")}). Verificar classificação e lançamentos; nenhum valor foi alterado.</td></tr>`:"");const g={};S.pipa.filter(x=>!x.cancelledAt&&(x.date?monthOf(x.date):x.month)===m).forEach(r=>g[r.city]=(g[r.city]||0)+(+r.qty||0));$("indicator-pipa-cities").innerHTML=Object.entries(g).sort((a,b)=>b[1]-a[1]).map(([c,q])=>`<tr><td>${safe(c)}</td><td>${q}</td></tr>`).join("")||'<tr><td colspan="2">Sem dados PIPA por município.</td></tr>'}
function renderComparison(){
 const current=currentMonth(),parts=current.split("-").map(Number),months=[];
 for(let offset=-2;offset<=0;offset++){const d=new Date(parts[0],parts[1]-1+offset,1);months.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}`)}
 const data=months.map(m=>({m,...monthStats(m)})),label=x=>x.m.slice(5)+"/"+x.m.slice(2,4);
 const bars=(id,key,format=v=>String(v),minimum=1)=>{const max=Math.max(minimum,...data.map(x=>+x[key]||0));$(id).innerHTML=data.map(x=>`<div class="bar-item"><div class="bar-value">${format(+x[key]||0,x)}</div><div class="bar" style="height:${Math.max(2,(+x[key]||0)/max*100)}%"></div><div class="bar-label">${label(x)}</div></div>`).join("")};
 bars("comparison-occ","occ",v=>fmt(v,1)+"%",100);
 bars("comparison-los","los",(v,x)=>x.outs?fmt(v,1):"—",1);
 bars("comparison-pd","pd",v=>String(v),1);
 bars("comparison-hypothermia","hypothermia",v=>String(v),1);
 bars("comparison-hyperthermia","hyperthermia",v=>String(v),1);
 const thermal=data.map(x=>({...x,thermal:(+x.hypothermia||0)+(+x.hyperthermia||0)})),maxThermal=Math.max(1,...thermal.map(x=>x.thermal));
 $("comparison-thermal").innerHTML=thermal.map(x=>`<div class="bar-item"><div class="bar-value">${x.thermal}</div><div class="bar" style="height:${Math.max(2,x.thermal/maxThermal*100)}%"></div><div class="bar-label">${label(x)}</div></div>`).join("");
 const a=data[1],b=data[2],d=b.occ-a.occ,pdDiff=b.pd-a.pd;
 const coverageNote=data.some(x=>monthCoverage(x.m,x.days)?.incomplete)?" Atenção: existem competências com cobertura parcial; as taxas representam somente os dias lançados.":"";
 $("comparison-text").textContent=`Últimos 3 meses: ${months.map(m=>m.split("-").reverse().join("/")).join(" • ")}. Entre ${a.m.split("-").reverse().join("/")} e ${b.m.split("-").reverse().join("/")}, a taxa de ocupação apresentou ${d>=0?"aumento":"redução"} de ${fmt(Math.abs(d),1)} ponto(s) percentual(is), e pacientes-dia ${pdDiff>=0?"aumentou":"reduziu"} em ${Math.abs(pdDiff)}. No mês atual foram registrados ${b.hypothermia} evento(s) de hipotermia e ${b.hyperthermia} de hipertermia.${coverageNote}`;
}
function addMonths(dateStr,n){if(!dateStr)return"";const d=new Date(dateStr+"T12:00:00");d.setMonth(d.getMonth()+n);return d.toISOString().slice(0,10)}
const DOCS_DB="siash_docs_files_v1",DOCS_DB_STORE="files";
function docsDb(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(new Error("IndexedDB indisponível"));const req=indexedDB.open(DOCS_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DOCS_DB_STORE))db.createObjectStore(DOCS_DB_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function putDocBlob(key,file){
 if(!file)return null;const db=await docsDb();
 await new Promise((resolve,reject)=>{const tx=db.transaction(DOCS_DB_STORE,"readwrite");tx.objectStore(DOCS_DB_STORE).put(file,key);tx.oncomplete=()=>{db.close();resolve(key)};tx.onerror=()=>{db.close();reject(tx.error)}});
 try{await uploadDocCloud(key,file);updateCloudBadge("Sincronizado com PostgreSQL")}catch(e){console.warn("Sincronização documental pendente; arquivo preservado no navegador.");updateCloudBadge("Pendente de envio · IndexedDB",true);throw e}
 return key
}
async function getDocBlob(key){
 if(!key)return null;const db=await docsDb();
 const local=await new Promise((resolve,reject)=>{const tx=db.transaction(DOCS_DB_STORE,"readonly"),req=tx.objectStore(DOCS_DB_STORE).get(key);req.onsuccess=()=>{db.close();resolve(req.result||null)};req.onerror=()=>{db.close();reject(req.error)}});
 if(local)return local;
 try{
   const remote=await getDocCloud(key);
   if(remote){const db2=await docsDb();await new Promise((resolve,reject)=>{const tx=db2.transaction(DOCS_DB_STORE,"readwrite");tx.objectStore(DOCS_DB_STORE).put(remote,key);tx.oncomplete=()=>{db2.close();resolve()};tx.onerror=()=>{db2.close();reject(tx.error)}});return remote}
 }catch(e){console.warn("Documento Cloud indisponível",e)}
 return null
}
function newDocId(){return "DOC-"+Date.now()+"-"+Math.random().toString(36).slice(2,7)}
function defaultSiashDocs(){return[{"id":"POP-UTIN-ADM-001","title":"POP – Admissão do Recém-Nascido na UTI Neonatal","code":"POP-UTIN-ADM-001","sector":"UTIN","period":24,"seed":true,"versions":[{"revision":"00","reviewDate":"2026-04-20","workflow":"Vigente","note":"Emissão inicial institucional.","createdBy":"SIASH / Coordenação UTIN","createdAt":"20/04/2026","pdfPath":"documentos/UTIN/POPs/POP_Admissao_UTIN_Rev00.pdf","wordPath":"documentos/UTIN/POPs/POP_Admissao_UTIN_Rev00.docx","pdfName":"POP_Admissao_UTIN_Rev00.pdf","wordName":"POP_Admissao_UTIN_Rev00.docx"}]},{"id":"POP-UTIN-ENF-SEPSE-001","title":"POP – Sepse Neonatal","code":"POP-UTIN-ENF-SEPSE-001","sector":"UTIN","period":24,"seed":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Versão institucional incorporada ao SIASH Docs. Base técnica principal identificada como FHEMIG 2019; revisão técnica necessária.","createdBy":"SIASH / Coordenação UTIN","createdAt":"2026","pdfPath":"documentos/UTIN/POPs/POP_Sepse_Neonatal_Rev00.pdf","wordPath":"documentos/UTIN/POPs/POP_Sepse_Neonatal_Rev00.docx","pdfName":"POP_Sepse_Neonatal_Rev00.pdf","wordName":"POP_Sepse_Neonatal_Rev00.docx"},{"revision":"01","reviewDate":"2026-08-22","workflow":"Em revisão","note":"Revisão técnica iniciada: atualizar critérios, referências, fluxos e terapêutica com fontes vigentes antes da validação profissional. A versão 00 permanece vigente durante a revisão.","createdBy":"SIASH Docs / revisão assistida","createdAt":"22/08/2026"}]},{"id":"LEG-UTIN-001","title":"POP1_2_3_Higienização simples das mãos 2024","code":"LEG-UTIN-001","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","pdfPath":"documentos/UTIN/POPs/Acervo_2024/1_POP1_2_3_Higienização simples das mãos (1)2024.pdf","pdfName":"1_POP1_2_3_Higienização simples das mãos (1)2024.pdf"}]},{"id":"LEG-UTIN-002","title":"ADMINISTRAÇÃO DE DIETA (SNE ou Ostomias) por gotejamento 1","code":"LEG-UTIN-002","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/ADMINISTRAÇÃO DE DIETA (SNE ou Ostomias) por gotejamento 1 (1).docx","wordName":"ADMINISTRAÇÃO DE DIETA (SNE ou Ostomias) por gotejamento 1 (1).docx"}]},{"id":"LEG-UTIN-003","title":"Administração de dieta por gavagem","code":"LEG-UTIN-003","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Administração de dieta por gavagem.doc","wordName":"Administração de dieta por gavagem.doc"}]},{"id":"LEG-UTIN-004","title":"ADMINISTRAÇÃO SEGURA DE MEDICAÇÃO - atualizado 2022","code":"LEG-UTIN-004","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/ADMINISTRAÇÃO SEGURA DE MEDICAÇÃO - atualizado 2022.docx","wordName":"ADMINISTRAÇÃO SEGURA DE MEDICAÇÃO - atualizado 2022.docx"},{"revision":"01","reviewDate":"2026-08-22","workflow":"Em revisão","note":"Revisão técnica iniciada no SIASH Docs: o arquivo de origem está identificado como atualizado em 2022 e ultrapassou o ciclo bienal. Manter a versão vigente anterior até atualização, validação profissional e publicação da revisão 01.","createdBy":"SIASH Docs / revisão assistida","createdAt":"22/08/2026"}]},{"id":"LEG-UTIN-005","title":"Alta do Rn Transferência do RN","code":"LEG-UTIN-005","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Alta do Rn  Transferência do RN.doc","wordName":"Alta do Rn  Transferência do RN.doc"}]},{"id":"LEG-UTIN-006","title":"ANOTAÇÃO DE ENFERMAGEM - atulalizado","code":"LEG-UTIN-006","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/ANOTAÇÃO DE ENFERMAGEM - atulalizado.docx","wordName":"ANOTAÇÃO DE ENFERMAGEM - atulalizado.docx"}]},{"id":"LEG-UTIN-007","title":"ASSISTENCIA DE ENFERMAGEM NA ADMISSÃO DO PACIENTE NO CTI NEONATAL","code":"LEG-UTIN-007","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/ASSISTENCIA DE ENFERMAGEM NA ADMISSÃO DO PACIENTE NO CTI NEONATAL.docx","wordName":"ASSISTENCIA DE ENFERMAGEM NA ADMISSÃO DO PACIENTE NO CTI NEONATAL.docx"}]},{"id":"LEG-UTIN-008","title":"BOMBA DE INFUSÃO B -BRAUN","code":"LEG-UTIN-008","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/BOMBA DE INFUSÃO B -BRAUN.docx","wordName":"BOMBA DE INFUSÃO B -BRAUN.docx"}]},{"id":"LEG-UTIN-009","title":"Cateterismo da Veia Umbilical","code":"LEG-UTIN-009","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Cateterismo da Veia Umbilical.docx","wordName":"Cateterismo da Veia Umbilical.docx"}]},{"id":"LEG-UTIN-010","title":"CATETERISMO VESICAL","code":"LEG-UTIN-010","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/CATETERISMO VESICAL (1).docx","wordName":"CATETERISMO VESICAL (1).docx"}]},{"id":"LEG-UTIN-011","title":"CHECAGEM DE PRESCRIÇÃO MÉDICA E DE ENFERMAGEM","code":"LEG-UTIN-011","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/CHECAGEM DE PRESCRIÇÃO MÉDICA E DE ENFERMAGEM.docx","wordName":"CHECAGEM DE PRESCRIÇÃO MÉDICA E DE ENFERMAGEM.docx"}]},{"id":"LEG-UTIN-012","title":"Check-List de Leito - atualizado 2022","code":"LEG-UTIN-012","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Check-List de Leito - atualizado 2022.docx","wordName":"Check-List de Leito - atualizado 2022.docx"},{"revision":"01","reviewDate":"2026-08-22","workflow":"Em revisão","note":"Revisão técnica iniciada no SIASH Docs: o arquivo de origem está identificado como atualizado em 2022 e ultrapassou o ciclo bienal. Manter a versão vigente anterior até atualização, validação profissional e publicação da revisão 01.","createdBy":"SIASH Docs / revisão assistida","createdAt":"22/08/2026"}]},{"id":"LEG-UTIN-013","title":"Coleta de Teste do Pezinho","code":"LEG-UTIN-013","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Coleta de Teste do Pezinho.docx","wordName":"Coleta de Teste do Pezinho.docx"}]},{"id":"LEG-UTIN-014","title":"coleta para Hemocultura","code":"LEG-UTIN-014","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/coleta para Hemocultura.docx","wordName":"coleta para Hemocultura.docx"}]},{"id":"LEG-UTIN-015","title":"Conferencia Validade Medicação de Uso Coletivo","code":"LEG-UTIN-015","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Conferencia Validade Medicação de Uso Coletivo.docx","wordName":"Conferencia Validade Medicação de Uso Coletivo.docx"}]},{"id":"LEG-UTIN-016","title":"CONTROLE DE NUMERAÇÃO DOS PROCEDIMENTOS","code":"LEG-UTIN-016","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/CONTROLE DE NUMERAÇÃO DOS PROCEDIMENTOS.docx","wordName":"CONTROLE DE NUMERAÇÃO DOS PROCEDIMENTOS.docx"}]},{"id":"LEG-UTIN-017","title":"Cuidados com a Pele do RN - atualizado","code":"LEG-UTIN-017","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Cuidados com a Pele do RN (1) - atualizado.docx","wordName":"Cuidados com a Pele do RN (1) - atualizado.docx"}]},{"id":"LEG-UTIN-018","title":"Cuidados de Enfermagem com Fototerapia","code":"LEG-UTIN-018","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Cuidados de Enfermagem com Fototerapia.docx","wordName":"Cuidados de Enfermagem com Fototerapia.docx"}]},{"id":"LEG-UTIN-019","title":"CUIDADOS PÓS-MORTE","code":"LEG-UTIN-019","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/CUIDADOS PÓS-MORTE.docx","wordName":"CUIDADOS PÓS-MORTE.docx"}]},{"id":"LEG-UTIN-020","title":"Desinfecção Terminal da Incubadora","code":"LEG-UTIN-020","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Desinfecção Terminal da Incubadora.docx","wordName":"Desinfecção Terminal da Incubadora.docx"}]},{"id":"LEG-UTIN-021","title":"Glicemia Capilar em RN","code":"LEG-UTIN-021","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Glicemia Capilar em RN.docx","wordName":"Glicemia Capilar em RN.docx"}]},{"id":"LEG-UTIN-022","title":"Higiene Oral","code":"LEG-UTIN-022","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Higiene Oral.docx","wordName":"Higiene Oral.docx"}]},{"id":"LEG-UTIN-023","title":"Higienização das mãos_alcool_gel_POP2 - atualizado","code":"LEG-UTIN-023","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Higienização das mãos_alcool_gel_POP2 - atualizado.doc","wordName":"Higienização das mãos_alcool_gel_POP2 - atualizado.doc"}]},{"id":"LEG-UTIN-024","title":"HIGIENIZAÇÃO DO RECÉM NASCIDO EM INCUBADORA","code":"LEG-UTIN-024","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/HIGIENIZAÇÃO DO RECÉM NASCIDO EM INCUBADORA.docx","wordName":"HIGIENIZAÇÃO DO RECÉM NASCIDO EM INCUBADORA.docx"}]},{"id":"LEG-UTIN-025","title":"INSERÇÃO DO CATETER EPICUTÂNEO","code":"LEG-UTIN-025","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/INSERÇÃO DO CATETER  EPICUTÂNEO.docx","wordName":"INSERÇÃO DO CATETER  EPICUTÂNEO.docx"}]},{"id":"LEG-UTIN-026","title":"Lavagem Gástrica","code":"LEG-UTIN-026","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Lavagem Gástrica.docx","wordName":"Lavagem Gástrica.docx"}]},{"id":"LEG-UTIN-027","title":"Manipulação Mininma UTI NEONATA E PEDIÁTRICA","code":"LEG-UTIN-027","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Manipulação Mininma UTI NEONATA E PEDIÁTRICA.docx","wordName":"Manipulação Mininma UTI NEONATA E PEDIÁTRICA.docx"}]},{"id":"LEG-UTIN-028","title":"Mensuração de Radiância","code":"LEG-UTIN-028","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Mensuração de Radiância.docx","wordName":"Mensuração de Radiância.docx"}]},{"id":"LEG-UTIN-029","title":"Monitorização Cardíaca","code":"LEG-UTIN-029","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Monitorização Cardíaca (1).docx","wordName":"Monitorização Cardíaca (1).docx"}]},{"id":"LEG-UTIN-030","title":"Monitorização da temperatura corporal em incubadora ou berço de calor radiante","code":"LEG-UTIN-030","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Monitorização da temperatura corporal em incubadora ou berço de calor radiante.docx","wordName":"Monitorização da temperatura corporal em incubadora ou berço de calor radiante.docx"}]},{"id":"LEG-UTIN-031","title":"Montagem do sistema de Drenagem de torax","code":"LEG-UTIN-031","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Montagem do  sistema de Drenagem de torax (1).doc","wordName":"Montagem do  sistema de Drenagem de torax (1).doc"}]},{"id":"LEG-UTIN-032","title":"Montagem do Box para Admissão do RN","code":"LEG-UTIN-032","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Montagem do Box para Admissão do RN.docx","wordName":"Montagem do Box para Admissão do RN.docx"}]},{"id":"LEG-UTIN-033","title":"POP Posicionamento","code":"LEG-UTIN-033","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/POP Posicionamento.docx","wordName":"POP Posicionamento.docx"}]},{"id":"LEG-UTIN-034","title":"POP1_2_3_Higienização simples das mãos","code":"LEG-UTIN-034","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/POP1_2_3_Higienização simples das mãos.doc","wordName":"POP1_2_3_Higienização simples das mãos.doc"}]},{"id":"LEG-UTIN-035","title":"Punção venosa no RN - atualizado","code":"LEG-UTIN-035","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Punção venosa no RN - atualizado.docx","wordName":"Punção venosa no RN - atualizado.docx"}]},{"id":"LEG-UTIN-036","title":"Relatório de Enfermagem","code":"LEG-UTIN-036","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Relatório de Enfermagem.docx","wordName":"Relatório de Enfermagem.docx"}]},{"id":"LEG-UTIN-037","title":"Sedação e Analgesia em Recém-Nascidos UTI Neonatal","code":"LEG-UTIN-037","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Sedação e Analgesia em Recém-Nascidos UTI  Neonatal.docx","wordName":"Sedação e Analgesia em Recém-Nascidos UTI  Neonatal.docx"}]},{"id":"LEG-UTIN-038","title":"Sondagem Orogástrica e Nasogástrica - atualizado 2022","code":"LEG-UTIN-038","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Sondagem Orogástrica e Nasogástrica - atualizado 2022.doc","wordName":"Sondagem Orogástrica e Nasogástrica - atualizado 2022.doc"},{"revision":"01","reviewDate":"2026-08-22","workflow":"Em revisão","note":"Revisão técnica iniciada no SIASH Docs: o arquivo de origem está identificado como atualizado em 2022 e ultrapassou o ciclo bienal. Manter a versão vigente anterior até atualização, validação profissional e publicação da revisão 01.","createdBy":"SIASH Docs / revisão assistida","createdAt":"22/08/2026"}]},{"id":"LEG-UTIN-039","title":"Troca de Equipos e Soluções","code":"LEG-UTIN-039","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Troca de Equipos e Soluções.docx","wordName":"Troca de Equipos e Soluções.docx"}]},{"id":"LEG-UTIN-040","title":"TROCA DE ÓCULOS","code":"LEG-UTIN-040","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/TROCA DE ÓCULOS.docx","wordName":"TROCA DE ÓCULOS.docx"}]},{"id":"LEG-UTIN-041","title":"Verificação do Peso do RN","code":"LEG-UTIN-041","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Verificação do Peso do RN.doc","wordName":"Verificação do Peso do RN.doc"}]},{"id":"LEG-UTIN-042","title":"Verificação do Resíduo Gástrico Estáse gástrica","code":"LEG-UTIN-042","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Verificação do Resíduo Gástrico  Estáse gástrica.doc","wordName":"Verificação do Resíduo Gástrico  Estáse gástrica.doc"}]},{"id":"LEG-UTIN-043","title":"VERIFICAÇÃO DOS DADOS ANTROPOMÉTRICOS - atualizado","code":"LEG-UTIN-043","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/VERIFICAÇÃO DOS DADOS ANTROPOMÉTRICOS - atualizado - Copia.docx","wordName":"VERIFICAÇÃO DOS DADOS ANTROPOMÉTRICOS - atualizado - Copia.docx"}]},{"id":"LEG-UTIN-044","title":"Verificação dos Dados Vitais em RN’s","code":"LEG-UTIN-044","sector":"UTIN","period":24,"seed":true,"legacy":true,"reviewRequired":true,"versions":[{"revision":"00","reviewDate":"","workflow":"Vigente","note":"Documento importado do acervo institucional \"POP UTIN 2024\". Data/código/revisão original devem ser confirmados durante a revisão documental.","createdBy":"Importação SIASH Docs","createdAt":"22/08/2026","wordPath":"documentos/UTIN/POPs/Acervo_2024/Verificação dos Dados Vitais em RN’s.docx","wordName":"Verificação dos Dados Vitais em RN’s.docx"}]}]}

function normalizeDocs(){
 S.docs=(S.docs||[]).map((d,i)=>{
   if(!d.id)d.id=d.code||("DOC-MIGRADO-"+i);
   if(!d.sector)d.sector="UTIN";
   d.period=+d.period||24;
   if(!Array.isArray(d.versions)||!d.versions.length)d.versions=[{revision:d.revision||"00",reviewDate:d.review||"",workflow:"Vigente",note:"Registro migrado de versão anterior do SIASH Docs.",createdBy:"SIASH",createdAt:nowBR(),pdfPath:d.pdfPath||null,wordPath:d.wordPath||null}];
   d.versions.forEach(v=>{if(!v.workflow)v.workflow="Vigente";if(typeof v.reviewDate==="undefined")v.reviewDate=v.review||"";if(!v.revision)v.revision="00"});
   return d
 });
 const defaults=defaultSiashDocs();
 defaults.forEach(def=>{const exists=S.docs.some(d=>d.code===def.code||(d.title||"").toLowerCase()===def.title.toLowerCase());if(!exists)S.docs.push(def)});
 const picc=S.docs.find(d=>d.code==="LEG-UTIN-025");
 if(picc){
   const proposal={revision:"05",reviewDate:"2026-08-25",workflow:"Aguardando aprovação",note:"Revisão técnico-científica proposta pela IA após análise da versão 04 (03/2024). Principais mudanças: ANVISA 2025; habilitação COFEN; seleção vascular e relação cateter/vaso <45%; ultrassom quando disponível; barreira máxima; antissepsia neonatal por idade/idade gestacional; posicionamento central SVC/IVC fora das câmaras cardíacas; cobertura/estabilização; prevenção de IPCS; complicações e checklist. A Revisão 04 permanece vigente até validação profissional.",sources:"ANVISA 2025 - Protocolo de Prevenção de IPCS associada a dispositivos de acesso vasculares; COFEN Res. 258/2001; Parecer Conjunto COFEN 001/2019; CDC - Intravascular Catheter-Related Infections (atualizações vigentes); Infusion Therapy Standards of Practice 2024; AAP Pediatrics 2022 - POCUS in NICU; Cochrane 2023 - antissepsia neonatal; literatura neonatal recente.",createdBy:"SIASH Docs / IA",createdAt:"25/08/2026",pdfPath:"documentos/UTIN/POPs/Propostas/LEG-UTIN-025_PICC_Rev05_PROPOSTA.pdf",wordPath:"documentos/UTIN/POPs/Propostas/LEG-UTIN-025_PICC_Rev05_PROPOSTA.docx",pdfName:"LEG-UTIN-025_PICC_Rev05_PROPOSTA.pdf",wordName:"LEG-UTIN-025_PICC_Rev05_PROPOSTA.docx"};
   const vi=picc.versions.findIndex(v=>String(v.revision)==="05");
   if(vi<0){proposal.workflow="Vigente";proposal.validator="Administrador Proprietário";proposal.validationDate="2026-08-25";picc.versions.forEach(v=>{if(v.workflow==="Vigente")v.workflow="Obsoleto"});picc.versions.push(proposal)}else{picc.versions[vi]={...picc.versions[vi],...proposal,workflow:"Vigente",validator:picc.versions[vi].validator||"Administrador Proprietário",validationDate:picc.versions[vi].validationDate||"2026-08-25"};picc.versions.forEach((v,x)=>{if(x!==vi&&v.workflow==="Vigente")v.workflow="Obsoleto"})}
   picc.reviewRequired=false;
 }
 // v0.11.0 — corrige o histórico real do POP Administração Segura de Medicação.
 // O documento institucional original é Rev.05 (03/2024); a revisão validada em 25/08/2026 é Rev.06.
 const med=S.docs.find(d=>d.code==="LEG-UTIN-004");
 if(med){
   med.title="ADMINISTRAÇÃO SEGURA DE MEDICAÇÃO";
   med.period=24;
   const rev06Path="documentos/UTIN/POPs/Vigentes/POP-ASS-NEO-03_Administracao_Segura_Medicacao_Rev06_2026.docx";
   const currentVig=med.versions.find(v=>v.workflow==="Vigente");
   const mistaken01=med.versions.find(v=>String(v.revision)==="01"&&v.workflow==="Vigente");
   let rev06=med.versions.find(v=>String(v.revision)==="06");
   if(!rev06){
     rev06={
       revision:"06",reviewDate:"2026-08-25",workflow:"Vigente",
       note:"Atualização técnico-científica realizada sobre a estrutura institucional do POP-ASS-NEO-03 e validada profissionalmente. Corrigida também a numeração histórica: documento-base Rev.05 (03/2024), nova revisão Rev.06.",
       sources:"Ministério da Saúde/ANVISA; RDC 36/2013; Nota Técnica GVIMS/GGTES/DIRE3/ANVISA nº 05/2024; orientações vigentes de segurança na prescrição, uso e administração de medicamentos; protocolos institucionais aplicáveis.",
       createdBy:"SIASH Docs / IA",createdAt:"25/08/2026",
       validator:mistaken01?.validator||currentVig?.validator||"Administrador Proprietário",
       validationDate:mistaken01?.validationDate||currentVig?.validationDate||"2026-08-25",
       wordPath:rev06Path,wordName:"POP-ASS-NEO-03_Administracao_Segura_Medicacao_Rev06_2026.docx"
     };
     med.versions.push(rev06);
   }else{
     Object.assign(rev06,{reviewDate:"2026-08-25",workflow:"Vigente",wordPath:rev06Path,wordName:"POP-ASS-NEO-03_Administracao_Segura_Medicacao_Rev06_2026.docx"});
   }
   med.versions.forEach(v=>{if(v!==rev06&&v.workflow==="Vigente")v.workflow="Obsoleto"});
   // A antiga Rev.01 foi um número de controle criado pelo protótipo, não uma revisão institucional real.
   med.versions=med.versions.filter(v=>!(String(v.revision)==="01"&&v!==rev06));
   const legacy=med.versions.find(v=>String(v.revision)==="00");
   if(legacy){legacy.revision="05";legacy.reviewDate=legacy.reviewDate||"2024-03-01";legacy.workflow="Obsoleto";legacy.note=(legacy.note||"")+" Revisão institucional real identificada no documento-base: Rev.05, março/2024."}
   med.reviewRequired=false;
 }
}
function docPublishedIndex(d){for(let i=d.versions.length-1;i>=0;i--)if(d.versions[i].workflow==="Vigente")return i;return d.versions.length?0:-1}
function docWorkingIndex(d){return d.versions.length-1}
function docPublishedVersion(d){const i=docPublishedIndex(d);return i>=0?d.versions[i]:null}
function docWorkingVersion(d){const i=docWorkingIndex(d);return i>=0?d.versions[i]:null}
function docStatus(d){const v=docPublishedVersion(d);const review=v?.reviewDate||"";if(d.reviewRequired&&!review)return{key:"review",text:"Revisão necessária",cls:"status-priority",next:"",days:null};if(!review)return{key:"unknown",text:"Sem data de revisão",cls:"status-warn",next:"",days:null};const next=addMonths(review,+d.period),now=new Date(todayISO()+"T12:00:00"),nd=new Date(next+"T12:00:00"),days=Math.ceil((nd-now)/86400000);if(days<0)return{key:"expired",text:"Revisão vencida",cls:"status-bad",next,days};if(days<=30)return{key:"priority",text:"Revisão prioritária",cls:"status-priority",next,days};if(days<=90)return{key:"soon",text:"Revisão próxima",cls:"status-warn",next,days};return{key:"valid",text:"Vigente",cls:"status-ok",next,days}}
function workflowClass(w){return w==="Vigente"?"status-ok":w==="Obsoleto"?"muted":"status-warn"}
function docsVersionButtons(docIndex,versionIndex){const d=S.docs[docIndex],v=d?.versions?.[versionIndex];if(!v)return"—";const buttons=[];if(v.pdfKey||v.pdfPath)buttons.push(`<button class="ghost compact-btn" onclick="openDocVersion(${docIndex},${versionIndex},'pdf')">PDF</button>`);if(v.wordKey||v.wordPath)buttons.push(`<button class="ghost compact-btn" onclick="openDocVersion(${docIndex},${versionIndex},'word')">Word</button>`);return buttons.join(" ")||"—"}
async function sanitizePublishedWordStatus(d,v,blob){
 if(!blob||v?.workflow!=="Vigente"||!v?.wordKey||!/\.docx$/i.test(v?.wordName||""))return {changed:false,blob};
 try{const zip=await JSZip.loadAsync(blob),file=zip.file("word/document.xml");if(!file)return {changed:false,blob};const xml=await file.async("string"),clean=removeProposalStatusParagraphs(xml);if(!clean.changed)return {changed:false,blob};zip.file("word/document.xml",clean.xml);const fixed=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});await putDocBlob(v.wordKey,fixed);v.publishedStatusCleanedAt=nowBR();auditAdmin(`SIASH Docs: ${d.code} Word vigente saneado: removida marca textual de proposta após publicação, sem criar revisão ou alterar vigência.`);save();return {changed:true,blob:fixed}}catch(err){console.error("Falha ao sanear marca de proposta do Word vigente",err);return {changed:false,blob}}
}
async function openDocVersion(docIndex,versionIndex,kind){
 const d=S.docs[docIndex],v=d?.versions?.[versionIndex];if(!v)return alert("Versão não localizada.");
 const key=v[kind+"Key"],path=v[kind+"Path"],name=v[kind+"Name"]||`${d.code}_Rev${v.revision}.${kind==="pdf"?"pdf":"docx"}`;
 try{
   if(key){let blob=await getDocBlob(key);if(!blob)return alert("Arquivo local não localizado neste navegador.");if(kind==="word"&&v.workflow==="Vigente"){const pubSan=await sanitizePublishedWordStatus(d,v,blob);if(pubSan.blob)blob=pubSan.blob;if(pubSan.changed)showToast("Word vigente saneado · marca de proposta removida",2200)}if(kind==="word"&&v.publicationPrepared){const san=await sanitizePreparedWordBlob(d,v);if(san.blob)blob=san.blob;if(san.changed)showToast("Word preparado saneado · reabra e confira a paginação",2200)}const url=URL.createObjectURL(blob);if(kind==="pdf"){window.open(url,"_blank");setTimeout(()=>URL.revokeObjectURL(url),60000)}else{const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}return}
   if(path){const url=encodeURI(path);if(kind==="pdf")window.open(url,"_blank");else{const a=document.createElement("a");a.href=url;a.download=name||path.split("/").pop();document.body.appendChild(a);a.click();a.remove();setTimeout(()=>a.remove(),50)}return}
   alert("Esta versão não possui arquivo "+kind.toUpperCase()+".")
 }catch(err){console.error(err);alert("Não foi possível abrir o arquivo. Verifique as permissões do navegador.")}
}
window.openDocVersion=openDocVersion;

function renderDocAccessList(){
 const el=$("doc-access-list");if(!el)return;
 const a=docAccessState(),rows=Object.entries(a);
 el.innerHTML=rows.length?rows.map(([u,x])=>`<div class="doc-access-row"><strong>${safe(u)}</strong><span>${safe(x.sector)} · ${x.level==="validator"?"Validador/Aprovador":x.level==="editor"?"Editor/Revisor":"Leitor"}</span>${isOwner()?`<button class="ghost compact-btn" onclick="removeDocAccess('${u.replace(/'/g,"\\'")}')">Remover</button>`:""}</div>`).join(""):'<span class="muted">Nenhum acesso documental específico cadastrado.</span>';
}
window.removeDocAccess=user=>{if(!requireOwner("a gestão de acessos documentais"))return;const sec=securityState()||{};sec.docAccess=sec.docAccess||{};delete sec.docAccess[user];setSecurityState(sec);auditAdmin(`Acesso documental removido: ${user}`);applyPermissions();renderDocs()}
// v0.14.11 — resultado da auditoria científica retroativa. Nenhum documento é alterado automaticamente.
const SCIENTIFIC_AUDIT_UI={
 "LEG-UTIN-032":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Reavaliar critérios fixos de preparo do box por peso/idade gestacional e condição clínica.","Atualizar equipamentos/insumos e inserir referências atuais."]},
 "LEG-UTIN-031":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Resolver inconsistências do selo d'água/profundidade e atualizar segurança da drenagem torácica.","Atualizar referências específicas."]},
 "LEG-UTIN-030":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Reavaliar faixas fixas de temperatura e umidade conforme IG, peso, dias de vida e servo-controle.","Atualizar bibliografia de termorregulação."]},
 "LEG-UTIN-027":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Revisar horários rígidos, metas conflitantes de saturação e regras fixas nas primeiras 72h.","Atualizar referências de neuroproteção/manipulação mínima."]},
 "LEG-UTIN-026":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Reavaliar indicação, contraindicações, materiais, volumes e técnica da lavagem gástrica.","Atualizar referências atuais."]},
 "LEG-UTIN-024":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Atualizar critérios de banho/higiene, coto umbilical e produtos conforme estabilidade/IG.","Atualizar referências neonatais."]},
 "LEG-UTIN-023":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Alinhar à ANVISA vigente, 5 momentos e uso correto da preparação alcoólica.","Reavaliar regra fixa de 3–5 mL e atualizar referências."]},
 "LEG-UTIN-022":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Definir solução/produto e técnica de higiene oral, especialmente em intubados.","Atualizar frequência, avaliação da mucosa e referências."]},
 "LEG-UTIN-020":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Vincular desinfetantes ao fabricante/CCIH e reavaliar periodicidade fixa.","Atualizar referências de incubadoras/equipamentos."]},
 "LEG-UTIN-018":{status:"review",label:"Revisão necessária",button:"Revisar agora",findings:["Atualizar fototerapia, irradiância e distância conforme equipamento/fabricante.","Atualizar diretrizes e referências."]},
 "LEG-UTIN-029":{status:"adjust",label:"Ajuste recomendado",button:"Ajustar",findings:["Atualizar bibliografia, pele/eletrodos, gel conforme fabricante e alarmes individualizados."]},
 "LEG-UTIN-019":{status:"adjust",label:"Ajuste recomendado",button:"Ajustar",findings:["Atualizar humanização do luto, fluxo institucional e situações médico-legais."]},
 "LEG-UTIN-017":{status:"adjust",label:"Ajuste recomendado",button:"Ajustar",findings:["Atualizar referências de pele neonatal e confirmar recomendações fixas de antissépticos/adesivos/umidade."]},
 "LEG-UTIN-021":{status:"confirmed",label:"Confirmado",button:"",findings:["Conteúdo técnico auditado como adequado; modernização bibliográfica futura recomendada."]},
 "LEG-UTIN-025":{status:"confirmed",label:"Confirmado",button:"",findings:["Revisão ampla auditada como adequada; manter validação profissional."]}
};
const SCIENTIFIC_AUDIT_UI_BASELINE="2026-09-08";
function scientificAuditForDoc(d){
 const audit=SCIENTIFIC_AUDIT_UI[String(d?.code||"").trim()]||null;if(!audit)return null;
 // v0.14.17 — a auditoria v0.14.11 é um retrato retroativo. Depois que uma nova revisão
 // é validada/publicada após essa auditoria, seus achados deixam de ser uma pendência ativa.
 // Assim o selo e o botão "Revisar agora/Ajustar" não reaparecem em um POP já atualizado.
 const pub=docPublishedVersion(d),reviewDate=String(pub?.reviewDate||"").trim();
 if(pub?.workflow==="Vigente"&&/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)&&reviewDate>SCIENTIFIC_AUDIT_UI_BASELINE)return null;
 return audit;
}
function auditedRevisionButton(i,d){const a=scientificAuditForDoc(d);if(!a||a.status==="confirmed"||!canDocEdit(d))return"";const cls=a.status==="review"?"primary":"secondary";return `<button class="${cls} compact-btn" onclick="startAuditedDocRevision(${i})">${safe(a.button)}</button>`}
window.startAuditedDocRevision=i=>{const d=S.docs?.[i],a=scientificAuditForDoc(d);if(!d||!a)return window.startDocRevision(i);window.startDocRevision(i);const box=$("doc-ai-request-text");if(box)box.value+=`\n\nAUDITORIA CIENTÍFICA SIASH (${a.label.toUpperCase()}):\n- ${a.findings.join("\n- ")}\nA revisão deve confrontar obrigatoriamente estes pontos com pesquisa web atual e fontes específicas oficiais/técnicas. Não renovar a vigência apenas por ausência de mudança aparente.`;const st=$("doc-update-status");if(st)st.textContent=`${d.code} — ${d.title}: ${a.label}. Os achados da auditoria foram incorporados como pontos obrigatórios da revisão.`}
function renderDocs(){
 const sectors=[...new Set((S.docs||[]).map(d=>d.sector||"Sem setor"))].sort();
 if($("doc-sector-filter")){const cur=$("doc-sector-filter").value;$("doc-sector-filter").innerHTML='<option value="">Todos os setores</option>'+sectors.map(s=>`<option>${safe(s)}</option>`).join("");$("doc-sector-filter").value=sectors.includes(cur)?cur:"";}
 renderDocAccessList();

 const allStatuses=S.docs.map(docStatus);
 $("docs-total").textContent=S.docs.length;
 $("docs-valid").textContent=allStatuses.filter(x=>x.key==="valid").length;
 $("docs-soon").textContent=allStatuses.filter(x=>x.key==="soon").length;
 if($("docs-priority"))$("docs-priority").textContent=allStatuses.filter(x=>x.key==="priority"||x.key==="review").length;
 $("docs-expired").textContent=allStatuses.filter(x=>x.key==="expired").length;
 const q=($("doc-search")?.value||"").trim().toLowerCase(),filter=$("doc-filter")?.value||"",sectorFilter=$("doc-sector-filter")?.value||"";
 const rows=S.docs.map((d,i)=>({d,i,s:docStatus(d)})).filter(({d,s})=>(!sectorFilter||d.sector===sectorFilter)&&(!q||`${d.title} ${d.code} ${d.sector}`.toLowerCase().includes(q))&&(!filter||s.key===filter));
 $("docs-list-count").textContent=`${rows.length} documento(s)`;
 $("docs-table").innerHTML=rows.map(({d,i,s})=>{
   const pubI=docPublishedIndex(d),pub=docPublishedVersion(d),work=docWorkingVersion(d),workI=docWorkingIndex(d);
   const workflow=work?(workI!==pubI?`${safe(work.workflow)} · Rev. ${safe(work.revision)}`:safe(work.workflow)):"—";
   const proposalI=(d.versions||[]).findIndex((v,vi)=>vi!==pubI&&v.workflow!=="Obsoleto"),proposal=proposalI>=0?d.versions[proposalI]:null,hasProposalFile=!!(proposal&&(proposal.pdf||proposal.pdfBlobId||proposal.pdfPath||proposal.pdfKey||proposal.wordKey||proposal.wordPath));
   // v0.14.4 — ações críticas da proposta ficam somente no painel contextual da revisão aberta.
   // A lista principal não executa preparar/finalizar/corrigir diretamente; isso evita que um histórico
   // deixado aberto de outro POP induza o usuário a acionar uma proposta diferente por engano.
   const auditAction=auditedRevisionButton(i,d),standardUpdate=(!auditAction&&canDocEdit(d))?`<button class="ghost compact-btn" onclick="startDocRevision(${i})">Atualizar com IA</button>`:"";const ownerActions=`${auditAction||standardUpdate} ${isOwner()&&pub?`<button class="secondary compact-btn owner-only" onclick="restoreCurrentWord(${i})">Restaurar Word vigente</button>`:""} ${proposal?`<button class="secondary compact-btn" onclick="openDocProposal(${i})">Abrir revisão proposta</button>`:""}${isOwner()&&!d.seed?` <button class="danger compact-btn owner-only" onclick="deleteDoc(${i})">Excluir</button>`:""}`;
   const audit=scientificAuditForDoc(d),auditBadge=audit?`<br><small><strong>${safe(audit.label)}</strong></small>`:"";return `<tr><td><strong>${safe(d.title)}</strong>${auditBadge}<br><small>${safe(d.sector)}${d.type?` · ${safe(d.type)}`:""}</small></td><td>${safe(d.code)}</td><td>${safe(pub?.revision||"—")}</td><td>${dateBR(pub?.reviewDate||"")}</td><td>${dateBR(s.next)}</td><td class="${s.cls}">${s.text}</td><td class="${workflowClass(work?.workflow)}">${workflow}</td><td>${pubI>=0?docsVersionButtons(i,pubI):"—"}</td><td><button class="ghost compact-btn" onclick="showDocHistory(${i})">Histórico</button> ${ownerActions}</td></tr>`
 }).join("")||'<tr><td colspan="9">Nenhum documento localizado com os filtros atuais.</td></tr>';
 applyPermissions();
}
window.startDocRevision=i=>{
 const d=S.docs[i];if(!canDocEdit(d))return alert("Seu perfil documental não permite revisar documentos deste setor.");
 const pub=docPublishedVersion(d),pubI=docPublishedIndex(d),n=parseInt(String(pub?.revision||"0").replace(/\D/g,"")||"0",10)+1,rev=String(n).padStart(2,"0");
 const proposalI=(d.versions||[]).findIndex((v,vi)=>vi!==pubI&&String(v.revision)===rev&&v.workflow!=="Obsoleto"),proposal=proposalI>=0?d.versions[proposalI]:null;
 $("doc-revision-index").value=i;$("doc-revision-name").textContent=`${d.code} · próxima revisão ${rev}`;$("doc-selected-title").textContent=d.title;$("doc-revision-number").value=rev;$("doc-revision-date").value=todayISO();$("doc-revision-workflow").value="Em revisão";$("doc-revision-period").value=String(d.period||24);$("doc-revision-note").value=proposal?.note||"";$("doc-revision-sources").value=proposal?.sources||"";$("doc-revision-pdf").value="";$("doc-revision-word").value="";
 const hasWord=!!(pub?.wordKey||pub?.wordPath),hasPdf=!!(pub?.pdfKey||pub?.pdfPath);$("doc-update-status").textContent=`POP selecionado: ${d.code} — ${d.title} · revisão vigente ${pub?.revision||"—"} · ${hasWord?"Word disponível":hasPdf?"PDF disponível":"arquivo não localizado"}`;
 $("doc-open-current").disabled=!(hasWord||hasPdf);$("doc-open-current").onclick=()=>{if(hasWord)return openDocVersion(i,pubI,"word");if(hasPdf)return openDocVersion(i,pubI,"pdf")};
 const req=`Atualizar o POP ${d.code} — ${d.title}, atualmente na revisão ${pub?.revision||"vigente"}. Usar o arquivo vigente como base, preservar a estrutura institucional e produzir a Revisão ${rev}. Pesquisar referências oficiais e atuais pertinentes ao tema, priorizando Ministério da Saúde, ANVISA, SBP, COFEN/COREN e demais órgãos competentes, complementando com diretrizes e literatura científica revisada por pares quando necessário. Entregar Word editável e, quando possível, PDF; informar o que mudou, justificativas e referências utilizadas. Não publicar sem validação profissional.`;$("doc-ai-request-text").value=req;$("doc-send-ai").onclick=()=>sendDocToAI(i);
 renderProposalReady(i,proposalI);
 $("doc-revision-panel").classList.remove("hidden");$("doc-revision-panel").scrollIntoView({behavior:"smooth",block:"start"})
}
window.sendDocToAI=async(i,options={})=>{
 const d=S.docs[i],pub=docPublishedVersion(d),pubI=docPublishedIndex(d);if(!d||!pub)return alert("Versão vigente não localizada.");
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return alert("A atualização automática com IA está disponível somente na SIASH Cloud.");
 if(!(pub.wordKey||pub.wordPath))return alert("Para preservar a estrutura institucional, a revisão automática exige o arquivo Word vigente. Migre/anexe o Word antes de continuar.");
 const rev=$("doc-revision-number").value.trim();if(options.expectedRevision&&String(options.expectedRevision)!==rev)throw new Error("A revisão ativa mudou durante o pedido de correção. Reabra a proposta antes de continuar.");if(!options.skipConfirm&&!confirm(`Gerar com IA a proposta de revisão ${rev} de ${d.code}? A versão vigente NÃO será substituída nem publicada.`))return;
 const btn=$("doc-send-ai"),status=$("doc-update-status");btn.disabled=true;status.textContent="IA analisando o POP e preparando uma proposta técnica... Isso pode levar alguns minutos.";
 try{
   if(isLegacyWordName(pub.wordName||pub.wordPath||"")){status.textContent="Word antigo .doc identificado. Convertendo com segurança para .docx antes da revisão...";await ensureVersionWordIsDocx(d,pub);save();renderDocs()}
   let blob,revisionBase=pub;
   if(options.correctionRegeneration){const existing=(d.versions||[]).find((x,xi)=>xi!==pubI&&String(x.revision)===rev&&x.workflow!=="Obsoleto");if(existing&&(existing.wordKey||existing.wordPath))revisionBase=existing}
   if(revisionBase.wordKey)blob=await getDocBlob(revisionBase.wordKey);else{const r=await fetch(revisionBase.wordPath);if(!r.ok)throw new Error(options.correctionRegeneration?"Word da revisão proposta não pôde ser aberto.":"Word vigente não pôde ser aberto.");blob=await r.blob()}
   if(!blob)throw new Error(options.correctionRegeneration?"Arquivo Word da revisão proposta não localizado.":"Arquivo Word vigente não localizado.");const buf=await blob.arrayBuffer(),bytes=new Uint8Array(buf);let bin="";for(let o=0;o<bytes.length;o+=0x8000)bin+=String.fromCharCode(...bytes.subarray(o,o+0x8000));
   const revisionStatus=docStatus(d),periodicReviewRequired=!!d.reviewRequired||["review","expired","priority","soon"].includes(revisionStatus.key);
   const periodicReviewReason=periodicReviewRequired?(`Revisão documental ${revisionStatus.text||"programada"}${revisionStatus.next?` · próxima revisão prevista: ${dateBR(revisionStatus.next)}`:""}`):"Atualização técnica solicitada pelo profissional";
   const privacyCheck=await localDocPrivacyCheck(blob);if(privacyCheck.length)throw new Error(`LGPD: identificadores potencialmente sensíveis detectados no Word (categorias: ${privacyCheck.join(", ")}). Revise e sanitize antes de enviar à IA.`);
    const ai=await cloudJson("/api/ai/revise-pop",{method:"POST",body:JSON.stringify({doc_code:d.code,doc_title:d.title,current_revision:options.correctionRegeneration?rev:pub.revision,next_revision:rev,file_name:revisionBase.wordName||pub.wordName||`${d.code}.docx`,file_base64:btoa(bin),provider:S.settings?.aiProvider||"auto",correction_request:((d.versions||[]).find((x,xi)=>xi!==pubI&&String(x.revision)===rev&&x.workflow!=="Obsoleto")?.correctionRequested||""),periodic_review_required:periodicReviewRequired,periodic_review_reason:periodicReviewReason})});
   const out=Uint8Array.from(atob(ai.file_base64),c=>c.charCodeAt(0)),proposalBlob=new Blob([out],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
   let vi=d.versions.findIndex((v,x)=>x!==pubI&&String(v.revision)===rev&&v.workflow!=="Obsoleto"),v=vi>=0?d.versions[vi]:null;if(!v){v={revision:rev,reviewDate:todayISO(),workflow:"Em revisão",createdBy:"SIASH Docs / IA",createdAt:nowBR()};d.versions.push(v);vi=d.versions.length-1}
   const periodicReviewOnly=ai.verification?.periodicReviewOnly===true,actualChanges=Number(ai.verification?.actualChanges||0),professionalWarnings=[...(ai.verification?.validationWarnings||[]),...(ai.validationWarnings||[])].filter(Boolean),requiresProfessionalReview=ai.verification?.requiresProfessionalReview===true||ai.requiresProfessionalReview===true||professionalWarnings.length>0||actualChanges===0;
   if(!ai.verification||!ai.file_base64)throw new Error("A resposta da revisão não contém um Word válido para conferência. A proposta anterior foi preservada.");
   if(!ai.verification.verified){professionalWarnings.push("A verificação automática de integridade não foi concluída. Confira integralmente o Word antes de preparar a publicação.");}
   if(actualChanges===0&&!periodicReviewOnly)professionalWarnings.push("Nenhuma nova alteração textual foi comprovada neste ciclo de correção. O Word da mesma revisão foi preservado para conferência profissional.");
   v.publicationPrepared=false;v.publicationPreparedAt="";v.publicationPreparedBy="";v.preparedInstitutionalRevision="";v.periodicReviewOnly=periodicReviewOnly;v.aiSummary=String(ai.summary||"").replace(/\s+/g," ").trim();if(periodicReviewOnly&&!v.aiSummary)v.aiSummary="Conteúdo técnico mantido sem alterações após revisão periódica assistida.";v.note=periodicReviewOnly?`PROPOSTA de revisão periódica verificada pelo SIASH. Conteúdo técnico mantido sem alterações. A vigência somente será renovada após conferência e aprovação profissional. ${v.aiSummary}`:`PROPOSTA gerada por IA para conferência profissional (${actualChanges} alteração(ões) comprovada(s) neste ciclo). ${v.aiSummary}${professionalWarnings.length?` Alertas: ${[...new Set(professionalWarnings)].join(" | ")}`:""}`;v.aiReferences=(ai.references||[]).map(x=>({title:x.title||"",url:x.url||"",year:x.year||x.publicationYear||x.ano||"",institution:x.institution||x.sourceInstitution||"",status:x.status||"pending",reason:x.reason||"",wordEligible:x.wordEligible===true,wordEligibilityReason:x.wordEligibilityReason||""}));v.sources=v.aiReferences.map(x=>`${x.title}: ${x.url}${x.wordEligible?"":" [somente auditoria SIASH — não inserida no Word]"}`).join("\n");v.aiProvider=ai.provider||"—";v.aiModel=ai.model;v.aiResearchMode=ai.researchMode||"sem_pesquisa_externa";v.docxPreparedIntegrity=ai.docxPreparedIntegrity?.zipCrc32===true&&ai.docxPreparedIntegrity?.ooxml===true;v.aiVerified=ai.verification?.verified===true;v.aiVerification={...(ai.verification||{}),validationWarnings:[...new Set(professionalWarnings)],requiresProfessionalReview};v.requiresProfessionalReview=requiresProfessionalReview;v.aiChanges=(ai.changes||[]).map(x=>({paragraph_index:x.paragraph_index,before_text:x.before_text,new_text:x.new_text,reason:x.reason,references:Array.isArray(x.references)?x.references:[]}));v.wordKey=`${d.id}|${rev}|word|${Date.now()}`;v.wordName=ai.file_name||`${d.code}_Rev${rev}_PROPOSTA_IA.docx`;await putDocBlob(v.wordKey,new File([proposalBlob],v.wordName,{type:proposalBlob.type}));
   if(options.correctionRegeneration)v.correctionAppliedAt=nowBR();auditAdmin(options.correctionRegeneration?`SIASH Docs: ${d.code} revisão ${rev} regenerada pela IA após correção profissional.`:`SIASH Docs: ${d.code} revisão ${rev} gerada automaticamente com IA para conferência profissional.`);save();renderDocs();renderProposalReady(i,vi);showDocHistory(i);const mode=["google_search","web_search"].includes(ai.researchMode)?"com pesquisa web atual":"sem pesquisa web automática";status.textContent=periodicReviewOnly?`Revisão periódica ${rev} preparada com ${ai.provider||"IA"} (${ai.model||"modelo"}), sem alteração técnico-científica necessária. A vigência só será renovada após conferência e publicação humana.`:`Proposta ${rev} gerada com ${ai.provider||"IA"} (${ai.model||"modelo"}), ${mode}. Abra o Word atualizado, confira referências e conteúdo e somente depois aprove.`;showToast(periodicReviewOnly?"Revisão periódica pronta para conferência":"Proposta de revisão gerada pela IA",2200);return {ok:true,revision:rev,correctionRegeneration:!!options.correctionRegeneration}
 }catch(e){console.error(e);status.textContent="A proposta não foi gerada.";alert(e.message||"Falha na atualização com IA.");return {ok:false,error:e}}finally{btn.disabled=false}
}
function aiProviderLabel(p){const x=String(p||"").toLowerCase();if(x==="cloudflare")return "Cloudflare Workers AI";if(x==="gemini")return "Gemini";if(x==="openai")return "OpenAI";return p||"IA"}
// v0.14.4 — contexto explícito e estável da revisão aberta. Índice visual sozinho não autoriza ação crítica.
let ACTIVE_DOC_PROPOSAL=null;
function setActiveDocProposal(i,vi){const d=S.docs?.[i],v=d?.versions?.[vi];ACTIVE_DOC_PROPOSAL=(d&&v)?{docId:String(d.id||""),code:String(d.code||""),revision:String(v.revision||""),wordKey:String(v.wordKey||v.wordPath||"")}:null;return ACTIVE_DOC_PROPOSAL}
function proposalContextMatches(i,vi){const d=S.docs?.[i],v=d?.versions?.[vi],a=ACTIVE_DOC_PROPOSAL;if(!d||!v||!a)return false;return a.docId===String(d.id||"")&&a.code===String(d.code||"")&&a.revision===String(v.revision||"")&&a.wordKey===String(v.wordKey||v.wordPath||"")}
function requireProposalContext(i,vi){if(proposalContextMatches(i,vi))return true;const d=S.docs?.[i],v=d?.versions?.[vi];alert(`Ação bloqueada por segurança: a revisão ativa na tela não corresponde ao documento solicitado${d&&v?` (${d.code} · revisão ${v.revision})`:""}. Reabra a revisão proposta antes de continuar.`);return false}
function openProposalWorkspace(i,proposalI){
 const d=S.docs?.[i],v=d?.versions?.[proposalI];if(!d||!v)return false;
 const pubI=docPublishedIndex(d),pub=pubI>=0?d.versions?.[pubI]:null;
 $("doc-revision-index").value=i;$("doc-revision-name").textContent=`${d.code} · revisão proposta ${v.revision}`;$("doc-selected-title").textContent=d.title;
 $("doc-revision-number").value=String(v.revision||"");$("doc-revision-date").value=v.reviewDate||todayISO();$("doc-revision-workflow").value=v.workflow||"Em revisão";$("doc-revision-period").value=String(d.period||24);
 $("doc-revision-note").value=v.note||"";$("doc-revision-sources").value=v.sources||"";$("doc-revision-pdf").value="";$("doc-revision-word").value="";
 const hasWord=!!(pub?.wordKey||pub?.wordPath),hasPdf=!!(pub?.pdfKey||pub?.pdfPath);
 $("doc-update-status").textContent=`Revisão proposta aberta: ${d.code} — ${d.title} · revisão ${v.revision}. Versão vigente: ${pub?.revision||"—"}.`;
 $("doc-open-current").disabled=!(hasWord||hasPdf);$("doc-open-current").onclick=()=>{if(hasWord)return openDocVersion(i,pubI,"word");if(hasPdf)return openDocVersion(i,pubI,"pdf")};
 $("doc-send-ai").onclick=()=>sendDocToAI(i);
 $("doc-history-panel")?.classList.add("hidden");$("doc-revision-panel")?.classList.remove("hidden");
 renderProposalReady(i,proposalI);
 requestAnimationFrame(()=>$("doc-proposal-ready")?.scrollIntoView({behavior:"smooth",block:"center"}));
 return true
}
window.openDocProposal=i=>{
 const d=S.docs?.[i];if(!d)return alert("Documento não localizado.");
 const pubI=docPublishedIndex(d),proposalI=(d.versions||[]).findIndex((v,vi)=>vi!==pubI&&v.workflow!=="Obsoleto");
 if(proposalI<0)return alert("Este documento não possui revisão proposta aberta.");
 if(!openProposalWorkspace(i,proposalI))return alert("Não foi possível restaurar o contexto completo desta revisão proposta.");
}
function renderProposalReady(i,vi){const box=$("doc-proposal-ready"),actions=$("doc-proposal-actions");if(!box||!actions)return;const d=S.docs[i],v=(vi>=0?d?.versions?.[vi]:null);const hasFile=!!(v&&(v.wordKey||v.wordPath||v.pdfKey||v.pdfPath));box.classList.toggle("hidden",!hasFile);if(!hasFile){ACTIVE_DOC_PROPOSAL=null;actions.innerHTML="";return}setActiveDocProposal(i,vi);const n=Number(v.aiVerification?.actualChanges||v.aiChanges?.length||0),verified=v.aiVerified===true,periodicOnly=v.periodicReviewOnly===true||v.aiVerification?.periodicReviewOnly===true;const aiTrace=v.aiProvider?` IA utilizada: ${aiProviderLabel(v.aiProvider)}${v.aiModel?` · ${v.aiModel}`:""}.`:"";$("doc-proposal-ready-text").textContent=`${d.code} — ${d.title} · revisão ${v.revision}. `+(verified?(periodicOnly?`Revisão periódica validada pelo SIASH: conteúdo técnico mantido sem alterações.${aiTrace} A nova vigência só será efetivada após conferência e aprovação profissional.`:`SIASH comprovou ${n} alteração(ões) real(is) no Word.${aiTrace} Abra e confira antes de aprovar.`):`Proposta disponível para conferência.${aiTrace} Esta proposta foi criada antes da verificação automática da v0.12.8; confira o Word com atenção.`);const scientificRefs=(v.aiReferences||[]).filter(x=>x.wordEligible===true&&/^https:\/\//i.test(String(x.url||"")));
const evidencePanel=`<section class="doc-scientific-audit" aria-label="Conferência científica e integridade documental"><strong>Conferência Técnica Assistida</strong><p>IA: ${safe(aiProviderLabel(v.aiProvider||"não informado"))} · Pesquisa: ${safe(v.aiResearchMode||"canal não registrado")}</p><p>DOCX / ZIP / CRC32: ${v.docxIntegrityValidated===true?"Íntegro (validação final registrada)":v.docxPreparedIntegrity===true?"Íntegro na proposta (ZIP/CRC32/OOXML); validação final pendente":"Não confirmado — validar antes de publicar"}</p><strong>Referências científicas verificadas (${scientificRefs.length})</strong><ul>${scientificRefs.map(ref=>`<li>${safe(ref.title||"Sem título")} ${safe(ref.institution||"")} ${safe(ref.year||"")} — <a href="${safe(ref.url)}" target="_blank" rel="noopener noreferrer">Fonte oficial</a></li>`).join("")}</ul></section>`;
const diffBtn=v.aiChanges?.length?`<button class="ghost" type="button" onclick="showAIChanges(${i},${vi})">VER ALTERAÇÕES APLICADAS</button>`:"";actions.innerHTML=`${evidencePanel}${v.wordKey||v.wordPath?`<button class="secondary" type="button" onclick="openDocVersion(${i},${vi},'word')">ABRIR WORD ATUALIZADO</button>`:""}${v.pdfKey||v.pdfPath?`<button class="secondary" type="button" onclick="openDocVersion(${i},${vi},'pdf')">ABRIR PDF ATUALIZADO</button>`:""}${diffBtn}${v.publicationPrepared?`<button class="primary" type="button" onclick="finalizePreparedPublication(${i},${vi})">FINALIZAR PUBLICAÇÃO</button>`:`<button class="primary" type="button" onclick="validateDocProposal(${i},${vi})">PREPARAR PUBLICAÇÃO</button>`}<button class="ghost" type="button" onclick="requestDocCorrection(${i},${vi})">SOLICITAR CORREÇÃO</button>`}
window.showAIChanges=(i,vi)=>{const d=S.docs?.[i],v=d?.versions?.[vi],changes=v?.aiChanges||[];if(!changes.length)return alert("Esta proposta não possui detalhamento das alterações disponível.");const dlg=$("doc-ai-changes-dialog"),list=$("doc-ai-changes-list");if(!dlg||!list)return;$("doc-ai-changes-title").textContent=`${d.code} — ${d.title} · revisão ${v.revision}${v.aiProvider?` · IA: ${aiProviderLabel(v.aiProvider)}${v.aiModel?` (${v.aiModel})`:""}`:""}`;const globalRefs=String(v.sources||"").split(/\n+/).map(x=>x.trim()).filter(Boolean);list.innerHTML=changes.map((c,n)=>{const refs=(c.references||[]).length?c.references:globalRefs;return `<article class="doc-diff-item"><h4>Alteração ${n+1}</h4><div class="doc-diff-grid"><div class="doc-diff-box"><strong>ANTES</strong>${safe(c.before_text||"(não registrado)")}</div><div class="doc-diff-box"><strong>DEPOIS</strong>${safe(c.new_text||"(não registrado)")}</div></div><div class="doc-diff-reason"><strong>JUSTIFICATIVA:</strong> ${safe(c.reason||"—")}</div><div class="doc-diff-ref"><strong>REFERÊNCIA:</strong> ${refs.length?refs.map(r=>safe(typeof r==="string"?r:(r.title?`${r.title}${r.url?`: ${r.url}`:""}`:r.url||"—"))).join("<br>"):"Referência específica não vinculada; conferir as fontes gerais da revisão."}</div></article>`}).join("");dlg.showModal?dlg.showModal():dlg.setAttribute("open","")}
$("doc-ai-changes-close")?.addEventListener("click",()=>$("doc-ai-changes-dialog")?.close());
function cancelDocRevision(){$("doc-revision-panel").classList.add("hidden");$("doc-revision-form").reset()}
window.showDocHistory=i=>{
 const d=S.docs[i];$("doc-history-name").textContent=`${d.code} — ${d.title}`;
 $("doc-history-table").innerHTML=d.versions.map((v,vi)=>`<tr><td>${safe(v.revision)}</td><td>${dateBR(v.reviewDate)}</td><td class="${workflowClass(v.workflow)}">${safe(v.workflow)}</td><td>${safe(v.createdBy||"—")}</td><td class="docs-note-cell">${safe(v.note||"—")}${v.aiProvider?`<br><small><strong>IA:</strong> ${safe(aiProviderLabel(v.aiProvider))}${v.aiModel?` · ${safe(v.aiModel)}`:""}</small>`:""}${v.sources?`<br><small><strong>Fontes:</strong> ${safe(v.sources)}</small>`:""}${v.validator?`<br><small>Validado por: ${safe(v.validator)} · ${dateBR(v.validationDate||"")}</small>`:""}</td><td>${docsVersionButtons(i,vi)}</td></tr>`).join("");
 $("doc-history-panel").classList.remove("hidden");$("doc-history-panel").scrollIntoView({behavior:"smooth",block:"start"});applyPermissions()
}
window.advanceDocVersion=(i,vi)=>{
 if(!requireOwner("a alteração do fluxo de aprovação documental"))return;
 const d=S.docs[i],v=d?.versions?.[vi];if(!v)return;const sequence=["Em elaboração","Em revisão","Aguardando aprovação","Vigente"],pos=sequence.indexOf(v.workflow);if(pos<0||pos===sequence.length-1)return alert("Esta revisão não pode avançar mais.");
 const next=sequence[pos+1];if(next==="Vigente"){if(!(v.pdf||v.pdfBlobId||v.pdfPath))return alert("Validação bloqueada: esta revisão ainda não possui PDF atualizado para conferência.");if(!v.validator)v.validator=(prompt("Informe o nome do profissional que validou esta revisão:")||"").trim();if(!v.validator)return alert("A publicação foi interrompida: a validação profissional é obrigatória.");if(!v.validationDate)v.validationDate=prompt("Informe a data da validação (AAAA-MM-DD):",todayISO())||"";if(!/^\d{4}-\d{2}-\d{2}$/.test(v.validationDate))return alert("Informe uma data de validação válida no formato AAAA-MM-DD.");if(!confirm(`Publicar a revisão ${v.revision} como VIGENTE? A versão vigente anterior será marcada como obsoleta.`))return;d.versions.forEach((x,xv)=>{if(xv!==vi&&x.workflow==="Vigente")x.workflow="Obsoleto"})}
 v.workflow=next;v.updatedAt=nowBR();auditAdmin(`SIASH Docs: ${d.code} revisão ${v.revision} avançou para ${next}.`);save();showDocHistory(i);showToast(`Revisão ${v.revision}: ${next}`,1400)
}

function xmlEscapeText(s=""){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function currentMonthYearPT(){const m=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];const d=new Date();return `${m[d.getMonth()]}/${d.getFullYear()}`}
function xmlPlainText(fragment=""){return String(fragment||"").replace(/<w:tab\/?[^>]*>/gi," ").replace(/<w:br\/?[^>]*>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/\s+/g," ").trim()}
function historyTableData(xml){
 // v0.14.12b — não presume que o texto "Controle Histórico" esteja no início da tabela.
 // Examina cada tabela completa e aceita apenas a que tenha evidência estrutural de histórico:
 // título/cabeçalho de revisão OU ao menos uma linha numérica com >= 7 células.
 const tables=[...String(xml||"").matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)].map(x=>x[0]);
 for(const table of tables){
   const rows=[...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(x=>x[0]);
   const info=rows.map(row=>{const cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(x=>xmlPlainText(x[0]));return {row,cells,revision:(cells.length>=7&&/^\d{1,3}$/.test(cells[0]))?Number(cells[0]):null}});
   const plain=xmlPlainText(table),hasTitle=/Controle\s+Hist[óo]rico/i.test(plain),hasHeader=/(?:^|\s)Revis[aã]o(?:\s|$)/i.test(plain)&&/(?:Data|Hist[óo]rico|Elabora[cç][aã]o|Verifica[cç][aã]o|Aprova[cç][aã]o)/i.test(plain),hasRevision=info.some(x=>x.revision!==null);
   if((hasTitle||hasHeader)&&hasRevision)return {table,rows,info};
 }
 return null;
}
function nextInstitutionalRevisionFromXml(xml){const h=historyTableData(xml);if(!h)return null;const nums=h.info.filter(x=>x.revision!==null).map(x=>x.revision);if(!nums.length)return null;return String(Math.max(...nums)+1).padStart(2,"0")}
function normalizeMonthYearText(s=""){return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"").replace(/\//g,"/").toLowerCase()}
function priorPublishedVersion(d,v){return (d?.versions||[]).filter(x=>x!==v&&x.workflow==="Vigente").slice(-1)[0]||null}
function shouldReuseLatestInstitutionalRevision(d,v,rowInfo){
 if(!rowInfo||rowInfo.revision===null)return false;const c=rowInfo.cells||[];
 const sameCompetence=normalizeMonthYearText(c[1]||"")===normalizeMonthYearText(currentMonthYearPT());
 // v0.14.12 — uma proposta DOCX importada manualmente pode já trazer a revisão institucional
 // correta no Controle Histórico (ex.: Rev.02), embora a revisão interna da SIASH seja Rev.01.
 // Quando a importação registrou explicitamente essa revisão e ela continua sendo a última linha
 // da mesma competência, reutilizamos a linha existente. Isso impede criar Rev.03 indevidamente.
 const importedRevision=String(v?.importedInstitutionalRevision||"").padStart(2,"0");
 const rowRevision=String(rowInfo.revision).padStart(2,"0");
 if(importedRevision&&importedRevision===rowRevision&&sameCompetence)return true;
 const authoredBySiash=/SIASH\s*Docs/i.test(c[4]||"");if(!authoredBySiash)return false;
 // v0.14.3 — idempotência do ciclo institucional:
 // se a última linha institucional foi criada pelo SIASH Docs na MESMA competência (mês/ano),
 // ela é a revisão institucional do ciclo e deve ser REUTILIZADA. Revisões internas, correções,
 // reprocessamentos ou testes do mesmo ciclo não podem gerar 04→05→06 no Word.
 // Uma nova revisão institucional só é aberta quando muda a competência institucional.
 return sameCompetence;
}
function institutionalRevisionPlan(xml,d,v,{ignorePreparedRevision=""}={}){
 const h=historyTableData(xml);if(!h)return {ok:false,reason:"history-table-not-found"};
 let revs=h.info.filter(x=>x.revision!==null);
 if(ignorePreparedRevision)revs=revs.filter(x=>String(x.cells[0]).padStart(2,"0")!==String(ignorePreparedRevision).padStart(2,"0"));
 if(!revs.length)return {ok:false,reason:"history-revision-row-not-found"};
 const latest=revs.reduce((a,b)=>a.revision>b.revision?a:b);
 if(shouldReuseLatestInstitutionalRevision(d,v,latest))return {ok:true,mode:"reuse",revision:String(latest.revision).padStart(2,"0"),rowInfo:latest,history:h};
 const max=Math.max(...revs.map(x=>x.revision));return {ok:true,mode:"append",revision:String(max+1).padStart(2,"0"),rowInfo:latest,history:h};
}
function replaceCellText(tc,text){let first=true,found=false;const escaped=xmlEscapeText(text);let out=tc.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,(all,a,b,c)=>{found=true;if(first){first=false;return a+escaped+c}return a+c});if(!found)out=out.replace(/<w:tcPr[\s\S]*?<\/w:tcPr>/,m=>m+`<w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>`);return out}
function buildHistoryRowFromTemplate(row,values){let ci=0;return row.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g,tc=>replaceCellText(tc,values[ci++]??""))}
// v0.13.9+: saneamento estrutural da área final de assinatura.
function trimLegacyTrailingEmptyParagraphs(xml){
 const tables=[...xml.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)];
 for(let ti=tables.length-1;ti>=0;ti--){const table=tables[ti][0],rows=[...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)];for(let ri=rows.length-1;ri>=0;ri--){const row=rows[ri][0],cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)];for(let ci=cells.length-1;ci>=0;ci--){const cell=cells[ci][0],plain=[...cell.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1].replace(/<[^>]+>/g," ")).join(" ").replace(/\s+/g," ").trim();if(!/Assinatura\s+(?:e\s+)?Carimbo/i.test(plain))continue;const paras=[...cell.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>m[0]);if(!paras.length)return xml;let sig=-1;for(let pi=0;pi<paras.length;pi++){const t=[...paras[pi].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1]).join(" ").replace(/\s+/g," ").trim();if(/Assinatura\s+(?:e\s+)?Carimbo/i.test(t))sig=pi}if(sig<0)return xml;const kept=[];let removed=0;for(let pi=0;pi<paras.length;pi++){const para=paras[pi];if(pi<=sig){kept.push(para);continue}const text=[...para.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1]).join("").replace(/&nbsp;/g," ").trim();const hasPayload=/<w:(?:drawing|pict|object|br|fldChar|instrText|hyperlink)(?:\s|>)/.test(para);if(text||hasPayload)kept.push(para);else removed++}if(!removed)return xml;let rebuilt=cell;for(const para of paras)rebuilt=rebuilt.replace(para,"");rebuilt=rebuilt.replace(/<\/w:tc>$/,kept.join("")+"</w:tc>");return xml.replace(table,table.replace(row,row.replace(cell,rebuilt)))}}}return xml;
}
function removeInstitutionalRevisionRowXml(xml,revision){const h=historyTableData(xml);if(!h)return {ok:false,reason:"history-table-not-found",xml};const target=h.info.find(x=>x.revision!==null&&String(x.revision).padStart(2,"0")===String(revision).padStart(2,"0"));if(!target)return {ok:false,reason:"revision-row-not-found",xml};return {ok:true,xml:xml.replace(h.table,h.table.replace(target.row,""))}}
// v0.13.12: corrige POPs já contaminados por revisões institucionais intermediárias do mesmo ciclo.
// Se houver 2+ linhas SIASH Docs no mês atual (ex.: 04 e 05 em Agosto/2026), preserva a PRIMEIRA
// revisão institucional do ciclo e remove somente as posteriores antes de preparar/publicar.
function collapseDuplicateSiashInstitutionalCycleXml(xml){
 const h=historyTableData(xml);if(!h)return {ok:false,changed:false,reason:"history-table-not-found",xml};
 // Agrupa por competência gravada no próprio Controle Histórico, não pela data de hoje.
 // Assim, um POP antigo já contaminado (04/05 no mesmo mês) é autocorrigido quando for revisado novamente.
 const groups=new Map();for(const x of h.info){if(x.revision===null)continue;const c=x.cells||[];if(!/SIASH\s*Docs/i.test(c[4]||""))continue;const key=normalizeMonthYearText(c[1]||"");if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x)}
 let newTable=h.table,removed=[],kept=[];for(const [,arr0] of groups){const arr=arr0.sort((a,b)=>a.revision-b.revision);if(arr.length<=1)continue;const keep=arr[0];kept.push(String(keep.revision).padStart(2,"0"));for(const x of arr.slice(1)){newTable=newTable.replace(x.row,"");removed.push(String(x.revision).padStart(2,"0"))}}
 if(!removed.length)return {ok:true,changed:false,reason:"no-duplicate-siash-cycle",xml};
 return {ok:true,changed:true,reason:"duplicate-siash-cycle-collapsed",xml:xml.replace(h.table,newTable),keptRevisions:kept,keptRevision:kept[kept.length-1]||"",removedRevisions:removed};
}

async function normalizePreparedInstitutionalCycle(d,v){
 if(!v?.publicationPrepared||!v?.preparedInstitutionalRevision||!v?.wordKey)return {changed:false,reason:"not-prepared"};const blob=await getDocBlob(v.wordKey);if(!blob)return {changed:false,reason:"word-not-found"};
 try{const zip=await JSZip.loadAsync(blob),file=zip.file("word/document.xml");if(!file)return {changed:false,reason:"document-xml-missing"};let xml=await file.async("string");const plan=institutionalRevisionPlan(xml,d,v,{ignorePreparedRevision:v.preparedInstitutionalRevision});if(!plan.ok||plan.mode!=="reuse")return {changed:false,reason:plan.reason||"new-cycle"};const prepared=String(v.preparedInstitutionalRevision).padStart(2,"0");if(prepared===plan.revision)return {changed:false,reason:"already-target"};const rm=removeInstitutionalRevisionRowXml(xml,prepared);if(!rm.ok)return {changed:false,reason:rm.reason};xml=trimLegacyTrailingEmptyParagraphs(rm.xml);zip.file("word/document.xml",xml);const fixed=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});await putDocBlob(v.wordKey,fixed);v.publicationPrepared=false;v.publicationPreparedAt="";v.publicationPreparedBy="";v.preparedInstitutionalRevision="";v.institutionalValidity="";v.confirmedFinalPages=0;v.preparedSanitizedAt=nowBR();v.institutionalCycleTarget=plan.revision;save();return {changed:true,reason:"same-day-cycle-normalized",targetRevision:plan.revision,blob:fixed}}catch(err){console.error("Falha ao normalizar ciclo institucional preparado",err);return {changed:false,reason:"cycle-normalize-failed",blob}}
}
async function sanitizePreparedWordBlob(d,v){
 const cycle=await normalizePreparedInstitutionalCycle(d,v);if(cycle.changed){renderDocs();return {changed:true,reason:cycle.reason,blob:cycle.blob,cycleNormalized:true}};
 if(!v?.wordKey)return {changed:false,reason:"no-word-key",blob:null};const blob=await getDocBlob(v.wordKey);if(!blob)return {changed:false,reason:"word-not-found",blob:null};
 try{const zip=await JSZip.loadAsync(blob),file=zip.file("word/document.xml");if(!file)return {changed:false,reason:"document-xml-missing",blob};let xml=await file.async("string");const cleaned=trimLegacyTrailingEmptyParagraphs(xml);if(cleaned===xml)return {changed:false,reason:"already-clean",blob};zip.file("word/document.xml",cleaned);const fixed=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});const previousKey=v.wordKey;v.wordKey=`${d.id}|${v.revision}|word|sanitized-${crypto.randomUUID()}`;await putDocBlob(v.wordKey,fixed);v.previousWordKey=previousKey;v.preparedSanitizedAt=nowBR();save();return {changed:true,reason:"trailing-empty-paragraphs-removed",blob:fixed}}catch(err){console.error("Falha ao sanear Word preparado",err);return {changed:false,reason:"docx-sanitize-failed",blob}}
}
function updateInstitutionalHistoryXml(xml,validator,summary,pages,d,v){
 const plan=institutionalRevisionPlan(xml,d,v);if(!plan.ok)return {ok:false,reason:plan.reason};const {history:h}=plan,table=h.table,rows=h.rows,revisionRows=h.info.filter(x=>x.revision!==null).map(x=>x.row);if(!revisionRows.length)return {ok:false,reason:"history-revision-row-not-found"};
 const institutionalRevision=plan.revision,template=plan.rowInfo.row,rawNote=String(summary||"Revisão técnico-científica").replace(/\s+/g," ").trim(),note=((rawNote.length>100?rawNote.slice(0,97).replace(/\s+\S*$/," ").trim()+"...":rawNote)||"Revisão técnico-científica");const values=[institutionalRevision,currentMonthYearPT(),String(pages||"A conferir"),note,`SIASH Docs / ${validator}`,validator,validator];
 let newTable=table;if(plan.mode==="reuse"){const updated=buildHistoryRowFromTemplate(template,values);newTable=newTable.replace(template,updated)}else{const newRow=buildHistoryRowFromTemplate(template,values),validityRow=rows.find(r=>/Válido até|Valido ate|Vigente até|Vigente ate/i.test(r));if(validityRow)newTable=newTable.replace(validityRow,newRow+validityRow);else newTable=newTable.replace(/<\/w:tbl>$/,newRow+"</w:tbl>")}
 const dte=new Date(),period=Number(d?.period||24);if(![12,24,36].includes(period))return {ok:false,reason:"invalid-document-period"};const future=new Date(dte.getFullYear(),dte.getMonth()+period,dte.getDate()),months=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"],validity=`Válido até ${months[future.getMonth()]} de ${future.getFullYear()}, caso não haja alterações técnicas.`;const validityRowAfter=[...newTable.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(x=>x[0]).find(r=>/Válido até|Valido ate|Vigente até|Vigente ate/i.test(r));if(validityRowAfter)newTable=newTable.replace(validityRowAfter,replaceCellText(validityRowAfter,validity));
 return {ok:true,xml:xml.replace(table,newTable),institutionalRevision,validity,mode:plan.mode};
}
async function prepareApprovedWord(d,v,validator){
 if(!v?.wordKey)return {updated:false,reason:"no-word-key"};const blob=await getDocBlob(v.wordKey);if(!blob)return {updated:false,reason:"word-not-found"};const name=(v.wordName||"").toLowerCase();if(!name.endsWith(".docx"))return {updated:false,reason:"not-docx"};
 if(v.publicationPrepared&&v.preparedInstitutionalRevision){const norm=await normalizePreparedInstitutionalCycle(d,v);if(!norm.changed)return {updated:true,institutionalRevision:v.preparedInstitutionalRevision,validity:v.institutionalValidity||"",alreadyPrepared:true};}
 try{const zip=await JSZip.loadAsync(blob),file=zip.file("word/document.xml");if(!file)return {updated:false,reason:"document-xml-missing"};let xml=await file.async("string");
   const cycleClean=collapseDuplicateSiashInstitutionalCycleXml(xml);if(!cycleClean.ok)return {updated:false,reason:cycleClean.reason};xml=cycleClean.xml;
   const cleanSummary=(v.periodicReviewOnly===true||v.aiVerification?.periodicReviewOnly===true)?"Revisão periódica — conteúdo técnico mantido sem alterações técnico-científicas após análise assistida.":(String(v.aiSummary||v.note||"Revisão técnico-científica").replace(/^PROPOSTA gerada por IA e verificada pelo SIASH(?:\s*\([^)]*\))?\.?\s*/i,"").trim()||"Revisão técnico-científica");
   // v0.13.7: primeiro cria o Word FINAL estrutural, incluindo a nova linha do Controle Histórico,
   // mas deixa Nº Páginas como "A conferir". Só depois o profissional abre este Word já expandido
   // e informa a paginação real. Isso evita medir 3 páginas antes de a nova linha criar a 4ª página.
   const hist=updateInstitutionalHistoryXml(xml,validator,cleanSummary,"A conferir",d,v);if(!hist.ok)return {updated:false,reason:hist.reason};xml=trimLegacyTrailingEmptyParagraphs(hist.xml);
   const placeholder="A preencher automaticamente pelo SIASH após validação",escaped=xmlEscapeText(validator);if(xml.includes(placeholder))xml=xml.replace(placeholder,escaped);
   zip.file("word/document.xml",xml);const prepared=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});const previousKey=v.wordKey;v.wordKey=`${d.id}|${v.revision}|word|prepared-${crypto.randomUUID()}`;await putDocBlob(v.wordKey,prepared);v.previousWordKey=previousKey;
   v.publicationPrepared=true;v.publicationPreparedAt=nowBR();v.publicationPreparedBy=validator;v.preparedInstitutionalRevision=hist.institutionalRevision;v.institutionalValidity=hist.validity;v.institutionalPreparationMode=hist.mode||"append";if(cycleClean.changed){v.institutionalCycleCleanup={at:nowBR(),kept:cycleClean.keptRevision,removed:cycleClean.removedRevisions||[]}}return {updated:true,institutionalRevision:hist.institutionalRevision,validity:hist.validity,mode:hist.mode||"append",cycleCleanup:cycleClean.changed?cycleClean:null};
 }catch(err){console.error("Falha ao preparar Word final para conferência de paginação",err);return {updated:false,reason:"docx-prepare-failed"}}
}
function ensureWordTableCellParagraphs(xml){
 let changed=false;const out=String(xml||"").replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g,tc=>{if(/<w:p(?:\s|>|\/)/.test(tc))return tc;changed=true;return tc.replace(/<\/w:tc>$/,"<w:p/></w:tc>")});return {xml:out,changed};
}
function removeProposalStatusParagraphs(xml){
 let changed=false;let out=String(xml||"").replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{const text=xmlPlainText(p);const proposal=/^proposta\s+de\s+revis[aã]o\s+\d{1,3}\b/i.test(text)&&/(vig[eê]ncia|valida[cç][aã]o|publica[cç][aã]o|confer[eê]ncia)/i.test(text);if(proposal){changed=true;return "<w:p/>"}return p});const structural=ensureWordTableCellParagraphs(out);out=structural.xml;return {xml:out,changed:changed||structural.changed};
}
function finalizePublishedHistoryStatusXml(xml,institutionalRevision){
 const hist=historyTableData(xml);if(!hist)return {xml:String(xml||""),changed:false};const wanted=Number(institutionalRevision);let changed=false;const rows=hist.rows||[];let table=hist.table;
 for(const row of rows){const cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(x=>x[0]);if(!cells.length)continue;const rev=Number((xmlPlainText(cells[0]).match(/\d{1,3}/)||[])[0]);if(!Number.isFinite(rev)||rev!==wanted)continue;let updated=row;updated=updated.replace(/aguardando\s+confer[eê]ncia\s+profissional\.?/gi,()=>{changed=true;return 'validada e publicada após conferência profissional.'});if(updated!==row)table=table.replace(row,updated);break}
 if(!changed)return {xml:String(xml||""),changed:false};return {xml:String(xml||"").replace(hist.table,table),changed:true};
}
function validateWordprocessingPackageXml(xml,name="XML"){
 const text=String(xml||"");if(!text.trim())return {ok:false,reason:`${name}: vazio`};
 try{const parsed=new DOMParser().parseFromString(text,"application/xml");if(parsed.getElementsByTagName("parsererror").length)return {ok:false,reason:`${name}: XML inválido`};return {ok:true}}catch(e){return {ok:false,reason:`${name}: ${e.message}`}}
}
async function validateDocxBlobIntegrity(blob){
 if(!blob||!blob.size)return {ok:false,reason:"arquivo-vazio"};
 try{
  const zip=await JSZip.loadAsync(blob,{checkCRC32:true});
  const required=["[Content_Types].xml","_rels/.rels","word/document.xml"];
  for(const name of required)if(!zip.file(name))return {ok:false,reason:`parte-obrigatória-ausente:${name}`};
  const xmlNames=Object.keys(zip.files).filter(n=>/\.xml$/i.test(n)&&!zip.files[n].dir);
  for(const name of xmlNames){const text=await zip.file(name).async("string"),chk=validateWordprocessingPackageXml(text,name);if(!chk.ok)return chk}
  const documentXml=await zip.file("word/document.xml").async("string");
  if(!/<w:document(?:\s|>)/.test(documentXml)||!/<w:body(?:\s|>)/.test(documentXml))return {ok:false,reason:"word/document.xml sem document/body"};
  const badCell=[...documentXml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].find(m=>!/<w:p(?:\s|>|\/)/.test(m[0]));
  if(badCell)return {ok:false,reason:"célula-de-tabela-sem-parágrafo"};
  return {ok:true,zip};
 }catch(e){return {ok:false,reason:`pacote-docx-inválido:${e.message}`}}
}
function finalizePublishedHistoryStatusXmlSafe(xml,institutionalRevision){
 const hist=historyTableData(xml);if(!hist)return {xml:String(xml||""),changed:false};const wanted=Number(institutionalRevision);let table=hist.table,changed=false;
 for(const info of hist.info||[]){if(info.revision!==wanted)continue;const row=info.row,cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(x=>x[0]);if(cells.length<4)break;const oldText=xmlPlainText(cells[3]);const newText=oldText.replace(/aguardando\s+confer[eê]ncia\s+profissional\.?/gi,"validada e publicada após conferência profissional.");if(newText!==oldText){const newCell=replaceCellText(cells[3],newText),newRow=row.replace(cells[3],newCell);table=table.replace(row,newRow);changed=true}break}
 return {xml:changed?String(xml||"").replace(hist.table,table):String(xml||""),changed};
}
function updatePreparedHistoryPageCountXml(xml,institutionalRevision,pages){
 const hist=historyTableData(xml);if(!hist)return {ok:false,reason:"history-table-not-found"};
 const table=hist.table,rows=hist.rows||[...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(x=>x[0]);let target=null;
 for(const row of rows){const cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(x=>[...x[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(y=>y[1].replace(/<[^>]+>/g,"")).join("").trim());if(cells.length>=7&&cells[0]===String(institutionalRevision)){target=row;break}}
 if(!target)return {ok:false,reason:"prepared-history-row-not-found"};let ci=0;const updated=target.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g,tc=>{const out=ci===2?replaceCellText(tc,String(pages)):tc;ci++;return out});
 return {ok:true,xml:xml.replace(table,table.replace(target,updated))};
}
async function finalizePreparedApprovedWord(d,v,confirmedPages){
 if(!v?.publicationPrepared||!v?.preparedInstitutionalRevision)return {updated:false,reason:"publication-not-prepared"};if(!v?.wordKey)return {updated:false,reason:"no-word-key"};const blob=await getDocBlob(v.wordKey);if(!blob)return {updated:false,reason:"word-not-found"};
 const pages=String(confirmedPages||"").trim();if(!/^\d{1,3}$/.test(pages)||Number(pages)<1)return {updated:false,reason:"page-count-not-confirmed"};
 const before=await validateDocxBlobIntegrity(blob);if(!before.ok){console.error("Word preparado inválido antes da finalização",before.reason);return {updated:false,reason:"docx-source-invalid",detail:before.reason}}
 try{const zip=await JSZip.loadAsync(blob,{checkCRC32:true}),file=zip.file("word/document.xml");if(!file)return {updated:false,reason:"document-xml-missing"};let xml=await file.async("string");
   xml=trimLegacyTrailingEmptyParagraphs(xml);
   const upd=updatePreparedHistoryPageCountXml(xml,v.preparedInstitutionalRevision,pages);if(!upd.ok)return {updated:false,reason:upd.reason};xml=upd.xml;
   const statusClean=removeProposalStatusParagraphs(xml);xml=statusClean.xml;
   const historyClean=finalizePublishedHistoryStatusXmlSafe(xml,v.preparedInstitutionalRevision);xml=historyClean.xml;
   const structural=ensureWordTableCellParagraphs(xml);xml=structural.xml;
   const xmlCheck=validateWordprocessingPackageXml(xml,"word/document.xml final");if(!xmlCheck.ok)return {updated:false,reason:"docx-final-xml-invalid",detail:xmlCheck.reason};
   zip.file("word/document.xml",xml);
   const approved=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",compression:"DEFLATE"});
   const after=await validateDocxBlobIntegrity(approved);if(!after.ok){console.error("Publicação bloqueada: DOCX final inválido",after.reason);return {updated:false,reason:"docx-final-validation-failed",detail:after.reason}}
   const backupKey=`${v.wordKey}|pre-finalize-${Date.now()}`;await putDocBlob(backupKey,blob);v.preFinalizationBackupKey=backupKey;v.preFinalizationBackupAt=nowBR();
   const previousKey=v.wordKey;v.wordKey=`${d.id}|${v.revision}|word|final-${crypto.randomUUID()}`;await putDocBlob(v.wordKey,approved);v.previousWordKey=previousKey;
   v.approvalEmbedded=true;v.approvalEmbeddedAt=nowBR();v.institutionalRevision=v.preparedInstitutionalRevision;v.institutionalRevisionDate=todayISO();v.confirmedFinalPages=Number(pages);v.docxIntegrityValidated=true;v.docxIntegrityValidatedAt=nowBR();return {updated:true,institutionalRevision:v.preparedInstitutionalRevision,validity:v.institutionalValidity||"",pages:Number(pages)};
 }catch(err){console.error("Falha ao confirmar paginação do Word preparado",err);return {updated:false,reason:"docx-page-confirmation-failed",detail:err.message}}
}

function completePublication(i,vi,d,v,validator,finalization){
 d.versions.forEach((x,xv)=>{if(xv!==vi&&x.workflow==="Vigente")x.workflow="Obsoleto"});v.workflow="Vigente";v.validator=validator;v.approver=validator;v.validationDate=todayISO();v.updatedAt=nowBR();d.reviewRequired=false;
 v.note=`${v.note||"Revisão técnico-científica."} Revisão institucional ${finalization.institutionalRevision} registrada automaticamente no Word em ${dateBR(todayISO())}, com ${finalization.pages} página(s) confirmada(s) após a montagem final do Controle Histórico.`;
 auditAdmin(`SIASH Docs: ${d.code} revisão interna ${v.revision} validada e publicada por ${validator} · revisão institucional ${finalization.institutionalRevision} · ${finalization.pages} página(s) confirmadas após geração final.`);save();showToast(`Publicado · Rev.${finalization.institutionalRevision} · ${finalization.pages} página(s)`,2800);renderDocs();
}
window.validateDocProposal=async(i,vi)=>{
 if(!requireProposalContext(i,vi))return;
 const _v=S.docs?.[i]?.versions?.[vi];if(_v?.createdBy==="SIASH Docs / IA"&&_v.aiVerified!==true){const warnings=[...new Set(_v.aiVerification?.validationWarnings||[])];if(!confirm(`A verificação automática registrou pendências que exigem conferência profissional.${warnings.length?`\n\nAlertas:\n- ${warnings.join("\n- ")}`:""}\n\nVocê confirma que abriu e conferiu integralmente o Word antes de continuar?`))return;}
 const d=S.docs[i],v=d?.versions?.[vi];if(!d||!v)return;if(!canDocValidate(d))return alert("Seu perfil não possui permissão de validação neste setor.");if(!(v.wordKey||v.wordPath))return alert("Validação bloqueada: a publicação institucional exige o Word atualizado.");
 if(v.publicationPrepared)return finalizePreparedPublication(i,vi);
 if(!confirm(`Confirma que você abriu, conferiu e aprova tecnicamente a revisão ${v.revision} de ${d.code}?\n\nA SIASH agora vai PREPARAR o Word final, reutilizando a revisão institucional do ciclo quando ela já existir; somente um novo ciclo poderá criar nova revisão institucional. O documento ainda NÃO será publicado.`))return;
 const validator=(prompt("Profissional responsável pela aprovação:",SESSION.user||"")||"").trim();if(!validator)return alert("A identificação do profissional responsável é obrigatória.");
 const prep=await prepareApprovedWord(d,v,validator);if(!prep.updated)return alert(`Preparação BLOQUEADA: a SIASH não conseguiu montar com segurança o Word final (${prep.reason}). A versão vigente anterior foi preservada.`);
 save();renderDocs();renderProposalReady(i,vi);alert(`Word final preparado com a Revisão Institucional ${prep.institutionalRevision}${prep.mode==="reuse"?" (consolidada no mesmo ciclo)":""} e o campo Nº Páginas como “A conferir”.\n\nAgora abra o WORD ATUALIZADO novamente. Confira a quantidade REAL de páginas DEPOIS da inclusão do Controle Histórico. Em seguida clique em FINALIZAR PUBLICAÇÃO.`);
}
window.finalizePreparedPublication=async(i,vi)=>{
 if(!requireProposalContext(i,vi))return;
 const d=S.docs[i],v=d?.versions?.[vi];if(!d||!v)return;if(!canDocValidate(d))return alert("Seu perfil não possui permissão de validação neste setor.");
 // v0.14.13 — antes de finalizar, reconcilia o metadado preparado com o Word realmente armazenado.
 // Recupera com segurança propostas legadas em que Rev.03 ficou persistida após reimportar Word Rev.02.
 if(v.publicationPrepared&&(v.wordKey||v.wordPath)){try{const blob=await getDocBlob(v.wordKey||v.wordPath);if(blob&&/\.docx$/i.test(v.wordName||"")){const z=await JSZip.loadAsync(blob),f=z.file("word/document.xml");if(f){const x=await f.async("string"),hist=historyTableData(x),rows=hist?.info?.filter(r=>r.revision!==null)||[];if(rows.length){const latest=rows.reduce((a,b)=>a.revision>b.revision?a:b),actual=String(latest.revision).padStart(2,"0"),prepared=String(v.preparedInstitutionalRevision||v.institutionalRevision||"").padStart(2,"0");if(prepared&&actual!==prepared){v.publicationPrepared=false;v.publicationPreparedAt="";v.publicationPreparedBy="";v.preparedInstitutionalRevision="";v.institutionalValidity="";v.institutionalPreparationMode="";v.confirmedFinalPages=null;v.approvalEmbedded=false;v.approvalEmbeddedAt="";v.institutionalRevision="";v.institutionalRevisionDate="";v.importedInstitutionalRevision=actual;v.importedInstitutionalMonthYear=String(latest.cells?.[1]||"").trim();v.importedInstitutionalDetectedAt=nowBR();save();renderDocs();renderProposalReady(i,vi);return alert(`A SIASH detectou que o Word armazenado está na Revisão Institucional ${actual}, diferente da preparação transitória ${prepared}. A preparação antiga foi descartada com segurança. Clique em PREPARAR PUBLICAÇÃO para continuar com a Rev.${actual}.`)}}}}}catch(e){console.error("Falha na reconciliação pré-publicação",e);return alert("Publicação bloqueada: não foi possível reconciliar com segurança a revisão institucional do Word. O vigente foi preservado.")}}if(v.publicationPrepared){const norm=await normalizePreparedInstitutionalCycle(d,v);if(norm.changed){renderDocs();renderProposalReady(i,vi);return alert(`A SIASH corrigiu automaticamente uma revisão institucional intermediária do mesmo ciclo (alvo: Rev.${norm.targetRevision}). Abra o Word novamente e clique em PREPARAR PUBLICAÇÃO para consolidar a revisão correta.`)}}if(!v.publicationPrepared)return validateDocProposal(i,vi);
 const validator=(v.publicationPreparedBy||v.validator||SESSION.user||"").trim();if(!validator)return alert("A identificação do profissional responsável não foi preservada. Solicite nova preparação.");
 if(!confirm(`Confirma que você ABRIU o Word preparado da revisão ${v.revision} e conferiu a paginação após a inclusão da nova linha do Controle Histórico?`))return;
 const confirmedPages=(prompt("Informe o NÚMERO TOTAL DE PÁGINAS do Word FINAL que você acabou de conferir:",v.confirmedFinalPages?String(v.confirmedFinalPages):"")||"").trim();if(!/^\d{1,3}$/.test(confirmedPages)||Number(confirmedPages)<1)return alert("Publicação interrompida: informe o número total de páginas do Word final preparado.");
 if(!confirm(`Publicar a revisão ${v.revision} como VIGENTE com ${confirmedPages} página(s)?\n\nA versão vigente anterior será marcada como obsoleta somente após esta confirmação.`))return;
 const finalization=await finalizePreparedApprovedWord(d,v,confirmedPages);if(!finalization.updated)return alert(`Publicação BLOQUEADA: a SIASH não conseguiu registrar a paginação no Word preparado (${finalization.reason}). A versão vigente anterior foi preservada.`);
 // Only the authenticated server may publish. The browser never marks a version Vigente.
 v.workflow="Aguardando aprovação";
 preserveCloudDraft("Publicação documental aguardando confirmação transacional");
 try{
  if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token||!Number.isSafeInteger(SIASH_CLOUD.revision))throw new Error("Sessão Cloud não sincronizada.");
  const stored=await cloudJson("/api/state",{method:"PUT",body:JSON.stringify({payload:cloudPayload(),base_revision:SIASH_CLOUD.revision})});
  SIASH_CLOUD.revision=stored.revision;
  const result=await cloudJson("/api/docs/publish",{method:"POST",body:JSON.stringify({doc_id:d.id,revision:v.revision,base_revision:SIASH_CLOUD.revision,technical_confirmation:true})});
  SIASH_CLOUD.revision=result.revision;
  const remote=await cloudJson("/api/state");
  if(remote?.payload?.state){S=remote.payload.state;cloudSetBase(S);localStorage.setItem(STORE,JSON.stringify(S));}
  updateCloudBadge("Sincronizado com PostgreSQL");
  showToast("Publicação transacional confirmada pelo servidor",3500);renderDocs();
 }catch(e){
  const conflict=e.status===409||e.conflict===true;
  preserveCloudDraft(conflict?"HTTP 409 · conciliação documental necessária":"Publicação documental pendente");
  if(conflict)SIASH_CLOUD.conflict=true;
  updateCloudBadge(conflict?"CONFLITO HTTP 409 · conciliação necessária · rascunho e arquivos preservados":"Publicação pendente · rascunho preservado",true);
  alert(conflict?"Conflito HTTP 409: outro usuário atualizou a revisão. A proposta, justificativas e arquivos preparados permanecem no armazenamento local/IndexedDB. Concilie as revisões antes de publicar novamente.":"Publicação não concluída no servidor. Rascunho preservado. "+(e.message||"Verifique permissões e revisão."));
 }
}
window.requestDocCorrection=async(i,vi)=>{if(!requireProposalContext(i,vi))return;const d=S.docs[i],v=d?.versions?.[vi];if(!d||!v)return;const reason=(prompt("Descreva resumidamente o que precisa ser corrigido na proposta:")||"").trim();if(!reason)return;v.workflow="Em revisão";v.publicationPrepared=false;v.publicationPreparedAt="";v.publicationPreparedBy="";v.preparedInstitutionalRevision="";v.correctionRequested=reason;v.updatedAt=nowBR();save();renderDocs();openProposalWorkspace(i,vi);const status=$("doc-update-status");status.textContent=`Correção registrada para a revisão ${v.revision}. Regenerando a mesma proposta com IA...`;auditAdmin(`SIASH Docs: correção profissional solicitada para ${d.code} revisão ${v.revision}; regeneração automática iniciada.`);try{const result=await sendDocToAI(i,{skipConfirm:true,correctionRegeneration:true,expectedRevision:String(v.revision)});if(result?.ok){showToast(`Correção da revisão ${v.revision} concluída e pronta para conferência`,3500);alert(`Correção concluída na mesma revisão ${v.revision}. Abra o Word atualizado e confira antes de validar/publicar.`)}else{status.textContent="Correção registrada, mas a regeneração automática não foi concluída. A revisão anterior foi preservada.";showToast("Correção não concluída — proposta anterior preservada",3500)}}catch(e){console.error(e);status.textContent="Correção registrada, mas a regeneração automática não foi concluída. A revisão anterior foi preservada.";alert(e.message||"A correção não foi concluída.")}};
window.deleteDoc=i=>{if(!requireOwner("a exclusão de documentos do SIASH Docs"))return;const d=S.docs[i];if(d.seed)return alert("Os POPs institucionais incorporados à base não podem ser excluídos. Crie uma nova revisão para substituí-los.");if(confirm(`Excluir o cadastro ${d.code}? O histórico documental será removido desta instalação.`)){auditAdmin(`SIASH Docs: documento ${d.code} excluído.`);S.docs.splice(i,1);save()}}
function hideDocNewPanel(){$("doc-new-panel").classList.add("hidden");$("doc-form").reset();$("doc-sector").value="UTIN";$("doc-revision").value="00";$("doc-period").value="24";$("doc-workflow").value="Vigente"}
function renderHuddle(){const total=S.huddle.length,done=S.huddle.filter(x=>x.done).length,open=total-done,now=Date.now(),over=S.huddle.filter(x=>!x.done&&x.deadline&&new Date(x.deadline).getTime()<now).length;$("h-open").textContent=open;$("h-done").textContent=done;$("h-overdue").textContent=over;$("h-resolution").textContent=total?Math.round(done/total*100)+"%":"0%";$("huddle-table").innerHTML=S.huddle.map((x,i)=>`<tr><td>${safe(x.sector)}</td><td>${safe(x.problem)}</td><td>${safe(x.action)}</td><td>${safe(x.owner)}</td><td>${x.deadline?new Date(x.deadline).toLocaleString("pt-BR"):"—"}</td><td>${safe(x.priority)}</td><td class="${x.done?"status-ok":(x.deadline&&new Date(x.deadline).getTime()<now?"status-bad":"status-warn")}">${x.done?"Concluída":"Aberta"}</td><td><button class="ghost" onclick="toggleHuddle(${i})">${x.done?"Reabrir":"Concluir"}</button></td></tr>`).join("")||'<tr><td colspan="8">Nenhuma ação registrada.</td></tr>'}
window.toggleHuddle=i=>{S.huddle[i].done=!S.huddle[i].done;save()}
function renderRH(){$("rh-table").innerHTML=[...S.rh].reverse().map(x=>`<tr><td>${safe(x.type)}</td><td>${safe(x.name)}</td><td>${safe(x.detail)}</td><td>${safe(x.status)}</td></tr>`).join("")||'<tr><td colspan="4">Nenhuma solicitação registrada.</td></tr>'}
let adminUsersLoading=false;
async function loadAdminAudit(){
 if(!isOwner()||!SIASH_CLOUD.token)return;
 try{const result=await cloudJson("/api/admin/audit");const events=result.events||[];
  if($("admin-audit-count"))$("admin-audit-count").textContent=events.length;
  if($("admin-audit"))$("admin-audit").replaceChildren(...events.slice(0,15).map(event=>{const el=document.createElement("div");el.className="event";el.textContent=new Date(event.created_at).toLocaleString("pt-BR")+" • "+event.username+" • "+event.action+" • "+JSON.stringify(event.details||{});return el}));
 }catch(e){if($("admin-user-feedback"))$("admin-user-feedback").textContent="Auditoria indisponível: "+e.message}
}
async function loadAdminUsers(){
 if(!isOwner()||!SIASH_CLOUD.token||adminUsersLoading)return;
 adminUsersLoading=true;
 try{
  const users=await cloudJson("/api/users");
  const count=$("admin-operational-count");if(count)count.textContent=users.filter(u=>u.role==="operational").length;
  const list=$("admin-user-list");
  if(list){
   list.replaceChildren();
   const table=document.createElement("table"),head=document.createElement("thead"),body=document.createElement("tbody");
   head.innerHTML="<tr><th>Login</th><th>Perfil</th><th>Cadastro</th><th>Ação</th></tr>";
   for(const u of users){
    const tr=document.createElement("tr");
    for(const value of [u.username,u.role==="owner"?"Administrador Proprietário":u.role==="clinical_supervisor"?"Supervisor Clínico":"Operacional",new Date(u.created_at).toLocaleDateString("pt-BR")]){
     const td=document.createElement("td");td.textContent=value;tr.append(td);
    }
    const action=document.createElement("td");
    if(u.role!=="owner"){
     const button=document.createElement("button");button.type="button";button.className="secondary compact-btn";
     const next=u.role==="clinical_supervisor"?"operational":"clinical_supervisor";
     button.textContent=next==="clinical_supervisor"?"Promover a Supervisor Clínico":"Revogar supervisão";
     button.addEventListener("click",async()=>{
      if(!isOwner()||!confirm("Confirma alteração auditável do perfil de "+u.username+"?"))return;
      button.disabled=true;
      try{await cloudJson("/api/users/"+encodeURIComponent(u.username)+"/role",{method:"PATCH",body:JSON.stringify({role:next})});adminUsersLoading=false;await loadAdminUsers();}
      catch(e){$("admin-user-feedback").textContent="Alteração não realizada: "+e.message;button.disabled=false}
     });action.append(button);
    }
    tr.append(action);body.append(tr);
   }
   table.append(head,body);list.append(table);
  }
 }catch(e){const el=$("admin-user-feedback");if(el)el.textContent="Falha ao consultar usuários: "+e.message}
 finally{adminUsersLoading=false;void loadAdminAudit()}
}
function renderAdmin(){const sec=securityState()||{};if($("admin-owner-name"))$("admin-owner-name").textContent=SESSION.user||sec.ownerUser||"—";if($("admin-audit-count"))$("admin-audit-count").textContent=(sec.audit||[]).length;if($("admin-audit"))$("admin-audit").innerHTML=(sec.audit||[]).slice(0,15).map(x=>`<div class="event"><strong>${safe(x.when)} • ${safe(x.user)}</strong><br>${safe(x.action)}</div>`).join("")||'<span class="muted">Nenhuma alteração administrativa registrada.</span>'}
function renderSettings(){
 $("s-unit").value=S.settings.unit;$("s-beds").value=S.settings.beds;$("s-intensive").value=S.settings.intensive;$("s-intermediate").value=S.settings.intermediate;$("s-target").value=S.settings.target;$("s-hospital").value=S.settings.hospital;
 if($("s-ai-provider"))$("s-ai-provider").value=S.settings.aiProvider||"auto";
 renderAIStatus();
}
async function renderAIStatus(){
 const el=$("s-ai-status");if(!el)return;
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token){el.innerHTML="<strong>IA:</strong> status disponível após login na Cloud.";return}
 try{const st=await cloudJson("/api/ai/status");const g=st.providers?.gemini,c=st.providers?.cloudflare,o=st.providers?.openai,gs=g?.searchMode==="google_search"?"Pesquisa Google ativa":"Pesquisa Google desativada (Free Tier)";el.innerHTML=`<strong>IA configurada:</strong> Gemini ${g?.configured?"✓":"—"} (${safe(g?.model||"—")}) · ${gs} · Cloudflare ${c?.configured?"✓":"—"} (${safe(c?.model||"—")})${c?.configuredModelIgnored?` · configuração antiga ignorada: ${safe(c?.configuredModel||"—")}`:""}${Array.isArray(c?.freeModelFallbacks)&&c.freeModelFallbacks.length?` · fallback Free automático: ${c.freeModelFallbacks.map(safe).join(" → ")}`:""} · OpenAI ${o?.configured?"✓":"—"} (${safe(o?.model||"—")})`}
 catch(e){el.innerHTML="<strong>IA:</strong> não foi possível consultar o status dos provedores."}
}
async function runCloudflareFallbackDiagnostic(){
 const btn=$("s-test-ai-fallback"),out=$("s-ai-diagnostic-result");
 if(!btn||!out)return;
 if(!requireOwner("o teste diagnóstico de fallback da IA"))return;
 btn.disabled=true;out.textContent="Executando teste controlado: Gemini será simulado como indisponível somente nesta requisição...";
 try{
   const r=await cloudJson("/api/ai/diagnostic/fallback",{method:"POST",body:"{}"});
   out.innerHTML=`<strong>APROVADO ✓</strong> Gemini simulado indisponível → ${safe(aiProviderLabel(r.provider))}${r.model?` · ${safe(r.model)}`:""}. Tempo: ${Number(r.elapsedMs||0)} ms. Nenhum POP foi alterado.`;
   showToast("Fallback Cloudflare aprovado",2200);
 }catch(e){
   out.innerHTML=`<strong>FALHOU:</strong> ${safe(e.message||"Não foi possível concluir o diagnóstico.")}`;
 }finally{btn.disabled=false}
}
function renderAll(){renderClock();populateBedSelects();renderDashboard();renderShift();renderDaily();renderBeds();renderMovements();renderChecklist();renderCare();renderPicc();renderPipa();renderPending();renderIndicators();renderComparison();renderDocs();renderSettings();renderAdmin();applyPermissions()}
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));btn.classList.add("active");document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$("view-"+btn.dataset.view).classList.remove("hidden");$("page-title").textContent=btn.textContent;renderAll();if(btn.dataset.view==="administracao")loadAdminUsers();if(btn.dataset.view==="pendencias")loadSharedPending()}))
$("admin-user-form").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!isOwner())return alert("Somente o Administrador Proprietário pode cadastrar usuários.");
 const username=$("admin-new-user").value.trim(),password=$("admin-new-pass").value,confirmPass=$("admin-new-pass-confirm").value,feedback=$("admin-user-feedback");
 if(!/^[a-zA-Z0-9._-]{3,64}$/.test(username))return feedback.textContent="Informe um login de 3 a 64 caracteres, sem espaços.";
 if(!validStrongPassword(password))return feedback.textContent="A senha deve ter 10 a 128 caracteres e pelo menos um especial (!@#$%^&*._-).";
 if(password!==confirmPass)return feedback.textContent="As senhas não coincidem.";
 const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;feedback.textContent="Cadastrando...";
 try{
  await cloudJson("/api/users",{method:"POST",body:JSON.stringify({username,password,role:$("admin-new-role").value})});
  $("admin-new-pass").value="";$("admin-new-pass-confirm").value="";$("admin-new-user").value="";
  feedback.textContent="Usuário cadastrado com sucesso.";await loadAdminUsers();
 }catch(err){feedback.textContent="Cadastro não realizado: "+err.message}
 finally{button.disabled=false}
});
$("admin-users-refresh").addEventListener("click",loadAdminUsers);
$("change-password-open")?.addEventListener("click",()=>{$("change-password-panel").classList.toggle("hidden");$("change-password-feedback").textContent="";});
$("change-password-cancel")?.addEventListener("click",()=>{$("change-password-panel").classList.add("hidden");$("change-password-form").reset();});
$("change-password-form")?.addEventListener("submit",async e=>{
 e.preventDefault();
 const feedback=$("change-password-feedback"),currentPassword=$("change-current-password").value,newPassword=$("change-new-password").value,confirmPassword=$("change-confirm-password").value;
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return feedback.textContent="A troca de senha exige sessão autenticada na Cloud.";
 if(!validStrongPassword(newPassword))return feedback.textContent="Nova senha: mínimo 10 caracteres e um especial (!@#$%^&*._-).";
 if(newPassword!==confirmPassword)return feedback.textContent="A confirmação não coincide.";
 const form=e.currentTarget;const btn=form.querySelector('button[type="submit"]');btn.disabled=true;
 try{await cloudJson("/api/change-password",{method:"POST",body:JSON.stringify({currentPassword,newPassword,confirmPassword})});form.reset();feedback.textContent="Senha alterada com sucesso.";}
 catch(err){feedback.textContent="Não foi possível alterar a senha: "+err.message;}
 finally{btn.disabled=false}
});
$("owner-create-btn").addEventListener("click",async()=>{
 const user=$("owner-user").value.trim(),pass=$("owner-pass").value,pass2=$("owner-pass2").value;
 if(!user)return alert("Informe o usuário proprietário.");if(!validStrongPassword(pass))return alert("A senha proprietária deve ter 10 a 128 caracteres e pelo menos um especial (!@#$%^&*._-).");if(pass!==pass2)return alert("As senhas não coincidem.");
 try{
   if(SIASH_CLOUD.enabled){
     await cloudAuthenticate(user,pass,true);
     setSecurityState({ownerUser:user,ownerHash:await sha256(user+"|"+pass),createdAt:nowBR(),audit:[{when:nowBR(),user,action:"Conta exclusiva de Administrador Proprietário Cloud criada."}]});
     SESSION={authenticated:true,role:"owner",user};$("owner-pass").value="";$("owner-pass2").value="";
     await cloudLoadAfterLogin();$("login-view").classList.add("hidden");$("app-view").classList.remove("hidden");$("logged-user").textContent=user;applyPermissions();renderAll();showToast("SIASH Cloud configurada",1600);return;
   }
   const current=securityState();if(current&&current.ownerHash)return alert("O Administrador Proprietário já foi configurado neste navegador.");
   setSecurityState({ownerUser:user,ownerHash:await sha256(user+"|"+pass),createdAt:nowBR(),audit:[{when:nowBR(),user,action:"Conta exclusiva de Administrador Proprietário criada."}]});
   $("owner-pass").value="";$("owner-pass2").value="";initSecurityUI();alert("Administrador Proprietário criado. Faça o login com sua credencial exclusiva.");
 }catch(e){alert(e.message||"Falha na configuração Cloud.")}
})
$("login-btn").addEventListener("click",async()=>{const user=$("login-user").value.trim(),pass=$("login-pass").value,sec=securityState();$("login-feedback").textContent="";try{let role=null;if(SIASH_CLOUD.enabled){const auth=await cloudAuthenticate(user,pass,false);role=auth.role;SESSION={authenticated:true,role,user:auth.user||user};await cloudLoadAfterLogin();await applyPendingBackupAfterLogin()}else{if(sec&&user===sec.ownerUser&&(await sha256(user+"|"+pass))===sec.ownerHash)role="owner";else if(OPERATIONAL_USERS[user]===pass)role="operational";if(!role)throw new Error("Usuário ou senha inválidos.");SESSION={authenticated:true,role,user}}rememberLogin(SESSION.user||user);$("login-view").classList.add("hidden");$("app-view").classList.remove("hidden");$("logged-user").textContent=SESSION.user;applyPermissions();if(role==="owner")auditAdmin("Login do Administrador Proprietário.");renderAll();refreshMidnightCensusStatus();if(role==="owner")setTimeout(()=>migrateLegacyWordDocsIfNeeded().catch(e=>console.error("Migração automática .doc",e)),700)}catch(e){$("login-feedback").textContent=e.message||"Falha no login."}})
$("logout-btn").addEventListener("click",()=>{if(SIASH_CLOUD.syncing){alert("Aguarde o envio em andamento.");return;}if(cloudPending()&&!(confirm("Há dados não sincronizados. Preservar rascunho neste navegador e sair? O próximo plantão não verá estes dados até a recuperação pelo autor.")&&parkCloudDraft())){if(!SIASH_CLOUD.syncing&&!SIASH_CLOUD.conflict&&SIASH_CLOUD.token)scheduleCloudSave({retry:true});alert(SIASH_CLOUD.conflict?"Há um rascunho protegido deste usuário. Concilie antes da troca de plantão.":"Aguarde a confirmação do salvamento antes de sair. Depois, clique novamente em Sair.");return;}clearTimeout(cloudSaveTimer);clearTimeout(cloudRetryTimer);SIASH_CLOUD.token="";sessionStorage.removeItem("siash_cloud_token");SESSION={authenticated:false,role:null,user:null};$("change-password-panel")?.classList.add("hidden");$("change-password-form")?.reset();$("app-view").classList.add("hidden");$("login-view").classList.remove("hidden");initSecurityUI()})
$("refresh-dashboard").addEventListener("click",renderAll)
$("close-shift").addEventListener("click",()=>{if(S.shiftClosed)return alert("Plantão já encerrado; inicie o próximo.");const a=shiftAlerts();if(!confirm(`Encerrar plantão? Checklist pendente: ${a.pending}; pendências críticas abertas: ${a.critical}. Nenhuma tarefa será concluída automaticamente.`))return;S.shiftId=S.shiftId||shiftUid();S.shiftHistory.push({shiftId:S.shiftId,startedAt:S.shiftStarted,closedAt:"Aguardando servidor",checklist:structuredClone(S.checklist),events:structuredClone(S.events),care:structuredClone(S.care)});S.shiftClosed=true;save()});
$("reset-shift").addEventListener("click",()=>{if(!S.shiftClosed)return alert("Encerre o plantão atual antes de iniciar outro.");if(!confirm("Iniciar novo plantão com checklist pendente? O histórico anterior permanecerá consultável."))return;S.shiftId=shiftUid();S.shiftClosed=false;S.checklist=CHECKS.map(x=>({text:x,status:"Pendente"}));S.events=[];S.shiftStarted=new Date().toISOString();save()})
$("event-form").addEventListener("submit",e=>{e.preventDefault();if(!$("ev-text").value.trim())return;S.events.unshift({when:nowBR(),type:$("ev-type").value,bed:$("ev-bed").value,text:$("ev-text").value.trim()});shiftAudit("event",{type:$("ev-type").value,bed:$("ev-bed").value,text:$("ev-text").value.trim()});$("ev-text").value="";save()})
$("daily-form").addEventListener("submit",e=>{e.preventDefault();if($("d-altas-todas-canguru").checked){syncAllDischargesToCanguru();const existing=S.daily.find(x=>x.date===$("d-date").value);if((Number(existing?.canguru)||0)>0){alert("Este dia possui registro histórico de Canguru. Desmarque a opção e confira os dados antes de salvar, para evitar contagem duplicada.");return;}}const issue=validateDailyCanguruSubset($("d-altas").value,$("d-alta-canguru").value,S.daily.find(x=>x.date===$("d-date").value)?.canguru);if(issue){alert(issue);return;}const date=$("d-date").value;const previous=S.daily.find(x=>x.date===date);const rawCount=$("d-internados").value.trim();if(rawCount===""||!Number.isSafeInteger(Number(rawCount))||Number(rawCount)<0||Number(rawCount)>10){alert("Informe o total real de internados, entre 0 e 10.");return;}if(previous?.censusConference&&Number(rawCount)!==previous.censusConference.count){alert("Censo confirmado: utilize o fluxo de retificação para alterar o total.");return;}const r={...(previous||{}),date,internados:Number(rawCount),admissoes:+$("d-admissoes").value||0,altas:+$("d-altas").value||0,transferencias:+$("d-transferencias").value||0,obitos:+$("d-obitos").value||0,pipa:(S.daily.find(x=>x.date===date)?.pipa||0),altaPediatria:(S.daily.find(x=>x.date===date)?.altaPediatria||0),altaCanguru:+$("d-alta-canguru").value||0,picc:piccInsertedOn(date),pezinho:+$("d-pezinho").value||0,intub:+$("d-intub").value||0,vm:+$("d-vm").value||0,extubProg:+$("d-extub-prog").value||0,extub:+$("d-extub").value||0,lpp:+$("d-lpp").value||0,hypothermia:thermalCount(date,"Hipotermia"),hyperthermia:thermalCount(date,"Hipertermia"),obs:$("d-obs").value.trim()};if(previous?.censusConferenceHistory)r.censusConferenceHistory=previous.censusConferenceHistory;if(previous?.censusConference){if(Number(previous.internados)===r.internados)r.censusConference=previous.censusConference;else{r.censusConferenceHistory=[...(r.censusConferenceHistory||[]),previous.censusConference];delete r.censusConference;}}S.daily=S.daily.filter(x=>x.date!==r.date);S.daily.push(r);S.daily.sort((a,b)=>a.date.localeCompare(b.date));save();showToast("Dados salvos",1000)})
$("census-close").addEventListener("click",()=>{
 if(censusConferencePending)return;
 const date=$("d-date").value||todayISO();
 const responsible=$("census-closer").value;
 if(!window.confirm("Confirmar conferência manual do plantão noturno? A data e hora reais serão registradas; isso não certifica automaticamente o fechamento à meia-noite."))return;
 const result=registerCensusConference(date,responsible);
 if(!result.ok)return alert(result.reason);
 save();if(SIASH_CLOUD.enabled&&SIASH_CLOUD.token){censusConferencePending={date,generation:SIASH_CLOUD.editGeneration};censusConferenceFeedback("Salvando conferência… aguardando confirmação do servidor.");}else{censusConferenceFeedback("Conferência salva somente neste navegador. Sem confirmação do servidor.",true);}showToast("Conferência registrada localmente; aguardando sincronização",2200);
});
$("daily-clear").addEventListener("click",()=>{Object.entries(DAILY_FIELD_MAP).forEach(([k,id])=>$(id).value=k==="pipa"?pipaCountOn($("d-date").value):k==="picc"?piccInsertedOn($("d-date").value):k==="hypothermia"?thermalCount($("d-date").value,"Hipotermia"):k==="hyperthermia"?thermalCount($("d-date").value,"Hipertermia"):k==="internados"?"":0);$("d-obs").value="";$("d-altas-todas-canguru").checked=false})
$("d-altas").addEventListener("input",syncAllDischargesToCanguru);
$("d-altas-todas-canguru").addEventListener("change",syncAllDischargesToCanguru);
$("d-alta-canguru").addEventListener("input",()=>{$("d-altas-todas-canguru").checked=false});
$("d-date").addEventListener("change",()=>{const date=$("d-date").value;loadDailyForm(date);renderDaily()})
$("thermal-add").addEventListener("click",()=>{const date=$("d-date").value||todayISO(),bedNo=+$("thermal-bed").value,b=S.beds.find(x=>x.n===bedNo);if(!b)return alert("Selecione um leito válido.");if(b.status!=="Ocupado")return alert("O leito selecionado não está marcado como ocupado. Atualize a Gestão de Leitos antes de registrar o evento.");if(!String(b.rn||"").trim())return alert("O leito ocupado está sem identificador do RN. Informe o identificador não nominal na Gestão de Leitos.");S.thermalEvents.push({id:"THERM-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),date,bed:bedNo,rn:String(b.rn).trim(),type:$("thermal-type").value,note:$("thermal-note").value.trim(),createdAt:new Date().toISOString()});$("thermal-note").value="";save();showToast("Evento térmico registrado",1200)})
$("bed-form").addEventListener("submit",e=>{e.preventDefault();const b=S.beds.find(x=>x.n==+$("bed-number").value);if(!b)return;const status=$("bed-status").value,rn=$("bed-rn").value.trim();if(status==="Ocupado"&&!rn)return alert("Informe o identificador não nominal do RN antes de ocupar o leito.");if(status!=="Ocupado"&&rn)return alert("Leitos livres ou bloqueados não podem manter um identificador de RN. Confira a movimentação antes de salvar.");if(b.status==="Ocupado"&&status==="Ocupado"&&b.rn!==rn)return alert("Substituição de RN em leito ocupado bloqueada. Registre a movimentação clínica e confira a ocupação.");if(b.status==="Ocupado"&&status==="Ocupado"&&b.profile!==$("bed-profile").value)return alert("Para mudar o perfil assistencial sem deslocar o RN, use o formulário Alterar perfil assistencial.");b.status=status;b.profile=$("bed-profile").value;b.rn=rn;b.note=$("bed-note").value.trim();save()})
$("profile-form").addEventListener("submit",e=>{
 e.preventDefault();
 const n=+$("profile-bed").value,b=S.beds.find(x=>x.n===n);
 if(!b)return alert("Selecione o leito.");
 if(b.status!=="Ocupado")return alert("A alteração de perfil assistencial deve ser feita em um leito ocupado.");
 const old=b.profile,newp=$("profile-new").value;
 if(old===newp)return alert(`O RN já está classificado como ${newp}.`);
 if(!window.confirm(`Confirmar mudança de perfil?\nRN: ${b.rn}\nLeito físico: ${pad(n)} (sem deslocamento)\nDe: ${old}\nPara: ${newp}`))return;
 b.profile=newp;
 const note=$("profile-note").value.trim();
 S.profileHistory.push({when:nowBR(),bed:n,rn:b.rn,from:old,to:newp,note});
 S.events.unshift({when:nowBR(),type:"Alteração de perfil assistencial",bed:String(n),text:`Perfil alterado de ${old} para ${newp}, sem mudança física de leito.`});
 $("profile-note").value="";
 save();
 alert(`Perfil do RN no Leito ${pad(n)} alterado para ${newp}. O RN permaneceu no mesmo leito.`);
})
$("move-bed-form").addEventListener("submit",e=>{e.preventDefault();const o=+$("move-origin").value,t=+$("move-target").value;if(!o||!t||o===t)return alert("Selecione leitos diferentes.");const a=S.beds.find(x=>x.n===o),b=S.beds.find(x=>x.n===t);if(a.status!=="Ocupado")return alert("O leito de origem precisa estar ocupado.");if(!String(a.rn||"").trim())return alert("Identifique o RN no leito de origem antes de remanejar.");if(b.status!=="Livre")return alert("O leito de destino precisa estar livre.");const rn=a.rn,profile=a.profile;if(!window.confirm(`Confirmar remanejamento físico?\nRN: ${rn}\nOrigem: leito ${pad(o)}\nDestino: leito ${pad(t)} (Livre)\nPerfil preservado: ${profile}`))return;b.status="Ocupado";b.rn=rn;b.profile=profile;b.note=$("move-note").value.trim()||`Remanejado do leito ${o}`;a.status="Livre";a.rn="";a.note="";a.profile="Intensivo";S.bedMoves.push({when:nowBR(),origin:o,target:t,rn,profile,note:$("move-note").value.trim()});S.events.unshift({when:nowBR(),type:"Remanejamento físico de leito",bed:String(t),text:`RN remanejado fisicamente do leito ${o} para o leito ${t}, mantendo perfil ${profile}.`});$("move-note").value="";save();alert("Remanejamento físico registrado. O perfil assistencial do RN foi mantido.")})
$("mv-type").addEventListener("change",updateMovementFields)
$("movement-form").addEventListener("submit",e=>{e.preventDefault();S.movements.push({when:nowBR(),type:$("mv-type").value,bedtype:$("mv-bedtype").value,context:$("mv-context").disabled?"":$("mv-context").value.trim(),note:$("mv-note").value.trim()});$("mv-note").value="";save()})
$("care-save").addEventListener("click",()=>{const bed=$("care-bed").value;if(!bed)return alert("Selecione o leito.");const current=S.beds.find(x=>String(x.n)===String(bed));if(current?.status!=="Ocupado"||!String(current?.rn||"").trim())return alert("Selecione um leito ocupado com referência do episódio/RN.");const previous=structuredClone(S.care[bed]||null);if(previous?.episodeRn&&previous.episodeRn!==current.rn){alert("Mudança de ocupação detectada: SAE anterior permanece vinculada ao episódio anterior. Confira manualmente o histórico; nenhum estado será copiado.");return;}const next={sae:$("care-sae").value,evol:$("care-evol").value,multi:$("care-multi").value,updated:nowBR(),episodeRn:current?.rn||""};shiftAudit("care",{bed,episodeRn:current?.rn||"",previous,next});S.care[bed]=next;save()})
$("picc-form").addEventListener("submit",e=>{
 e.preventDefault();if(!$("picc-date").value||!$("picc-bed").value||!$("picc-vein").value)return alert("Informe a data da inserção, o leito e a veia/sítio.");
 const b1=$("picc-b1").value,b2=$("picc-b2").value,b3=$("picc-b3").value,bundle=[b1,b2,b3].every(x=>x==="Sim"),editIndex=null,old=null;
 const record={id:old?.id||crypto.randomUUID(),when:old?old.when:nowBR(),updated:nowBR(),insertDate:$("picc-date").value,bed:$("picc-bed").value,vein:$("picc-vein").value,side:$("picc-side").value,punctures:+$("picc-punctures").value||1,length:$("picc-length").value,external:$("picc-external").value,position:$("picc-position").value,b1,b2,b3,bundle,status:old?old.status:"Ativo",removalDate:old?old.removalDate:null,removalReason:old?old.removalReason:null,removalNote:old?old.removalNote:null,removedAt:old?old.removedAt:null};
 if(record.removalDate&&record.removalDate<record.insertDate)return alert("A data de inserção não pode ser posterior à data de retirada.");

 const activeSameBed=S.picc.filter(x=>String(x.bed)===String(record.bed)&&(!x.status||x.status==="Ativo"));if(activeSameBed.length){const proceed=confirm(`Já existe ${activeSameBed.length} PICC ativo no Leito ${pad(record.bed)}.\n\nSe for apenas correção, cancele e edite o registro existente.\n\nDeseja registrar outro PICC ativo neste leito?`);if(!proceed)return}
 S.picc.push(record);clearPiccForm();save();showToast("PICC registrado e indicadores atualizados",1400)
})
$("picc-cancel-edit").addEventListener("click",clearPiccForm)
$("picc-removal-cancel").addEventListener("click",cancelPiccRemoval)
$("picc-removal-form").addEventListener("submit",e=>{
 e.preventDefault();const i=+$("picc-removal-index").value,x=S.picc[i],date=$("picc-removal-date").value,reason=$("picc-removal-reason").value;if(!x||(x.status&&x.status!=="Ativo"))return alert("PICC ativo não localizado.");if(!date||!reason)return alert("Informe a data e o motivo da retirada.");if(!piccInsertDate(x))return alert("PICC legado sem data de inserção verificável. Não é seguro registrar a retirada até conferência técnica do histórico.");if(date<piccInsertDate(x))return alert("A retirada não pode ser anterior à inserção.");if(!window.confirm(`Confirmar retirada do PICC?\\nLeito: ${pad(x.bed)}\\nRN: ${S.beds.find(b=>String(b.n)===String(x.bed))?.rn||"Não identificado"}\\nInserção: ${piccInsertDate(x)||"Data legada não identificada"}\\nDias: ${piccDays(x)??"Não calculável"}\\nMotivo: ${reason}`))return;x.status="Retirado";x.removalDate=date;x.removalReason=reason;x.removalNote=$("picc-removal-note").value.trim();x.removedAt=nowBR();x.updated=nowBR();cancelPiccRemoval();save();showToast(`PICC do Leito ${pad(x.bed)} retirado`,1600)
})

$("pipa-form").addEventListener("submit",e=>{e.preventDefault();const qty=Number($("pipa-qty").value);if(!$("pipa-date").value||!$("pipa-city").value)return alert("Informe data do encaminhamento e município de origem.");$("pipa-month").value=monthOf($("pipa-date").value);if(!Number.isSafeInteger(qty)||qty<1)return alert("Informe quantidade inteira e maior que zero.");if(!$("pipa-post-discharge").checked)return alert("Confirme que os RNs foram encaminhados após a alta da UTIN.");const candidate={id:crypto.randomUUID(),date:$("pipa-date").value,month:$("pipa-month").value,city:($("pipa-city").value==="Outro"?$("pipa-city-other").value.trim():$("pipa-city").value),qty,note:$("pipa-note").value.trim(),postDischargeConfirmed:true,updated:nowBR()};if(!candidate.city)return alert("Informe o município de origem.");const duplicates=pipaPossibleDuplicates(candidate);if(duplicates.length&&!window.confirm("Possível encaminhamento PIPA duplicado na mesma data, município e quantidade. Confirme manualmente antes de registrar; nenhum dado será conciliado automaticamente."))return;S.pipa.push(candidate);$("pipa-qty").value=1;$("pipa-post-discharge").checked=false;$("pipa-note").value="";save()})
$("pipa-city").addEventListener("change",()=>{$("pipa-city-other-wrap").hidden=$("pipa-city").value!=="Outro";});
$("pipa-date").addEventListener("change",()=>{$("pipa-month").value=monthOf($("pipa-date").value);renderPipa()})
$("pending-form").addEventListener("submit",async e=>{
 e.preventDefault();
 const scope=$("pending-scope").value,description=$("pending-text").value.trim();
 if(!description)return;
 try{await cloudJson("/api/pending",{method:"POST",body:JSON.stringify({scope,bed:$("pending-bed").value,priority:$("pending-priority").value,description})});$("pending-text").value="";await loadSharedPending();showToast("Pendência compartilhada registrada",1600)}
 catch(err){alert("Pendência não salva: "+err.message)}
});
$("pending-scope").addEventListener("change",()=>{$("pending-bed-wrap").style.display=$("pending-scope").value==="sector"?"none":""});
$("pending-refresh").addEventListener("click",loadSharedPending);
$("pending-list").addEventListener("change",e=>{const id=e.target.dataset.pendingId;if(id)changeSharedPending(id,e.target.value)});
// Janela de auditoria somente leitura; nunca altera o estado de pendências.
function showPendingHistoryDialog(items){
 let dialog=$("pending-history-dialog");
 if(!dialog){
  dialog=document.createElement("dialog");
  dialog.id="pending-history-dialog";
  dialog.setAttribute("aria-labelledby","pending-history-title");
  dialog.style.cssText="width:min(860px,94vw);max-height:85vh;overflow:auto;border:1px solid #d8dfe3;border-radius:14px;padding:24px;box-shadow:0 16px 45px #0004;color:#263238;background:#fff";
  document.body.appendChild(dialog);
 }
 const rows=items.map(x=>{
  const date=x.created_at?new Date(x.created_at):null;
  const when=date&&!Number.isNaN(date.getTime())?date.toLocaleString("pt-BR"):"—";
  return `<tr><td>${safe(when)}</td><td>${safe(x.actor||"—")}</td><td>${safe(x.action||"—")}</td><td>${safe(x.previous_status||"—")} → ${safe(x.new_status||"—")}</td></tr>`;
 }).join("");
 dialog.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px"><h2 id="pending-history-title" style="margin:0;font-size:1.25rem">Histórico da pendência</h2><button type="button" class="secondary" data-close-pending-history>Fechar</button></div><div style="overflow-x:auto">${rows?`<table style="width:100%;border-collapse:collapse;text-align:left"><thead><tr><th>Data e hora</th><th>Profissional</th><th>Alteração</th><th>Situação anterior → nova</th></tr></thead><tbody>${rows}</tbody></table>`:'<p class="muted">Sem histórico registrado.</p>'}</div>`;
 dialog.querySelector("[data-close-pending-history]").addEventListener("click",()=>dialog.close());
 dialog.showModal();
}
$("pending-list").addEventListener("click",async e=>{
 const complete=e.target.closest("[data-complete-id]");if(complete){await changeSharedPending(complete.dataset.completeId,"Concluída");return;}
 const id=e.target.dataset.historyId;if(!id)return;
 try{const data=await cloudJson("/api/pending/"+id+"/history");showPendingHistoryDialog(data.items||[])}
 catch(err){alert(err.message)}
});
$("indicator-month").addEventListener("change",renderIndicators)


// v0.12.2 — restauração individual segura do Word da revisão vigente.
// Exclusivo do Administrador Proprietário. Não cria revisão, não muda workflow,
// não altera data de revisão/validação e só troca o vínculo do arquivo Word vigente.
let DOC_RESTORE_SINGLE_INDEX=null;
window.restoreCurrentWord=i=>{
 const d=S.docs[i];if(!d)return alert("Documento não localizado.");
 if(!requireOwner("a restauração do Word da revisão vigente"))return;
 const vi=docPublishedIndex(d),v=vi>=0?d.versions[vi]:null;if(!v)return alert("Revisão vigente não localizada para este documento.");
 DOC_RESTORE_SINGLE_INDEX=i;
 const input=$("doc-restore-single-file");if(!input)return alert("Ferramenta de restauração não disponível nesta versão.");
 input.value="";input.click();
};
async function restoreSingleCurrentWord(file){
 const i=DOC_RESTORE_SINGLE_INDEX;DOC_RESTORE_SINGLE_INDEX=null;
 const d=S.docs[i];if(!d||!file)return;
 if(!isOwner())return alert("Somente o Administrador Proprietário pode restaurar arquivos documentais.");
 const vi=docPublishedIndex(d),v=vi>=0?d.versions[vi]:null;if(!v)return alert("Revisão vigente não localizada. Nenhum vínculo foi alterado.");
 const isWord=/\.(docx?|DOCX?)$/.test(file.name||"")||/wordprocessingml|msword/i.test(file.type||"");
 if(!isWord)return alert("Selecione um arquivo Word (.doc ou .docx). Nenhum vínculo foi alterado.");
 const existing=v.wordName?`\nArquivo atualmente vinculado: ${v.wordName}`:"\nAtualmente não há Word recuperável vinculado a esta revisão.";
 if(!confirm(`Restaurar o Word da revisão JÁ VIGENTE?\n\nDocumento: ${d.code} — ${d.title}\nRevisão vigente na SIASH: ${v.revision}${existing}\nNovo arquivo: ${file.name}\n\nA operação NÃO criará nova revisão e NÃO alterará validação, workflow ou datas.`))return;
 const key=`${d.id}|${v.revision}|word|restored-${Date.now()}`;
 try{
   updateCloudBadge("Restaurando Word…");
   await putDocBlob(key,file);
   if(SIASH_CLOUD.enabled&&SIASH_CLOUD.token)await uploadDocCloud(key,file);
   v.wordKey=key;v.wordName=file.name;v.restoredAt=new Date().toISOString();v.restoredBy=SESSION.user||"Administrador Proprietário";v.restoredMode="individual";
   auditAdmin(`SIASH Docs: Word vigente restaurado manualmente para ${d.code}, revisão ${v.revision}, sem criação de nova revisão.`);
   save();renderDocs();updateCloudBadge("Sincronizado");
   alert(`Word restaurado com sucesso para ${d.code} — revisão ${v.revision}. Nenhuma nova revisão foi criada.`);
 }catch(err){console.error(err);updateCloudBadge("Falha na restauração",true);alert("A restauração não foi concluída e o vínculo documental não foi alterado. Detalhe: "+err.message)}
}

// v0.12.1 — restauração segura dos 8 Word já validados na v0.10.10.
// Esta rotina NÃO cria revisão, NÃO muda workflow e NÃO altera datas de validação.
const LEGACY_VALIDATED_WORD_MAP=[
 {id:"LEG-UTIN-001",match:/Higienizacao_das_Maos/i},
 {id:"LEG-UTIN-002",match:/Administracao_Dieta_Enteral/i},
 {id:"LEG-UTIN-003",match:/Administracao_Dieta_por_Gavagem/i},
 {id:"LEG-UTIN-004",match:/Administracao_Segura_Medicacao/i},
 {id:"LEG-UTIN-005",match:/Alta_Transferencia_RN/i},
 {id:"LEG-UTIN-006",match:/Anotacao_de_Enfermagem/i},
 {id:"LEG-UTIN-007",match:/Admissao_RN_UTIN/i},
 {id:"LEG-UTIN-008",match:/Bomba_de_Infusao/i}
];
async function restoreValidatedWords(files){
 if(!isOwner())return alert("Somente o Administrador Proprietário pode restaurar arquivos migrados.");
 const list=[...files];if(!list.length)return;
 const found=[];
 for(const spec of LEGACY_VALIDATED_WORD_MAP){const file=list.find(f=>spec.match.test(f.name));if(file)found.push({...spec,file})}
 const missing=LEGACY_VALIDATED_WORD_MAP.filter(x=>!found.some(y=>y.id===x.id)).map(x=>x.id);
 if(missing.length)return alert(`Foram reconhecidos ${found.length} de 8 arquivos. Faltam: ${missing.join(", ")}. Nenhum vínculo foi alterado.`);
 if(list.length!==8&&!confirm(`Foram selecionados ${list.length} arquivos, mas os 8 POPs esperados foram reconhecidos. Continuar usando somente os 8 reconhecidos?`))return;
 const plan=[];
 for(const x of found){const d=S.docs.find(z=>z.id===x.id||z.code===x.id);if(!d)return alert(`Documento ${x.id} não localizado na base atual. Nenhum vínculo foi alterado.`);const vi=docPublishedIndex(d),v=vi>=0?d.versions[vi]:null;if(!v)return alert(`Revisão vigente de ${x.id} não localizada. Nenhum vínculo foi alterado.`);plan.push({d,v,file:x.file,key:`${d.id}|${v.revision}|word|restored-${Date.now()}-${x.id}`})}
 if(!confirm(`A SIASH reconheceu os 8 POPs. Eles serão vinculados às revisões JÁ VIGENTES, sem criar novas revisões e sem alterar validações.\n\nDeseja restaurar os 8 arquivos agora?`))return;
 try{
   updateCloudBadge("Restaurando documentos…");
   for(const x of plan){await putDocBlob(x.key,x.file);if(SIASH_CLOUD.enabled&&SIASH_CLOUD.token)await uploadDocCloud(x.key,x.file)}
   for(const x of plan){x.v.wordKey=x.key;x.v.wordName=x.file.name;x.v.restoredFrom="v0.10.10";x.v.restoredAt=new Date().toISOString()}
   auditAdmin("SIASH Docs: restauração em lote dos 8 arquivos Word validados da v0.10.10, sem criação de nova revisão.");
   save();renderDocs();updateCloudBadge("Sincronizado");
   alert("Restauração concluída: 8/8 arquivos Word vinculados às revisões vigentes. Nenhuma nova revisão foi criada.");
 }catch(err){console.error(err);updateCloudBadge("Falha na restauração",true);alert("A restauração não foi concluída. O estado documental não foi alterado. Detalhe: "+err.message)}
}

function docxPlainTextFromXml(xml){return xml.replace(/<w:tab\/>/g,"\t").replace(/<w:br\/>/g,"\n").replace(/<\/w:p>/g,"\n").replace(/<[^>]+>/g,"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&apos;/g,"'")}
function monthPtToNumber(s=""){const a={janeiro:1,fevereiro:2,março:3,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};return a[String(s).toLowerCase()]||null}
async function inspectNewInstitutionalWord(file){
 const status=$("doc-new-detected");if(!file)return;status.textContent="Lendo o documento institucional...";
 if(!/\.docx$/i.test(file.name)){status.textContent="Arquivo selecionado. A leitura automática de metadados funciona em .docx; confira e preencha os campos manualmente.";return}
 try{const zip=await JSZip.loadAsync(file),entry=zip.file("word/document.xml");if(!entry)throw new Error("Estrutura DOCX não reconhecida.");const xml=await entry.async("string"),plain=docxPlainTextFromXml(xml),lines=plain.split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
   const cells=[...xml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(c=>docxPlainTextFromXml(c[0]).replace(/\s+/g," ").trim()).filter(Boolean);
   let code="";const codeCell=cells.find(x=>/^Registro\s*:/i.test(x));const cm=(codeCell||plain).match(/Registro\s*:\s*(.+)$/i)||(codeCell||plain).match(/\b(POP\s*[–-]\s*[A-Z0-9 ._/-]{3,40})/i);if(cm)code=String(cm[1]||cm[0]).trim().replace(/\s+/g," ");
   const generic=/^(procedimento operacional|padrão|padrao|pop|controle histórico|controle historico|registro)/i;let title=cells.find(x=>x.length>=5&&x.length<=120&&!generic.test(x)&&!/Registro\s*:/i.test(x)&&/[A-ZÁÉÍÓÚÃÕÇ]/.test(x)&&x===x.toUpperCase())||lines.find(x=>x.length>=5&&x.length<=120&&!generic.test(x)&&!/Registro\s*:/i.test(x)&&!/^\d{1,3}$/.test(x))||file.name.replace(/\.docx$/i,"");
   const hist=(xml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?Controle Hist[óo]rico[\s\S]*?<\/w:tbl>/i)||[])[0];let revision="",reviewDate="";if(hist){const rows=[...hist.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(m=>m[0]);let best=null;for(const row of rows){const cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(c=>docxPlainTextFromXml(c[0]).replace(/\s+/g," ").trim());if(cells.length>=2&&/^\d{1,3}$/.test(cells[0]))best=cells}if(best){revision=String(best[0]).padStart(2,"0");const dm=best[1].match(/([A-Za-zçÇãÃáÁéÉíÍóÓôÔ]+)\s*\/?\s*(\d{4})/);if(dm){const mn=monthPtToNumber(dm[1]);if(mn)reviewDate=`${dm[2]}-${String(mn).padStart(2,"0")}-01`}}}
   if(title)$("doc-title").value=title;if(code)$("doc-code").value=code;if(revision)$("doc-revision").value=revision;if(reviewDate)$("doc-review").value=reviewDate;status.innerHTML=`<strong>Dados identificados:</strong> ${safe(title||"título não identificado")} · ${safe(code||"código não identificado")} · revisão ${safe(revision||"não identificada")}. Confira os campos antes de adicionar.`;
 }catch(e){console.error(e);status.textContent="Não foi possível ler automaticamente os metadados deste Word. O arquivo pode ser cadastrado após conferência manual dos campos."}
}
$("doc-word")?.addEventListener("change",e=>inspectNewInstitutionalWord(e.target.files?.[0]));

$("doc-new-toggle").addEventListener("click",()=>{if(!canDocEdit())return alert("Seu perfil documental não permite adicionar documentos à biblioteca.");$("doc-new-panel").classList.remove("hidden");$("doc-new-panel").scrollIntoView({behavior:"smooth",block:"start"})})
$("doc-restore-batch")?.addEventListener("click",()=>{if(!requireOwner("a restauração de arquivos documentais migrados"))return;$("doc-restore-files").click()});
$("doc-restore-files")?.addEventListener("change",async e=>{const files=e.target.files;if(files?.length)await restoreValidatedWords(files);e.target.value=""});
$("doc-restore-single-file")?.addEventListener("change",async e=>{const file=e.target.files?.[0];if(file)await restoreSingleCurrentWord(file);e.target.value=""});
$("doc-new-cancel").addEventListener("click",hideDocNewPanel)
$("doc-search").addEventListener("input",renderDocs)
$("doc-filter").addEventListener("change",renderDocs); $("doc-sector-filter").addEventListener("change",renderDocs)
$("doc-history-close").addEventListener("click",()=>{
 $("doc-history-panel").classList.add("hidden");
 if(ACTIVE_DOC_PROPOSAL){
   $("doc-revision-panel")?.classList.remove("hidden");
   requestAnimationFrame(()=>$("doc-proposal-ready")?.scrollIntoView({behavior:"smooth",block:"center"}));
 }
})
$("doc-revision-cancel").addEventListener("click",cancelDocRevision)
$("doc-form").addEventListener("submit",async e=>{
 e.preventDefault();if(!canDocEdit())return alert("Seu perfil documental não permite cadastrar documentos.");
 const title=$("doc-title").value.trim(),code=$("doc-code").value.trim(),sector=$("doc-sector").value.trim()||"UTIN",type=$("doc-type")?.value||"POP";const access=currentDocAccess();if(!isOwner()&&access.sector!=="*"&&sector!==access.sector)return alert(`Seu acesso permite cadastrar documentos somente no setor ${access.sector}.`);const revision=$("doc-revision").value.trim()||"00",reviewDate=$("doc-review").value,period=+$("doc-period").value||24,workflow="Em elaboração",note=$("doc-note").value.trim()||"Emissão inicial.";
 if(!title||!code)return alert("Confira o título e o código antes de adicionar o documento.");if(S.docs.some(d=>String(d.code||"").toLowerCase()===code.toLowerCase()))return alert("Já existe um documento com este código. O cadastro foi bloqueado para evitar duplicidade.");if(S.docs.some(d=>String(d.title||"").trim().toLowerCase()===title.toLowerCase()))return alert("Já existe um documento com este mesmo título. Confira a biblioteca antes de cadastrar outro.");
 const id=newDocId(),pdf=$("doc-pdf").files[0],word=$("doc-word").files[0];if(!pdf&&!word)return alert("Selecione pelo menos o Word ou o PDF do novo documento.");const version={revision,reviewDate,workflow,note,createdBy:SESSION.user||"Administrador Proprietário",createdAt:nowBR()};
 try{
   if(pdf){version.pdfKey=`${id}|${revision}|pdf|${Date.now()}`;version.pdfName=pdf.name;await putDocBlob(version.pdfKey,pdf)}
   if(word){version.wordKey=`${id}|${revision}|word|${Date.now()}`;version.wordName=word.name;await putDocBlob(version.wordKey,word)}
 }catch(err){console.error(err);return alert("Não foi possível armazenar os arquivos selecionados neste navegador. Tente novamente ou cadastre sem anexos.")}
 S.docs.push({id,title,code,sector,type,period,seed:false,versions:[version]});auditAdmin(`SIASH Docs: documento ${code} adicionado à biblioteca.`);hideDocNewPanel();save();showToast("Documento adicionado à biblioteca",1400)
})
$("doc-revision-form").addEventListener("submit",async e=>{
 e.preventDefault();const i=+$("doc-revision-index").value,d=S.docs[i];if(!d)return alert("Documento não localizado.");if(!canDocEdit(d))return alert("Seu perfil documental não permite revisar este setor.");
 const revision=$("doc-revision-number").value.trim(),reviewDate=$("doc-revision-date").value||todayISO(),period=+$("doc-revision-period").value||d.period||24,note=$("doc-revision-note").value.trim(),sources=$("doc-revision-sources").value.trim(),pdf=$("doc-revision-pdf").files[0],word=$("doc-revision-word").files[0];if(!pdf&&!word)return alert("Selecione o Word ou PDF atualizado recebido da IA.");
 let vi=d.versions.findIndex(v=>String(v.revision).toLowerCase()===revision.toLowerCase()&&v.workflow!=="Vigente"&&v.workflow!=="Obsoleto"),version=vi>=0?d.versions[vi]:null;
 if(!version){version={revision,reviewDate,workflow:"Aguardando aprovação",note:note||"Revisão produzida com apoio de IA — aguardando conferência profissional.",sources,createdBy:SESSION.user||"Administrador Proprietário",createdAt:nowBR()};d.versions.push(version);vi=d.versions.length-1}else{version.reviewDate=reviewDate;version.workflow="Aguardando aprovação";if(note)version.note=note;if(sources)version.sources=sources;version.updatedAt=nowBR()}
 // v0.14.12c — reimportar um Word é uma nova proposta documental e invalida qualquer
 // preparação anterior. Sem este reset, um Word preparado indevidamente como Rev.03 poderia
 // permanecer marcado para FINALIZAR mesmo após a reimportação do Word correto Rev.02.
 if(word){version.publicationPrepared=false;version.publicationPreparedAt="";version.publicationPreparedBy="";version.preparedInstitutionalRevision="";version.institutionalValidity="";version.institutionalPreparationMode="";version.confirmedFinalPages=null;version.approvalEmbedded=false;version.approvalEmbeddedAt="";version.institutionalRevision="";version.institutionalRevisionDate="";version.importedInstitutionalRevision="";version.importedInstitutionalMonthYear="";version.importedInstitutionalDetectedAt=""}
 try{if(pdf){version.pdfKey=`${d.id}|${revision}|pdf|${Date.now()}`;version.pdfName=pdf.name;await putDocBlob(version.pdfKey,pdf)}if(word){version.wordKey=`${d.id}|${revision}|word|${Date.now()}`;version.wordName=word.name;await putDocBlob(version.wordKey,word);if(/\.docx$/i.test(word.name)){try{const z=await JSZip.loadAsync(word),f=z.file("word/document.xml");if(f){const x=await f.async("string"),h=historyTableData(x),rows=h?.info?.filter(r=>r.revision!==null)||[];if(rows.length){const latest=rows.reduce((a,b)=>a.revision>b.revision?a:b);version.importedInstitutionalRevision=String(latest.revision).padStart(2,"0");version.importedInstitutionalMonthYear=String(latest.cells?.[1]||"").trim();version.importedInstitutionalDetectedAt=nowBR();}}}catch(metaErr){console.warn("Não foi possível detectar a revisão institucional do Word importado",metaErr)}}}}catch(err){console.error(err);return alert("Não foi possível armazenar o arquivo desta revisão. Verifique as permissões do navegador.")}
 d.period=period;auditAdmin(`SIASH Docs: ${d.code} revisão ${revision} importada para conferência${version.importedInstitutionalRevision?` · Word institucional Rev.${version.importedInstitutionalRevision} detectado e preservado`:""}.`);save();showToast(`Revisão ${revision} pronta para conferência`,1500);renderProposalReady(i,vi);renderDocs();
})
$("huddle-form").addEventListener("submit",e=>{e.preventDefault();S.huddle.push({sector:$("h-sector").value,problem:$("h-problem").value.trim(),action:$("h-action").value.trim(),owner:$("h-owner").value.trim(),deadline:$("h-deadline").value,priority:$("h-priority").value,done:false});e.target.reset();save()})
$("swap-form").addEventListener("submit",e=>{e.preventDefault();S.rh.push({type:"Troca de plantão",name:$("swap-a").value.trim(),detail:`Substituto: ${$("swap-b").value.trim()} | ${dateBR($("swap-date-a").value)} ↔ ${dateBR($("swap-date-b").value)} | ${$("swap-reason").value.trim()}`,status:"Aguardando aprovação"});e.target.reset();save()})
$("point-form").addEventListener("submit",e=>{e.preventDefault();S.rh.push({type:"Inconsistência de ponto",name:$("point-name").value.trim(),detail:`${$("point-type").value} em ${dateBR($("point-date").value)} às ${$("point-time").value} | ${$("point-reason").value.trim()}`,status:"Aguardando aprovação"});e.target.reset();save()})
$("s-test-ai-fallback")?.addEventListener("click",runCloudflareFallbackDiagnostic);
$("settings-form").addEventListener("submit",e=>{e.preventDefault();if(!requireOwner("alterações nas Configurações da Unidade"))return;const beds=+$("s-beds").value,intensive=+$("s-intensive").value,intermediate=+$("s-intermediate").value;if(intensive+intermediate!==beds)return alert("Intensivos + intermediários deve ser igual ao total de leitos.");S.settings={unit:$("s-unit").value,beds,intensive,intermediate,target:+$("s-target").value,hospital:$("s-hospital").value,aiProvider:$("s-ai-provider")?.value||"auto"};auditAdmin("Configurações estruturais da unidade alteradas.");save();alert("Configurações salvas pelo Administrador Proprietário.")})
if($("admin-test-lock"))$("admin-test-lock").addEventListener("click",()=>{if(requireOwner("o teste administrativo")){auditAdmin("Teste de bloqueio estrutural executado com sucesso.");save();alert("Sessão proprietária validada: acesso estrutural autorizado.")}});$("export-local-backup")?.addEventListener("click",exportLocalBackup);
$("import-local-backup")?.addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{await importBackupFile(f,!!(SIASH_CLOUD.enabled&&SIASH_CLOUD.token))}catch(err){alert(err.message)}e.target.value=""});
$("d-date").value=todayISO();loadDailyForm($("d-date").value);$("picc-date").value=todayISO();$("picc-removal-date").value=todayISO();$("pipa-month").value=currentMonth();initSecurityUI();setInterval(renderClock,1000);setInterval(()=>{if(SESSION?.authenticated&&SIASH_CLOUD.enabled&&SIASH_CLOUD.token)void refreshMidnightCensusStatus()},30000);
$("doc-access-form")?.addEventListener("submit",e=>{
 e.preventDefault();if(!requireOwner("a gestão de acessos documentais"))return;
 const user=$("doc-access-user").value.trim(),sector=$("doc-access-sector").value.trim(),level=$("doc-access-level").value;
 if(!user||!sector)return;
 const sec=securityState()||{};sec.docAccess=sec.docAccess||{};sec.docAccess[user]={sector,level};setSecurityState(sec);
 auditAdmin(`Acesso documental definido: ${user} · ${sector} · ${level}`);renderDocAccessList();showToast("Acesso documental salvo",1200);
});
renderAll();
// v0.12.8 — base consolidada: cadastro assistido de novos documentos + conferência técnica em janela; preserva todas as regras v0.12.5.
