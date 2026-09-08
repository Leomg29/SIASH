const $=id=>document.getElementById(id);
const STORE="siash_utin_consolidada_v08";
const SECURITY_STORE="siash_security_v09";
let SESSION={authenticated:false,role:null,user:null};
const OPERATIONAL_USERS={"coordenacao.utin":"siash"};

const SIASH_CLOUD={
 enabled:location.protocol==="http:"||location.protocol==="https:",
 token:sessionStorage.getItem("siash_cloud_token")||"",
 lastSync:null,
 syncing:false
};
function cloudHeaders(extra={}){return {...extra,...(SIASH_CLOUD.token?{Authorization:"Bearer "+SIASH_CLOUD.token}:{})}}
async function cloudJson(url,opts={}){
 const res=await fetch(url,{...opts,headers:cloudHeaders({"Content-Type":"application/json",...(opts.headers||{})})});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error(data.error||`Erro Cloud ${res.status}`);
 return data;
}
async function cloudHealth(){if(!SIASH_CLOUD.enabled)return {ok:false,local:true};try{return await cloudJson("/api/health")}catch(e){return {ok:false,error:e.message}}}
async function cloudAuthenticate(username,password,bootstrap=false){
 if(!SIASH_CLOUD.enabled)throw new Error("Abra a SIASH pelo endereço Cloud (http/https), não pelo arquivo index.html.");
 const data=await cloudJson(bootstrap?"/api/bootstrap":"/api/login",{method:"POST",body:JSON.stringify({username,password})});
 SIASH_CLOUD.token=data.token;sessionStorage.setItem("siash_cloud_token",data.token);return data;
}
function cloudPayload(){return {state:S,security:securityState(),schema:"siash-0.14.11",savedAt:new Date().toISOString()}}
async function cloudLoadAfterLogin(){
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return false;
 const remote=await cloudJson("/api/state");
 if(remote.exists&&remote.payload?.state){
   S=remote.payload.state; if(remote.payload.security)setSecurityState(remote.payload.security);
   normalize();localStorage.setItem(STORE,JSON.stringify(S));SIASH_CLOUD.lastSync=remote.updated_at||new Date().toISOString();updateCloudBadge("Sincronizado");return true;
 }
 const localRaw=localStorage.getItem(STORE);
 if(localRaw){
   await cloudJson("/api/state/init",{method:"PUT",body:JSON.stringify({payload:cloudPayload()})});
   SIASH_CLOUD.lastSync=new Date().toISOString();updateCloudBadge("Dados locais migrados");return true;
 }
 return false;
}
let cloudSaveTimer=null;
function scheduleCloudSave(){
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return;
 clearTimeout(cloudSaveTimer);
 cloudSaveTimer=setTimeout(async()=>{
   if(SIASH_CLOUD.syncing)return;SIASH_CLOUD.syncing=true;updateCloudBadge("Salvando…");
   try{const r=await cloudJson("/api/state",{method:"PUT",body:JSON.stringify({payload:cloudPayload()})});SIASH_CLOUD.lastSync=r.updated_at||new Date().toISOString();updateCloudBadge("Sincronizado")}
   catch(e){console.error(e);updateCloudBadge("Offline · dados locais preservados",true)}
   finally{SIASH_CLOUD.syncing=false}
 },350);
}
function updateCloudBadge(text,bad=false){
 const el=document.getElementById("cloud-status");if(!el)return;el.textContent="Cloud: "+text;el.classList.toggle("cloud-bad",!!bad)
}
async function uploadDocCloud(key,file){
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token||!file)return;
 const res=await fetch("/api/doc/"+encodeURIComponent(key),{method:"PUT",headers:cloudHeaders({"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name||key)}),body:file});
 if(!res.ok)throw new Error("Falha ao sincronizar documento");
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
 if(toCloud&&SIASH_CLOUD.enabled&&SIASH_CLOUD.token){await cloudJson("/api/state",{method:"PUT",body:JSON.stringify({payload:cloudPayload(),reason:"Snapshot automático antes da migração de backup"})});updateCloudBadge("Backup migrado para Cloud")}
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
 if($("logged-role"))$("logged-role").textContent=owner?"Administrador Proprietário":"Usuário Operacional";
 if(owner&&$("admin-owner-name"))$("admin-owner-name").textContent=SESSION.user||"Proprietário";
 if($("doc-access-badge"))$("doc-access-badge").textContent=owner?"Super Admin · todos os setores":`${a.sector} · ${a.level==="validator"?"Validador":a.level==="editor"?"Editor/Revisor":"Leitor"}`;
}
function initSecurityUI(){
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
 bedMoves:[],profileHistory:[],movements:[],checklist:CHECKS.map(x=>({text:x,status:"Pendente"})),events:[],care:{},picc:[],pipa:[],pending:[],docs:[],huddle:[],rh:[],shiftStarted:new Date().toISOString()
}}
let S=JSON.parse(localStorage.getItem(STORE)||"null")||blankState();
function normalize(){if(!S.settings)S.settings=blankState().settings;if(!S.daily)S.daily=[];if(!S.beds||S.beds.length!==10)S.beds=blankState().beds;
S.beds.forEach((b,i)=>{if(typeof b.isolation==="undefined")b.isolation=i>=8;if(!b.profile)b.profile=b.type||"Intensivo";delete b.type});
if(!S.bedMoves)S.bedMoves=[];if(!S.profileHistory)S.profileHistory=[];if(!S.movements)S.movements=[];if(!S.checklist)S.checklist=blankState().checklist;if(!S.events)S.events=[];if(!S.care)S.care={};if(!S.picc)S.picc=[];S.picc.forEach(x=>{if(!x.insertDate)x.insertDate=isoFromLegacyWhen(x.when);if(!x.status)x.status="Ativo";if(x.status==="Retirado"&&!x.removalDate)x.removalDate=x.insertDate});if(!S.pipa)S.pipa=[];if(!S.pending)S.pending=[];if(!S.docs)S.docs=[];normalizeDocs();if(!S.huddle)S.huddle=[];if(!S.rh)S.rh=[]}
normalize();localStorage.setItem(STORE,JSON.stringify(S));
function save(){localStorage.setItem(STORE,JSON.stringify(S));scheduleCloudSave();renderAll()}
function currentMonth(){return monthOf(todayISO())}
function pipaMonthTotal(m){return S.pipa.filter(x=>x.month===m).reduce((total,row)=>total+(+row.qty||0),0)}
function monthStats(m){
 const rows=S.daily.filter(r=>monthOf(r.date)===m).sort((a,b)=>a.date.localeCompare(b.date));
 const sum=k=>rows.reduce((a,b)=>a+(+b[k]||0),0);
 const pd=sum("internados"),days=rows.length,ld=(S.settings.beds||10)*days,outs=sum("altas")+sum("transferencias")+sum("obitos");
 const latest=rows.length?rows[rows.length-1]:null;
 return{rows,pd,days,ld,outs,occ:ld?pd/ld*100:0,los:outs?pd/outs:0,adm:sum("admissoes"),altas:sum("altas"),transf:sum("transferencias"),deaths:sum("obitos"),pipa:pipaMonthTotal(m),canguru:sum("canguru"),picc:S.picc.filter(x=>monthOf(piccInsertDate(x))===m).length,piccDays:piccDaysInMonth(m),piccActive:S.picc.filter(x=>x.status==="Ativo").length,piccRemoved:S.picc.filter(x=>x.status==="Retirado"&&x.removalDate&&monthOf(x.removalDate)===m).length,pezinho:sum("pezinho"),vmDays:sum("vm"),vmCurrent:latest?(+latest.vm||0):0,intub:sum("intub"),extubProg:sum("extubProg"),extub:sum("extub"),lpp:sum("lpp")}
}
function allMonths(){const months=[...S.daily.map(r=>monthOf(r.date)),...S.pipa.map(r=>r.month),...S.picc.map(x=>monthOf(piccInsertDate(x))),...S.picc.filter(x=>x.removalDate).map(x=>monthOf(x.removalDate)),currentMonth()];return [...new Set(months.filter(Boolean))].sort()}
function dateBR(s){return s?s.split("-").reverse().join("/"):"—"}
function nowBR(){return new Date().toLocaleString("pt-BR")}
function parseISODate(s){if(!s)return null;const p=s.split("-").map(Number);if(p.length!==3||p.some(Number.isNaN))return null;return new Date(Date.UTC(p[0],p[1]-1,p[2]))}
function isoFromLegacyWhen(s){const m=String(s||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?`${m[3]}-${pad(m[2])}-${pad(m[1])}`:todayISO()}
function piccInsertDate(x){return x.insertDate||isoFromLegacyWhen(x.when)}
function piccDaysBetween(start,end){const a=parseISODate(start),b=parseISODate(end);if(!a||!b||b<a)return 0;return Math.floor((b-a)/86400000)+1}
function piccDays(x,end=todayISO()){const last=x.status==="Retirado"&&x.removalDate?x.removalDate:end;return piccDaysBetween(piccInsertDate(x),last)}
function piccInsertedOn(date){return S.picc.filter(x=>piccInsertDate(x)===date).length}
function piccDaysInMonth(m){const y=+m.slice(0,4),mo=+m.slice(5,7),monthStart=`${m}-01`,monthEnd=`${m}-${pad(new Date(y,mo,0).getDate())}`,today=todayISO();let total=0;S.picc.forEach(x=>{const start=piccInsertDate(x);const stop=x.status==="Retirado"&&x.removalDate?x.removalDate:today;const a=start>monthStart?start:monthStart;const b=stop<monthEnd?stop:monthEnd;if(b>=a)total+=piccDaysBetween(a,b)});return total}
function populateBedSelects(){document.querySelectorAll(".bed-select").forEach(sel=>{const current=sel.value;let first=sel.id==="pending-bed"?'<option value="Geral / Setor">Geral / Setor</option>':'<option value="">Selecione</option>';sel.innerHTML=first+S.beds.map(b=>`<option value="${b.n}">Leito ${pad(b.n)} — ${b.profile}${b.isolation?" — Isolamento":""} — ${b.status}</option>`).join("");if([...sel.options].some(o=>o.value===current))sel.value=current})}
function renderClock(){const d=new Date();$("clock-date").textContent=d.toLocaleDateString("pt-BR");$("clock-time").textContent=d.toLocaleTimeString("pt-BR");const h=d.getHours();$("shift-label").textContent=h>=7&&h<19?"Diurno 07h–19h":"Noturno 19h–07h"}
function renderDashboard(){const m=currentMonth(),c=monthStats(m);$("m-pacientedias").textContent=c.pd;$("m-ocupacao").textContent=fmt(c.occ,1)+"%";$("m-permanencia").textContent=c.outs?fmt(c.los,1)+" d":"—";$("m-admissoes").textContent=c.adm;$("m-transferencias").textContent=c.transf;$("m-pipa").textContent=pipaMonthTotal(m);$("m-leitosdia").textContent=c.ld;$("m-diaslancados").textContent=c.days;const totalDays=new Date(+m.slice(0,4),+m.slice(5,7),0).getDate();$("m-diaspendentes").textContent=Math.max(0,totalDays-c.days);$("m-pendencias").textContent=S.pending.filter(x=>!x.done).length;
 const recent=[...c.rows].sort((a,b)=>a.date.localeCompare(b.date)).slice(-10);$("occupancy-bars").innerHTML=recent.length?recent.map(r=>{const p=Math.min(100,(r.internados/(S.settings.beds||10))*100);return`<div class="bar-item"><div class="bar-value">${p.toFixed(0)}%</div><div class="bar" style="height:${p}%"></div><div class="bar-label">${r.date.slice(8)}</div></div>`}).join(""):'<span class="muted">Sem lançamentos nesta competência.</span>';
 const alerts=[];if(c.days===0)alerts.push({t:"warn",x:"Ainda não há lançamento diário nesta competência."});else if(c.occ<S.settings.target)alerts.push({t:"warn",x:`Taxa de ocupação (${fmt(c.occ,1)}%) abaixo da meta configurada (${S.settings.target}%).`});else alerts.push({t:"ok",x:"Taxa de ocupação em ou acima da meta configurada."});if(S.pending.some(x=>!x.done&&x.priority==="Crítica"))alerts.push({t:"bad",x:"Existe pendência crítica aberta para continuidade."});if(S.docs.some(d=>docStatus(d).key==="expired"))alerts.push({t:"bad",x:"Há documento/POP com revisão vencida no SIASH Docs."});$("alerts").innerHTML=alerts.map(a=>`<div class="alert ${a.t}">${safe(a.x)}</div>`).join("");
 $("executive-summary").textContent=c.days?`Na competência ${m.split("-").reverse().join("/")}, foram registrados ${c.pd} pacientes-dia em ${c.days} dia(s), com taxa de ocupação de ${fmt(c.occ,1)}%. Houve ${c.adm} admissões, ${c.altas} altas, ${c.transf} transferências e ${c.deaths} óbitos. ${c.outs?`A média de permanência calculada é ${fmt(c.los,1)} dias.`:"Ainda não há saídas suficientes para média de permanência."}`:"O painel será atualizado automaticamente à medida que os lançamentos diários forem salvos."}
function renderShift(){const score=checkScore();$("shift-steps").innerHTML=STEPS.map((x,i)=>`<div class="check-row"><strong>${i+1}</strong><span>${x}</span></div>`).join("");$("timeline").innerHTML=S.events.length?S.events.map(e=>`<div class="event"><strong>${safe(e.when)} • ${safe(e.type)}</strong><br>${e.bed?`Leito ${safe(e.bed)} — `:""}${safe(e.text)}</div>`).join(""):'<span class="muted">Nenhum evento registrado neste plantão.</span>';$("shift-summary").innerHTML=`<div class="cards"><article class="metric-card"><span>Checklist</span><strong>${score}%</strong></article><article class="metric-card"><span>Pendências abertas</span><strong>${S.pending.filter(x=>!x.done).length}</strong></article><article class="metric-card"><span>Eventos registrados</span><strong>${S.events.length}</strong></article><article class="metric-card"><span>Leitos ocupados</span><strong>${S.beds.filter(b=>b.status==="Ocupado").length}/10</strong></article></div>`}
function checkScore(){const app=S.checklist.filter(c=>c.status!=="N/A");return app.length?Math.round(app.filter(c=>c.status==="Realizado").length/app.length*100):0}
const DAILY_FIELD_MAP={internados:"d-internados",admissoes:"d-admissoes",altas:"d-altas",transferencias:"d-transferencias",obitos:"d-obitos",pipa:"d-pipa",canguru:"d-canguru",picc:"d-picc",pezinho:"d-pezinho",intub:"d-intub",vm:"d-vm",extubProg:"d-extub-prog",extub:"d-extub",lpp:"d-lpp"};
function loadDailyForm(date){const r=S.daily.find(x=>x.date===date);Object.entries(DAILY_FIELD_MAP).forEach(([k,id])=>{$(id).value=k==="picc"?piccInsertedOn(date):(r?(+r[k]||0):0)});$("d-obs").value=r?(r.obs||""):""}
function renderDaily(){const date=$("d-date").value||todayISO();if(!$("d-date").value)$("d-date").value=date;const m=monthOf(date),c=monthStats(m);$("competence-label").textContent="Competência "+m.split("-").reverse().join("/");$("d-kpi-pd").textContent=c.pd;$("d-kpi-ld").textContent=c.ld;$("d-kpi-occ").textContent=fmt(c.occ,1)+"%";$("d-kpi-outs").textContent=c.outs;$("d-kpi-los").textContent=c.outs?fmt(c.los,1)+" d":"—";$("d-kpi-days").textContent=c.days;if($("d-kpi-vm-current"))$("d-kpi-vm-current").textContent=c.vmCurrent;if($("d-kpi-vm-days"))$("d-kpi-vm-days").textContent=c.vmDays;$("daily-table").innerHTML=[...c.rows].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr><td>${dateBR(r.date)}</td><td>${r.internados}</td><td>${r.admissoes}</td><td>${r.altas}</td><td>${r.transferencias}</td><td>${r.obitos}</td><td>${r.pipa}</td><td>${r.canguru}</td><td>${piccInsertedOn(r.date)}</td><td>${r.pezinho}</td><td>${+r.intub||0}</td><td>${+r.vm||0}</td><td>${+r.extubProg||0}</td><td>${+r.extub||0}</td><td><button class="ghost" onclick="deleteDaily('${r.date}')">Excluir</button></td></tr>`).join("")||'<tr><td colspan="15">Nenhum lançamento.</td></tr>'}
window.deleteDaily=date=>{if(confirm("Excluir este lançamento?")){S.daily=S.daily.filter(r=>r.date!==date);if($("d-date").value===date)loadDailyForm(date);save()}}
function renderBeds(){
 populateBedSelects();
 $("bed-grid").innerHTML=S.beds.map(b=>`<div class="bed-card ${b.status==="Ocupado"?"occupied":""} ${b.profile==="Intermediário"?"intermediate":""} ${b.status==="Bloqueado"?"blocked":""}">
 <div class="title"><span>Leito ${pad(b.n)}</span><span>${b.status}</span></div>
 <div class="type">${b.profile}${b.isolation?' • Isolamento':''}</div>
 <div class="patient">${safe(b.rn||"Sem identificador")}</div><small>${safe(b.note||"")}</small></div>`).join("");
 $("profile-history-table").innerHTML=[...S.profileHistory].reverse().map(x=>`<tr><td>${safe(x.when)}</td><td>Leito ${pad(x.bed)}</td><td>${safe(x.rn)}</td><td>${safe(x.from)}</td><td>${safe(x.to)}</td><td>${safe(x.note)}</td></tr>`).join("")||'<tr><td colspan="6">Nenhuma alteração de perfil registrada.</td></tr>';
 $("bed-moves-table").innerHTML=[...S.bedMoves].reverse().map(x=>`<tr><td>${safe(x.when)}</td><td>Leito ${pad(x.origin)}</td><td>Leito ${pad(x.target)}</td><td>${safe(x.rn)}</td><td>${safe(x.profile||"—")}</td><td>${safe(x.note)}</td></tr>`).join("")||'<tr><td colspan="6">Nenhum remanejamento físico registrado.</td></tr>';
}
function updateMovementFields(){const t=$("mv-type").value,lab=$("mv-context-label"),input=$("mv-context"),help=$("mv-help");input.disabled=false;if(t==="Admissão"){lab.childNodes[0].nodeValue="Município de origem";input.placeholder="Ex.: Pirapora";help.innerHTML="Na admissão, informe de qual município o RN é proveniente."}else if(t==="Alta"){lab.childNodes[0].nodeValue="Destino após alta";input.placeholder="Ex.: Domicílio";help.innerHTML="Registre o destino após a alta quando pertinente."}else if(t==="Transferência"){lab.childNodes[0].nodeValue="Destino da transferência";input.placeholder="Ex.: outro hospital / setor";help.innerHTML="Informe para onde o RN foi transferido."}else if(t==="Óbito"){lab.childNodes[0].nodeValue="Origem / Destino";input.value="";input.disabled=true;help.innerHTML="Para óbito, este campo não se aplica."}else if(t==="Encaminhamento PIPA"){lab.childNodes[0].nodeValue="Município do PIPA";input.placeholder="Município";help.innerHTML="Informe o município correspondente ao encaminhamento PIPA."}else{lab.childNodes[0].nodeValue="Destino";input.value="Pediatria / Leito Canguru";help.innerHTML="Alta da Neonatal com destino à Pediatria / leito Canguru."}}
function renderMovements(){$("movement-table").innerHTML=[...S.movements].reverse().map(x=>`<tr><td>${safe(x.when)}</td><td>${safe(x.type)}</td><td>${safe(x.bedtype)}</td><td>${safe(x.context)}</td><td>${safe(x.note)}</td></tr>`).join("")||'<tr><td colspan="5">Nenhuma movimentação registrada.</td></tr>';updateMovementFields()}
function renderChecklist(){$("checklist-score").textContent="Adesão "+checkScore()+"%";$("checklist-list").innerHTML=S.checklist.map((c,i)=>`<div class="check-row"><span>${safe(c.text)}</span><select onchange="setCheck(${i},this.value)">${["Pendente","Realizado","Não realizado","N/A"].map(v=>`<option ${c.status===v?"selected":""}>${v}</option>`).join("")}</select></div>`).join("")}
window.setCheck=(i,v)=>{S.checklist[i].status=v;save()}
function renderCare(){$("care-table").innerHTML=Object.entries(S.care).sort((a,b)=>+a[0]-+b[0]).map(([bed,x])=>`<tr><td>Leito ${pad(bed)}</td><td>${safe(x.sae)}</td><td>${safe(x.evol)}</td><td>${safe(x.multi)}</td><td>${safe(x.updated)}</td></tr>`).join("")||'<tr><td colspan="5">Nenhum status assistencial registrado.</td></tr>'}
function renderPicc(){
 const m=currentMonth(),active=S.picc.map((x,i)=>({x,i})).filter(({x})=>x.status==="Ativo").sort((a,b)=>+a.x.bed-+b.x.bed),removed=S.picc.map((x,i)=>({x,i})).filter(({x})=>x.status==="Retirado").sort((a,b)=>(b.x.removalDate||"").localeCompare(a.x.removalDate||""));
 $("picc-active-count").textContent=active.length;$("picc-days-month").textContent=piccDaysInMonth(m);$("picc-removed-month").textContent=S.picc.filter(x=>x.status==="Retirado"&&x.removalDate&&monthOf(x.removalDate)===m).length;
 $("picc-active-table").innerHTML=active.map(({x,i})=>`<tr>
 <td><strong>Leito ${pad(x.bed)}</strong></td><td>${dateBR(piccInsertDate(x))}</td><td><strong>D${piccDays(x)}</strong> (${piccDays(x)} dia${piccDays(x)===1?"":"s"})</td><td>${safe(x.vein)} / ${safe(x.side)}</td>
 <td>${x.punctures}</td><td>${safe(x.position)}</td><td class="${x.bundle?"status-ok":"status-bad"}">${x.bundle?"Conforme":"Não conforme"}</td><td><span class="device-status active">Ativo</span></td>
 <td><button class="ghost" onclick="editPicc(${i})">Editar</button> <button class="secondary compact-btn" onclick="startPiccRemoval(${i})">Registrar retirada</button> <button class="ghost danger-text" onclick="deletePicc(${i})">Excluir</button></td>
 </tr>`).join("")||'<tr><td colspan="9">Nenhum PICC ativo.</td></tr>';
 $("picc-history-table").innerHTML=removed.map(({x,i})=>`<tr><td>Leito ${pad(x.bed)}</td><td>${dateBR(piccInsertDate(x))}</td><td>${dateBR(x.removalDate)}</td><td>${piccDays(x)}</td><td>${safe(x.removalReason||"—")}</td><td>${safe(x.vein)} / ${safe(x.side)}</td><td><button class="ghost" onclick="editPicc(${i})">Ver/editar</button> <button class="ghost danger-text" onclick="deletePicc(${i})">Excluir</button></td></tr>`).join("")||'<tr><td colspan="7">Nenhum PICC retirado registrado.</td></tr>';
}

function clearPiccForm(){
 $("picc-edit-index").value="";$("picc-date").value=todayISO();$("picc-bed").value="";$("picc-vein").value="";$("picc-side").value="Direita";$("picc-punctures").value=1;$("picc-length").value="";$("picc-external").value="";$("picc-position").value="Sim";$("picc-b1").value="Sim";$("picc-b2").value="Sim";$("picc-b3").value="Sim";$("picc-save-btn").textContent="Registrar PICC";$("picc-cancel-edit").classList.add("hidden");$("picc-edit-note").classList.add("hidden");
}
window.editPicc=i=>{
 const x=S.picc[i];if(!x)return;$("picc-edit-index").value=String(i);$("picc-date").value=piccInsertDate(x);$("picc-bed").value=String(x.bed);$("picc-vein").value=x.vein;$("picc-side").value=x.side;$("picc-punctures").value=x.punctures;$("picc-length").value=x.length||"";$("picc-external").value=x.external||"";$("picc-position").value=x.position;$("picc-b1").value=x.b1||"Sim";$("picc-b2").value=x.b2||"Sim";$("picc-b3").value=x.b3||"Sim";$("picc-save-btn").textContent="Salvar alteração";$("picc-cancel-edit").classList.remove("hidden");$("picc-edit-note").classList.remove("hidden");document.querySelector('[data-view="picc"]').click();window.scrollTo({top:0,behavior:"smooth"});
}
window.startPiccRemoval=i=>{
 const x=S.picc[i];if(!x||x.status!=="Ativo")return;$("picc-removal-index").value=String(i);$("picc-removal-date").value=todayISO();$("picc-removal-reason").value="";$("picc-removal-note").value="";$("picc-removal-target").textContent=`Leito ${pad(x.bed)} • inserido em ${dateBR(piccInsertDate(x))} • D${piccDays(x)}`;$("picc-removal-panel").classList.remove("hidden");$("picc-removal-panel").scrollIntoView({behavior:"smooth",block:"center"});
}
function cancelPiccRemoval(){$("picc-removal-index").value="";$("picc-removal-reason").value="";$("picc-removal-note").value="";$("picc-removal-panel").classList.add("hidden")}
window.deletePicc=i=>{
 const x=S.picc[i];if(!x)return;if(confirm(`Excluir definitivamente o registro de PICC do Leito ${pad(x.bed)}?\n\nUse esta opção apenas para corrigir um lançamento indevido. Para retirada clínica, use Registrar retirada.`)){S.picc.splice(i,1);clearPiccForm();cancelPiccRemoval();save();showToast("Registro de PICC excluído",1200)}
}

function renderPipa(){const m=$("pipa-month").value||currentMonth();if(!$("pipa-month").value)$("pipa-month").value=m;const rows=S.pipa.filter(x=>x.month===m),total=rows.reduce((a,b)=>a+(+b.qty||0),0),g={};rows.forEach(r=>g[r.city]=(g[r.city]||0)+(+r.qty||0));$("pipa-total").textContent=total;$("pipa-cities").textContent=Object.values(g).filter(x=>x>0).length;$("pipa-competence").textContent=m.split("-").reverse().join("/");$("pipa-updated").textContent=S.pipa.length?S.pipa[S.pipa.length-1].updated:"—";const entries=Object.entries(g).filter(([,q])=>q>0),max=Math.max(1,...entries.map(([,q])=>q));$("pipa-bars").innerHTML=entries.length?entries.map(([c,q])=>`<div class="bar-item"><div class="bar-value">${q}</div><div class="bar" style="height:${Math.max(5,q/max*100)}%"></div><div class="bar-label">${safe(c)}</div></div>`).join(""):'<span class="muted">Sem encaminhamentos nesta competência.</span>';$("pipa-table").innerHTML=[...S.pipa].reverse().map((r,idx)=>`<tr><td>${r.month.split("-").reverse().join("/")}</td><td>${safe(r.city)}</td><td>${r.qty}</td><td>${safe(r.note)}</td><td><button class="ghost" onclick="deletePipa(${S.pipa.length-1-idx})">Excluir</button></td></tr>`).join("")||'<tr><td colspan="5">Nenhum encaminhamento registrado.</td></tr>'}
window.deletePipa=i=>{S.pipa.splice(i,1);save()}
function renderPending(){$("pending-list").innerHTML=S.pending.length?S.pending.map((p,i)=>`<div class="pending-row"><input type="checkbox" ${p.done?"checked":""} onchange="togglePending(${i})"><span><strong>${safe(p.bed)}</strong> • ${safe(p.priority)} — ${safe(p.text)}</span></div>`).join(""):'<span class="muted">Sem pendências.</span>'}
window.togglePending=i=>{S.pending[i].done=!S.pending[i].done;save()}
function fillMonthSelect(id){const sel=$(id),cur=sel.value;sel.innerHTML=allMonths().map(m=>`<option value="${m}">${m.split("-").reverse().join("/")}</option>`).join("");sel.value=allMonths().includes(cur)?cur:currentMonth()}
function renderIndicators(){fillMonthSelect("indicator-month");const m=$("indicator-month").value,c=monthStats(m);$("i-pd").textContent=c.pd;$("i-occ").textContent=fmt(c.occ,1)+"%";$("i-los").textContent=c.outs?fmt(c.los,1)+" d":"—";$("i-adm").textContent=c.adm;$("i-transf").textContent=c.transf;$("i-deaths").textContent=c.deaths;const prod=[["Dias lançados",c.days],["Leitos-dia",c.ld],["Saídas",c.outs],["Altas",c.altas],["PIPA",c.pipa],["Altas p/ Pediatria/Canguru",c.canguru],["PICCs inseridos",c.picc],["PICC-dia",c.piccDays],["PICCs ativos atualmente",c.piccActive],["PICCs retirados",c.piccRemoved],["Testes do pezinho",c.pezinho],["RN em VM atualmente",c.vmCurrent],["VM-dia no mês",c.vmDays],["Intubações no mês",c.intub],["Extubações programadas",c.extubProg],["Extubações acidentais",c.extub],["Lesões por pressão",c.lpp]];$("indicator-production").innerHTML=prod.map(x=>`<tr><th>${x[0]}</th><td>${x[1]}</td></tr>`).join("");const g={};S.pipa.filter(x=>x.month===m).forEach(r=>g[r.city]=(g[r.city]||0)+(+r.qty||0));$("indicator-pipa-cities").innerHTML=Object.entries(g).sort((a,b)=>b[1]-a[1]).map(([c,q])=>`<tr><td>${safe(c)}</td><td>${q}</td></tr>`).join("")||'<tr><td colspan="2">Sem dados PIPA por município.</td></tr>'}
function renderComparison(){
 const months=allMonths(),data=months.map(m=>({m,...monthStats(m)}));
 const maxOcc=Math.max(100,...data.map(x=>x.occ)),maxLos=Math.max(1,...data.map(x=>x.los)),maxPd=Math.max(1,...data.map(x=>x.pd));
 $("comparison-occ").innerHTML=data.map(x=>`<div class="bar-item"><div class="bar-value">${fmt(x.occ,1)}%</div><div class="bar" style="height:${Math.max(2,x.occ/maxOcc*100)}%"></div><div class="bar-label">${x.m.slice(5)}/${x.m.slice(2,4)}</div></div>`).join("");
 $("comparison-los").innerHTML=data.map(x=>`<div class="bar-item"><div class="bar-value">${x.outs?fmt(x.los,1):"—"}</div><div class="bar" style="height:${x.outs?Math.max(2,x.los/maxLos*100):2}%"></div><div class="bar-label">${x.m.slice(5)}/${x.m.slice(2,4)}</div></div>`).join("");
 $("comparison-pd").innerHTML=data.map(x=>`<div class="bar-item"><div class="bar-value">${x.pd}</div><div class="bar" style="height:${Math.max(2,x.pd/maxPd*100)}%"></div><div class="bar-label">${x.m.slice(5)}/${x.m.slice(2,4)}</div></div>`).join("");
 if(data.length>=2){
   const a=data[data.length-2],b=data[data.length-1],d=b.occ-a.occ,pdDiff=b.pd-a.pd;
   $("comparison-text").textContent=`Na comparação entre ${a.m.split("-").reverse().join("/")} e ${b.m.split("-").reverse().join("/")}, a taxa de ocupação apresentou ${d>=0?"aumento":"redução"} de ${fmt(Math.abs(d),1)} ponto(s) percentual(is). O total de pacientes-dia ${pdDiff>=0?"aumentou":"reduziu"} em ${Math.abs(pdDiff)}.`;
 } else $("comparison-text").textContent="Inclua lançamentos em mais de uma competência para gerar leitura comparativa.";
}
function addMonths(dateStr,n){if(!dateStr)return"";const d=new Date(dateStr+"T12:00:00");d.setMonth(d.getMonth()+n);return d.toISOString().slice(0,10)}
const DOCS_DB="siash_docs_files_v1",DOCS_DB_STORE="files";
function docsDb(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(new Error("IndexedDB indisponível"));const req=indexedDB.open(DOCS_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DOCS_DB_STORE))db.createObjectStore(DOCS_DB_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function putDocBlob(key,file){
 if(!file)return null;const db=await docsDb();
 await new Promise((resolve,reject)=>{const tx=db.transaction(DOCS_DB_STORE,"readwrite");tx.objectStore(DOCS_DB_STORE).put(file,key);tx.oncomplete=()=>{db.close();resolve(key)};tx.onerror=()=>{db.close();reject(tx.error)}});
 try{await uploadDocCloud(key,file)}catch(e){console.warn("Documento preservado localmente; sincronização Cloud pendente.",e);updateCloudBadge("Documento pendente de sincronização",true)}
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
async function openDocVersion(docIndex,versionIndex,kind){
 const d=S.docs[docIndex],v=d?.versions?.[versionIndex];if(!v)return alert("Versão não localizada.");
 const key=v[kind+"Key"],path=v[kind+"Path"],name=v[kind+"Name"]||`${d.code}_Rev${v.revision}.${kind==="pdf"?"pdf":"docx"}`;
 try{
   if(key){let blob=await getDocBlob(key);if(!blob)return alert("Arquivo local não localizado neste navegador.");if(kind==="word"&&v.publicationPrepared){const san=await sanitizePreparedWordBlob(d,v);if(san.blob)blob=san.blob;if(san.changed)showToast("Word preparado saneado · reabra e confira a paginação",2200)}const url=URL.createObjectURL(blob);if(kind==="pdf"){window.open(url,"_blank");setTimeout(()=>URL.revokeObjectURL(url),60000)}else{const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}return}
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
function scientificAuditForDoc(d){return SCIENTIFIC_AUDIT_UI[String(d?.code||"").trim()]||null}
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
window.sendDocToAI=async i=>{
 const d=S.docs[i],pub=docPublishedVersion(d),pubI=docPublishedIndex(d);if(!d||!pub)return alert("Versão vigente não localizada.");
 if(!SIASH_CLOUD.enabled||!SIASH_CLOUD.token)return alert("A atualização automática com IA está disponível somente na SIASH Cloud.");
 if(!(pub.wordKey||pub.wordPath))return alert("Para preservar a estrutura institucional, a revisão automática exige o arquivo Word vigente. Migre/anexe o Word antes de continuar.");
 const rev=$("doc-revision-number").value.trim();if(!confirm(`Gerar com IA a proposta de revisão ${rev} de ${d.code}? A versão vigente NÃO será substituída nem publicada.`))return;
 const btn=$("doc-send-ai"),status=$("doc-update-status");btn.disabled=true;status.textContent="IA analisando o POP e preparando uma proposta técnica... Isso pode levar alguns minutos.";
 try{
   if(isLegacyWordName(pub.wordName||pub.wordPath||"")){status.textContent="Word antigo .doc identificado. Convertendo com segurança para .docx antes da revisão...";await ensureVersionWordIsDocx(d,pub);save();renderDocs()}
   let blob;if(pub.wordKey)blob=await getDocBlob(pub.wordKey);else{const r=await fetch(pub.wordPath);if(!r.ok)throw new Error("Word vigente não pôde ser aberto.");blob=await r.blob()}
   if(!blob)throw new Error("Arquivo Word vigente não localizado.");const buf=await blob.arrayBuffer(),bytes=new Uint8Array(buf);let bin="";for(let o=0;o<bytes.length;o+=0x8000)bin+=String.fromCharCode(...bytes.subarray(o,o+0x8000));
   const revisionStatus=docStatus(d),periodicReviewRequired=!!d.reviewRequired||["review","expired","priority","soon"].includes(revisionStatus.key);
   const periodicReviewReason=periodicReviewRequired?(`Revisão documental ${revisionStatus.text||"programada"}${revisionStatus.next?` · próxima revisão prevista: ${dateBR(revisionStatus.next)}`:""}`):"Atualização técnica solicitada pelo profissional";
   const ai=await cloudJson("/api/ai/revise-pop",{method:"POST",body:JSON.stringify({doc_code:d.code,doc_title:d.title,current_revision:pub.revision,next_revision:rev,file_name:pub.wordName||`${d.code}.docx`,file_base64:btoa(bin),provider:S.settings?.aiProvider||"auto",correction_request:((d.versions||[]).find((x,xi)=>xi!==pubI&&String(x.revision)===rev&&x.workflow!=="Obsoleto")?.correctionRequested||""),periodic_review_required:periodicReviewRequired,periodic_review_reason:periodicReviewReason})});
   const out=Uint8Array.from(atob(ai.file_base64),c=>c.charCodeAt(0)),proposalBlob=new Blob([out],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
   let vi=d.versions.findIndex((v,x)=>x!==pubI&&String(v.revision)===rev&&v.workflow!=="Obsoleto"),v=vi>=0?d.versions[vi]:null;if(!v){v={revision:rev,reviewDate:todayISO(),workflow:"Em revisão",createdBy:"SIASH Docs / IA",createdAt:nowBR()};d.versions.push(v);vi=d.versions.length-1}
   const periodicReviewOnly=ai.verification?.periodicReviewOnly===true;
   if(!ai.verification?.verified||(!(Number(ai.verification?.actualChanges)>0)&&!periodicReviewOnly))throw new Error("A SIASH não conseguiu comprovar alterações reais nem caracterizar uma revisão documental periódica válida. A proposta não será salva para aprovação.");
   v.publicationPrepared=false;v.publicationPreparedAt="";v.publicationPreparedBy="";v.preparedInstitutionalRevision="";v.periodicReviewOnly=periodicReviewOnly;v.aiSummary=String(ai.summary||"").replace(/\s+/g," ").trim();if(periodicReviewOnly&&!v.aiSummary)v.aiSummary="Conteúdo técnico mantido sem alterações após revisão periódica assistida.";v.note=periodicReviewOnly?`PROPOSTA de revisão periódica verificada pelo SIASH. Conteúdo técnico mantido sem alterações. A vigência somente será renovada após conferência e aprovação profissional. ${v.aiSummary}`:`PROPOSTA gerada por IA e verificada pelo SIASH (${ai.verification.actualChanges} alteração(ões) aplicada(s)). ${v.aiSummary}`;v.aiReferences=(ai.references||[]).map(x=>({title:x.title||"",url:x.url||"",status:x.status||"pending",reason:x.reason||"",wordEligible:x.wordEligible===true,wordEligibilityReason:x.wordEligibilityReason||""}));v.sources=v.aiReferences.map(x=>`${x.title}: ${x.url}${x.wordEligible?"":" [somente auditoria SIASH — não inserida no Word]"}`).join("\n");v.aiProvider=ai.provider||"—";v.aiModel=ai.model;v.aiVerified=true;v.aiVerification=ai.verification;v.aiChanges=(ai.changes||[]).map(x=>({paragraph_index:x.paragraph_index,before_text:x.before_text,new_text:x.new_text,reason:x.reason,references:Array.isArray(x.references)?x.references:[]}));v.wordKey=`${d.id}|${rev}|word|${Date.now()}`;v.wordName=ai.file_name||`${d.code}_Rev${rev}_PROPOSTA_IA.docx`;await putDocBlob(v.wordKey,new File([proposalBlob],v.wordName,{type:proposalBlob.type}));
   auditAdmin(`SIASH Docs: ${d.code} revisão ${rev} gerada automaticamente com IA para conferência profissional.`);save();renderDocs();renderProposalReady(i,vi);showDocHistory(i);const mode=["google_search","web_search"].includes(ai.researchMode)?"com pesquisa web atual":"sem pesquisa web automática";status.textContent=periodicReviewOnly?`Revisão periódica ${rev} preparada com ${ai.provider||"IA"} (${ai.model||"modelo"}), sem alteração técnico-científica necessária. A vigência só será renovada após conferência e publicação humana.`:`Proposta ${rev} gerada com ${ai.provider||"IA"} (${ai.model||"modelo"}), ${mode}. Abra o Word atualizado, confira referências e conteúdo e somente depois aprove.`;showToast(periodicReviewOnly?"Revisão periódica pronta para conferência":"Proposta de revisão gerada pela IA",2200)
 }catch(e){console.error(e);status.textContent="A proposta não foi gerada.";alert(e.message||"Falha na atualização com IA.")}finally{btn.disabled=false}
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
function renderProposalReady(i,vi){const box=$("doc-proposal-ready"),actions=$("doc-proposal-actions");if(!box||!actions)return;const d=S.docs[i],v=(vi>=0?d?.versions?.[vi]:null);const hasFile=!!(v&&(v.wordKey||v.wordPath||v.pdfKey||v.pdfPath));box.classList.toggle("hidden",!hasFile);if(!hasFile){ACTIVE_DOC_PROPOSAL=null;actions.innerHTML="";return}setActiveDocProposal(i,vi);const n=Number(v.aiVerification?.actualChanges||v.aiChanges?.length||0),verified=v.aiVerified===true,periodicOnly=v.periodicReviewOnly===true||v.aiVerification?.periodicReviewOnly===true;const aiTrace=v.aiProvider?` IA utilizada: ${aiProviderLabel(v.aiProvider)}${v.aiModel?` · ${v.aiModel}`:""}.`:"";$("doc-proposal-ready-text").textContent=`${d.code} — ${d.title} · revisão ${v.revision}. `+(verified?(periodicOnly?`Revisão periódica validada pelo SIASH: conteúdo técnico mantido sem alterações.${aiTrace} A nova vigência só será efetivada após conferência e aprovação profissional.`:`SIASH comprovou ${n} alteração(ões) real(is) no Word.${aiTrace} Abra e confira antes de aprovar.`):`Proposta disponível para conferência.${aiTrace} Esta proposta foi criada antes da verificação automática da v0.12.8; confira o Word com atenção.`);const diffBtn=v.aiChanges?.length?`<button class="ghost" type="button" onclick="showAIChanges(${i},${vi})">VER ALTERAÇÕES APLICADAS</button>`:"";actions.innerHTML=`${v.wordKey||v.wordPath?`<button class="secondary" type="button" onclick="openDocVersion(${i},${vi},'word')">ABRIR WORD ATUALIZADO</button>`:""}${v.pdfKey||v.pdfPath?`<button class="secondary" type="button" onclick="openDocVersion(${i},${vi},'pdf')">ABRIR PDF ATUALIZADO</button>`:""}${diffBtn}${v.publicationPrepared?`<button class="primary" type="button" onclick="finalizePreparedPublication(${i},${vi})">FINALIZAR PUBLICAÇÃO</button>`:`<button class="primary" type="button" onclick="validateDocProposal(${i},${vi})">PREPARAR PUBLICAÇÃO</button>`}<button class="ghost" type="button" onclick="requestDocCorrection(${i},${vi})">SOLICITAR CORREÇÃO</button>`}
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
function historyTableData(xml){
 const m=xml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?Controle Hist[óo]rico[\s\S]*?<\/w:tbl>/i);if(!m)return null;
 const table=m[0],rows=[...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(x=>x[0]);
 const info=rows.map(row=>{const cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(x=>[...x[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(y=>y[1].replace(/<[^>]+>/g,"")).join("").replace(/\s+/g," ").trim());return {row,cells,revision:(cells.length>=7&&/^\d{1,3}$/.test(cells[0]))?Number(cells[0]):null}});
 return {table,rows,info};
}
function nextInstitutionalRevisionFromXml(xml){const h=historyTableData(xml);if(!h)return null;const nums=h.info.filter(x=>x.revision!==null).map(x=>x.revision);if(!nums.length)return null;return String(Math.max(...nums)+1).padStart(2,"0")}
function normalizeMonthYearText(s=""){return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"").replace(/\//g,"/").toLowerCase()}
function priorPublishedVersion(d,v){return (d?.versions||[]).filter(x=>x!==v&&x.workflow==="Vigente").slice(-1)[0]||null}
function shouldReuseLatestInstitutionalRevision(d,v,rowInfo){
 if(!rowInfo||rowInfo.revision===null)return false;const c=rowInfo.cells||[];
 const authoredBySiash=/SIASH\s*Docs/i.test(c[4]||"");if(!authoredBySiash)return false;
 // v0.14.3 — idempotência do ciclo institucional:
 // se a última linha institucional foi criada pelo SIASH Docs na MESMA competência (mês/ano),
 // ela é a revisão institucional do ciclo e deve ser REUTILIZADA. Revisões internas, correções,
 // reprocessamentos ou testes do mesmo ciclo não podem gerar 04→05→06 no Word.
 // Uma nova revisão institucional só é aberta quando muda a competência institucional.
 return normalizeMonthYearText(c[1]||"")===normalizeMonthYearText(currentMonthYearPT());
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
 try{const zip=await JSZip.loadAsync(blob),file=zip.file("word/document.xml");if(!file)return {changed:false,reason:"document-xml-missing",blob};let xml=await file.async("string");const cleaned=trimLegacyTrailingEmptyParagraphs(xml);if(cleaned===xml)return {changed:false,reason:"already-clean",blob};zip.file("word/document.xml",cleaned);const fixed=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});await putDocBlob(v.wordKey,fixed);v.preparedSanitizedAt=nowBR();save();return {changed:true,reason:"trailing-empty-paragraphs-removed",blob:fixed}}catch(err){console.error("Falha ao sanear Word preparado",err);return {changed:false,reason:"docx-sanitize-failed",blob}}
}
function updateInstitutionalHistoryXml(xml,validator,summary,pages,d,v){
 const plan=institutionalRevisionPlan(xml,d,v);if(!plan.ok)return {ok:false,reason:plan.reason};const {history:h}=plan,table=h.table,rows=h.rows,revisionRows=h.info.filter(x=>x.revision!==null).map(x=>x.row);if(!revisionRows.length)return {ok:false,reason:"history-revision-row-not-found"};
 const institutionalRevision=plan.revision,template=plan.rowInfo.row,rawNote=String(summary||"Revisão técnico-científica").replace(/\s+/g," ").trim(),note=((rawNote.length>100?rawNote.slice(0,97).replace(/\s+\S*$/," ").trim()+"...":rawNote)||"Revisão técnico-científica");const values=[institutionalRevision,currentMonthYearPT(),String(pages||"A conferir"),note,`SIASH Docs / ${validator}`,validator,validator];
 let newTable=table;if(plan.mode==="reuse"){const updated=buildHistoryRowFromTemplate(template,values);newTable=newTable.replace(template,updated)}else{const newRow=buildHistoryRowFromTemplate(template,values),validityRow=rows.find(r=>/Válido até|Valido ate|Vigente até|Vigente ate/i.test(r));if(validityRow)newTable=newTable.replace(validityRow,newRow+validityRow);else newTable=newTable.replace(/<\/w:tbl>$/,newRow+"</w:tbl>")}
 const dte=new Date(),future=new Date(dte.getFullYear()+2,dte.getMonth(),dte.getDate()),months=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"],validity=`Válido até ${months[future.getMonth()]} de ${future.getFullYear()}, caso não haja alterações técnicas.`;const validityRowAfter=[...newTable.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(x=>x[0]).find(r=>/Válido até|Valido ate|Vigente até|Vigente ate/i.test(r));if(validityRowAfter)newTable=newTable.replace(validityRowAfter,replaceCellText(validityRowAfter,validity));
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
   zip.file("word/document.xml",xml);const prepared=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});await putDocBlob(v.wordKey,prepared);
   v.publicationPrepared=true;v.publicationPreparedAt=nowBR();v.publicationPreparedBy=validator;v.preparedInstitutionalRevision=hist.institutionalRevision;v.institutionalValidity=hist.validity;v.institutionalPreparationMode=hist.mode||"append";if(cycleClean.changed){v.institutionalCycleCleanup={at:nowBR(),kept:cycleClean.keptRevision,removed:cycleClean.removedRevisions||[]}}return {updated:true,institutionalRevision:hist.institutionalRevision,validity:hist.validity,mode:hist.mode||"append",cycleCleanup:cycleClean.changed?cycleClean:null};
 }catch(err){console.error("Falha ao preparar Word final para conferência de paginação",err);return {updated:false,reason:"docx-prepare-failed"}}
}
function updatePreparedHistoryPageCountXml(xml,institutionalRevision,pages){
 const tblRe=/<w:tbl(?:\s[^>]*)?>[\s\S]*?Controle Hist[óo]rico[\s\S]*?<\/w:tbl>/i,m=xml.match(tblRe);if(!m)return {ok:false,reason:"history-table-not-found"};
 const table=m[0],rows=[...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(x=>x[0]);let target=null;
 for(const row of rows){const cells=[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(x=>[...x[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(y=>y[1].replace(/<[^>]+>/g,"")).join("").trim());if(cells.length>=7&&cells[0]===String(institutionalRevision)){target=row;break}}
 if(!target)return {ok:false,reason:"prepared-history-row-not-found"};let ci=0;const updated=target.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g,tc=>{const out=ci===2?replaceCellText(tc,String(pages)):tc;ci++;return out});
 return {ok:true,xml:xml.replace(table,table.replace(target,updated))};
}
async function finalizePreparedApprovedWord(d,v,confirmedPages){
 if(!v?.publicationPrepared||!v?.preparedInstitutionalRevision)return {updated:false,reason:"publication-not-prepared"};if(!v?.wordKey)return {updated:false,reason:"no-word-key"};const blob=await getDocBlob(v.wordKey);if(!blob)return {updated:false,reason:"word-not-found"};
 const pages=String(confirmedPages||"").trim();if(!/^\d{1,3}$/.test(pages)||Number(pages)<1)return {updated:false,reason:"page-count-not-confirmed"};
 try{const zip=await JSZip.loadAsync(blob),file=zip.file("word/document.xml");if(!file)return {updated:false,reason:"document-xml-missing"};let xml=await file.async("string");
   xml=trimLegacyTrailingEmptyParagraphs(xml);
   const upd=updatePreparedHistoryPageCountXml(xml,v.preparedInstitutionalRevision,pages);if(!upd.ok)return {updated:false,reason:upd.reason};xml=upd.xml;zip.file("word/document.xml",xml);
   const approved=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});await putDocBlob(v.wordKey,approved);
   v.approvalEmbedded=true;v.approvalEmbeddedAt=nowBR();v.institutionalRevision=v.preparedInstitutionalRevision;v.institutionalRevisionDate=todayISO();v.confirmedFinalPages=Number(pages);return {updated:true,institutionalRevision:v.preparedInstitutionalRevision,validity:v.institutionalValidity||"",pages:Number(pages)};
 }catch(err){console.error("Falha ao confirmar paginação do Word preparado",err);return {updated:false,reason:"docx-page-confirmation-failed"}}
}
function completePublication(i,vi,d,v,validator,finalization){
 d.versions.forEach((x,xv)=>{if(xv!==vi&&x.workflow==="Vigente")x.workflow="Obsoleto"});v.workflow="Vigente";v.validator=validator;v.approver=validator;v.validationDate=todayISO();v.updatedAt=nowBR();d.reviewRequired=false;
 v.note=`${v.note||"Revisão técnico-científica."} Revisão institucional ${finalization.institutionalRevision} registrada automaticamente no Word em ${dateBR(todayISO())}, com ${finalization.pages} página(s) confirmada(s) após a montagem final do Controle Histórico.`;
 auditAdmin(`SIASH Docs: ${d.code} revisão interna ${v.revision} validada e publicada por ${validator} · revisão institucional ${finalization.institutionalRevision} · ${finalization.pages} página(s) confirmadas após geração final.`);save();showToast(`Publicado · Rev.${finalization.institutionalRevision} · ${finalization.pages} página(s)`,2800);renderDocs();
}
window.validateDocProposal=async(i,vi)=>{
 if(!requireProposalContext(i,vi))return;
 const _v=S.docs?.[i]?.versions?.[vi];if(_v?.createdBy==="SIASH Docs / IA"&&_v.aiVerified!==true)return alert("Publicação bloqueada: esta proposta de IA não possui verificação automática de integridade. Gere uma nova proposta ou solicite correção antes de publicar.");
 const d=S.docs[i],v=d?.versions?.[vi];if(!d||!v)return;if(!canDocValidate(d))return alert("Seu perfil não possui permissão de validação neste setor.");if(!(v.wordKey||v.wordPath))return alert("Validação bloqueada: a publicação institucional exige o Word atualizado.");
 if(v.publicationPrepared)return finalizePreparedPublication(i,vi);
 if(!confirm(`Confirma que você abriu, conferiu e aprova tecnicamente a revisão ${v.revision} de ${d.code}?\n\nA SIASH agora vai PREPARAR o Word final, reutilizando a revisão institucional do ciclo quando ela já existir; somente um novo ciclo poderá criar nova revisão institucional. O documento ainda NÃO será publicado.`))return;
 const validator=(prompt("Profissional responsável pela aprovação:",SESSION.user||"")||"").trim();if(!validator)return alert("A identificação do profissional responsável é obrigatória.");
 const prep=await prepareApprovedWord(d,v,validator);if(!prep.updated)return alert(`Preparação BLOQUEADA: a SIASH não conseguiu montar com segurança o Word final (${prep.reason}). A versão vigente anterior foi preservada.`);
 save();renderDocs();renderProposalReady(i,vi);alert(`Word final preparado com a Revisão Institucional ${prep.institutionalRevision}${prep.mode==="reuse"?" (consolidada no mesmo ciclo)":""} e o campo Nº Páginas como “A conferir”.\n\nAgora abra o WORD ATUALIZADO novamente. Confira a quantidade REAL de páginas DEPOIS da inclusão do Controle Histórico. Em seguida clique em FINALIZAR PUBLICAÇÃO.`);
}
window.finalizePreparedPublication=async(i,vi)=>{
 if(!requireProposalContext(i,vi))return;
 const d=S.docs[i],v=d?.versions?.[vi];if(!d||!v)return;if(!canDocValidate(d))return alert("Seu perfil não possui permissão de validação neste setor.");if(v.publicationPrepared){const norm=await normalizePreparedInstitutionalCycle(d,v);if(norm.changed){renderDocs();renderProposalReady(i,vi);return alert(`A SIASH corrigiu automaticamente uma revisão institucional intermediária do mesmo ciclo (alvo: Rev.${norm.targetRevision}). Abra o Word novamente e clique em PREPARAR PUBLICAÇÃO para consolidar a revisão correta.`)}}if(!v.publicationPrepared)return validateDocProposal(i,vi);
 const validator=(v.publicationPreparedBy||v.validator||SESSION.user||"").trim();if(!validator)return alert("A identificação do profissional responsável não foi preservada. Solicite nova preparação.");
 if(!confirm(`Confirma que você ABRIU o Word preparado da revisão ${v.revision} e conferiu a paginação após a inclusão da nova linha do Controle Histórico?`))return;
 const confirmedPages=(prompt("Informe o NÚMERO TOTAL DE PÁGINAS do Word FINAL que você acabou de conferir:",v.confirmedFinalPages?String(v.confirmedFinalPages):"")||"").trim();if(!/^\d{1,3}$/.test(confirmedPages)||Number(confirmedPages)<1)return alert("Publicação interrompida: informe o número total de páginas do Word final preparado.");
 if(!confirm(`Publicar a revisão ${v.revision} como VIGENTE com ${confirmedPages} página(s)?\n\nA versão vigente anterior será marcada como obsoleta somente após esta confirmação.`))return;
 const finalization=await finalizePreparedApprovedWord(d,v,confirmedPages);if(!finalization.updated)return alert(`Publicação BLOQUEADA: a SIASH não conseguiu registrar a paginação no Word preparado (${finalization.reason}). A versão vigente anterior foi preservada.`);
 completePublication(i,vi,d,v,validator,finalization);
}
window.requestDocCorrection=(i,vi)=>{if(!requireProposalContext(i,vi))return;const d=S.docs[i],v=d?.versions?.[vi];if(!d||!v)return;const reason=(prompt("Descreva resumidamente o que precisa ser corrigido na proposta:")||"").trim();if(!reason)return;const text=`Corrigir a revisão proposta ${v.revision} do POP ${d.code} — ${d.title}. Ajuste solicitado pelo profissional: ${reason}. Manter as referências oficiais atuais, informar claramente o que foi corrigido e gerar novamente Word e PDF para nova conferência.`;navigator.clipboard?.writeText(text).then(()=>showToast("Pedido de correção copiado",1500)).catch(()=>{});v.workflow="Em revisão";v.publicationPrepared=false;v.publicationPreparedAt="";v.publicationPreparedBy="";v.preparedInstitutionalRevision="";v.correctionRequested=reason;v.updatedAt=nowBR();save();alert("A revisão voltou para 'Em revisão'. O pedido de correção foi preparado para enviar à IA.")};
window.deleteDoc=i=>{if(!requireOwner("a exclusão de documentos do SIASH Docs"))return;const d=S.docs[i];if(d.seed)return alert("Os POPs institucionais incorporados à base não podem ser excluídos. Crie uma nova revisão para substituí-los.");if(confirm(`Excluir o cadastro ${d.code}? O histórico documental será removido desta instalação.`)){auditAdmin(`SIASH Docs: documento ${d.code} excluído.`);S.docs.splice(i,1);save()}}
function hideDocNewPanel(){$("doc-new-panel").classList.add("hidden");$("doc-form").reset();$("doc-sector").value="UTIN";$("doc-revision").value="00";$("doc-period").value="24";$("doc-workflow").value="Vigente"}
function renderHuddle(){const total=S.huddle.length,done=S.huddle.filter(x=>x.done).length,open=total-done,now=Date.now(),over=S.huddle.filter(x=>!x.done&&x.deadline&&new Date(x.deadline).getTime()<now).length;$("h-open").textContent=open;$("h-done").textContent=done;$("h-overdue").textContent=over;$("h-resolution").textContent=total?Math.round(done/total*100)+"%":"0%";$("huddle-table").innerHTML=S.huddle.map((x,i)=>`<tr><td>${safe(x.sector)}</td><td>${safe(x.problem)}</td><td>${safe(x.action)}</td><td>${safe(x.owner)}</td><td>${x.deadline?new Date(x.deadline).toLocaleString("pt-BR"):"—"}</td><td>${safe(x.priority)}</td><td class="${x.done?"status-ok":(x.deadline&&new Date(x.deadline).getTime()<now?"status-bad":"status-warn")}">${x.done?"Concluída":"Aberta"}</td><td><button class="ghost" onclick="toggleHuddle(${i})">${x.done?"Reabrir":"Concluir"}</button></td></tr>`).join("")||'<tr><td colspan="8">Nenhuma ação registrada.</td></tr>'}
window.toggleHuddle=i=>{S.huddle[i].done=!S.huddle[i].done;save()}
function renderRH(){$("rh-table").innerHTML=[...S.rh].reverse().map(x=>`<tr><td>${safe(x.type)}</td><td>${safe(x.name)}</td><td>${safe(x.detail)}</td><td>${safe(x.status)}</td></tr>`).join("")||'<tr><td colspan="4">Nenhuma solicitação registrada.</td></tr>'}
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
function renderAll(){renderClock();populateBedSelects();renderDashboard();renderShift();renderDaily();renderBeds();renderMovements();renderChecklist();renderCare();renderPicc();renderPipa();renderPending();renderIndicators();renderComparison();renderDocs();renderHuddle();renderRH();renderSettings();renderAdmin();applyPermissions()}
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));btn.classList.add("active");document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$("view-"+btn.dataset.view).classList.remove("hidden");$("page-title").textContent=btn.textContent;renderAll()}))
$("owner-create-btn").addEventListener("click",async()=>{
 const user=$("owner-user").value.trim(),pass=$("owner-pass").value,pass2=$("owner-pass2").value;
 if(!user)return alert("Informe o usuário proprietário.");if(pass.length<10)return alert("A senha proprietária deve ter pelo menos 10 caracteres.");if(pass!==pass2)return alert("As senhas não coincidem.");
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
$("login-btn").addEventListener("click",async()=>{const user=$("login-user").value.trim(),pass=$("login-pass").value,sec=securityState();$("login-feedback").textContent="";try{let role=null;if(SIASH_CLOUD.enabled){const auth=await cloudAuthenticate(user,pass,false);role=auth.role;SESSION={authenticated:true,role,user:auth.user||user};await cloudLoadAfterLogin();await applyPendingBackupAfterLogin()}else{if(sec&&user===sec.ownerUser&&(await sha256(user+"|"+pass))===sec.ownerHash)role="owner";else if(OPERATIONAL_USERS[user]===pass)role="operational";if(!role)throw new Error("Usuário ou senha inválidos.");SESSION={authenticated:true,role,user}}$("login-view").classList.add("hidden");$("app-view").classList.remove("hidden");$("logged-user").textContent=SESSION.user;applyPermissions();if(role==="owner")auditAdmin("Login do Administrador Proprietário.");renderAll();if(role==="owner")setTimeout(()=>migrateLegacyWordDocsIfNeeded().catch(e=>console.error("Migração automática .doc",e)),700)}catch(e){$("login-feedback").textContent=e.message||"Falha no login."}})
$("logout-btn").addEventListener("click",()=>{SIASH_CLOUD.token="";sessionStorage.removeItem("siash_cloud_token");SESSION={authenticated:false,role:null,user:null};$("app-view").classList.add("hidden");$("login-view").classList.remove("hidden");initSecurityUI()})
$("refresh-dashboard").addEventListener("click",renderAll)
$("reset-shift").addEventListener("click",()=>{if(confirm("Iniciar novo plantão? O histórico mensal será preservado.")){S.checklist=CHECKS.map(x=>({text:x,status:"Pendente"}));S.events=[];S.pending=[];S.shiftStarted=new Date().toISOString();save()}})
$("event-form").addEventListener("submit",e=>{e.preventDefault();if(!$("ev-text").value.trim())return;S.events.unshift({when:nowBR(),type:$("ev-type").value,bed:$("ev-bed").value,text:$("ev-text").value.trim()});$("ev-text").value="";save()})
$("daily-form").addEventListener("submit",e=>{e.preventDefault();const date=$("d-date").value;const r={date,internados:+$("d-internados").value||0,admissoes:+$("d-admissoes").value||0,altas:+$("d-altas").value||0,transferencias:+$("d-transferencias").value||0,obitos:+$("d-obitos").value||0,pipa:+$("d-pipa").value||0,canguru:+$("d-canguru").value||0,picc:piccInsertedOn(date),pezinho:+$("d-pezinho").value||0,intub:+$("d-intub").value||0,vm:+$("d-vm").value||0,extubProg:+$("d-extub-prog").value||0,extub:+$("d-extub").value||0,lpp:+$("d-lpp").value||0,obs:$("d-obs").value.trim()};S.daily=S.daily.filter(x=>x.date!==r.date);S.daily.push(r);S.daily.sort((a,b)=>a.date.localeCompare(b.date));save();showToast("Dados salvos",1000)})
$("daily-clear").addEventListener("click",()=>{Object.entries(DAILY_FIELD_MAP).forEach(([k,id])=>$(id).value=k==="picc"?piccInsertedOn($("d-date").value):0);$("d-obs").value=""})
$("d-date").addEventListener("change",()=>{const date=$("d-date").value;loadDailyForm(date);renderDaily()})
$("bed-form").addEventListener("submit",e=>{e.preventDefault();const b=S.beds.find(x=>x.n==+$("bed-number").value);if(!b)return;b.status=$("bed-status").value;b.profile=$("bed-profile").value;b.rn=$("bed-rn").value.trim();b.note=$("bed-note").value.trim();save()})
$("profile-form").addEventListener("submit",e=>{
 e.preventDefault();
 const n=+$("profile-bed").value,b=S.beds.find(x=>x.n===n);
 if(!b)return alert("Selecione o leito.");
 if(b.status!=="Ocupado")return alert("A alteração de perfil assistencial deve ser feita em um leito ocupado.");
 const old=b.profile,newp=$("profile-new").value;
 if(old===newp)return alert(`O RN já está classificado como ${newp}.`);
 b.profile=newp;
 const note=$("profile-note").value.trim();
 S.profileHistory.push({when:nowBR(),bed:n,rn:b.rn,from:old,to:newp,note});
 S.events.unshift({when:nowBR(),type:"Alteração de perfil assistencial",bed:String(n),text:`Perfil alterado de ${old} para ${newp}, sem mudança física de leito.`});
 $("profile-note").value="";
 save();
 alert(`Perfil do RN no Leito ${pad(n)} alterado para ${newp}. O RN permaneceu no mesmo leito.`);
})
$("move-bed-form").addEventListener("submit",e=>{e.preventDefault();const o=+$("move-origin").value,t=+$("move-target").value;if(!o||!t||o===t)return alert("Selecione leitos diferentes.");const a=S.beds.find(x=>x.n===o),b=S.beds.find(x=>x.n===t);if(a.status!=="Ocupado")return alert("O leito de origem precisa estar ocupado.");if(b.status!=="Livre")return alert("O leito de destino precisa estar livre.");const rn=a.rn,profile=a.profile;b.status="Ocupado";b.rn=rn;b.profile=profile;b.note=$("move-note").value.trim()||`Remanejado do leito ${o}`;a.status="Livre";a.rn="";a.note="";a.profile="Intensivo";S.bedMoves.push({when:nowBR(),origin:o,target:t,rn,profile,note:$("move-note").value.trim()});S.events.unshift({when:nowBR(),type:"Remanejamento físico de leito",bed:String(t),text:`RN remanejado fisicamente do leito ${o} para o leito ${t}, mantendo perfil ${profile}.`});$("move-note").value="";save();alert("Remanejamento físico registrado. O perfil assistencial do RN foi mantido.")})
$("mv-type").addEventListener("change",updateMovementFields)
$("movement-form").addEventListener("submit",e=>{e.preventDefault();S.movements.push({when:nowBR(),type:$("mv-type").value,bedtype:$("mv-bedtype").value,context:$("mv-context").disabled?"":$("mv-context").value.trim(),note:$("mv-note").value.trim()});$("mv-note").value="";save()})
$("care-save").addEventListener("click",()=>{const bed=$("care-bed").value;if(!bed)return alert("Selecione o leito.");S.care[bed]={sae:$("care-sae").value,evol:$("care-evol").value,multi:$("care-multi").value,updated:nowBR()};save()})
$("picc-form").addEventListener("submit",e=>{
 e.preventDefault();if(!$("picc-date").value||!$("picc-bed").value||!$("picc-vein").value)return alert("Informe a data da inserção, o leito e a veia/sítio.");
 const b1=$("picc-b1").value,b2=$("picc-b2").value,b3=$("picc-b3").value,bundle=[b1,b2,b3].every(x=>x==="Sim"),editIndex=$("picc-edit-index").value===""?null:+$("picc-edit-index").value,old=editIndex===null?null:S.picc[editIndex];
 const record={when:old?old.when:nowBR(),updated:nowBR(),insertDate:$("picc-date").value,bed:$("picc-bed").value,vein:$("picc-vein").value,side:$("picc-side").value,punctures:+$("picc-punctures").value||1,length:$("picc-length").value,external:$("picc-external").value,position:$("picc-position").value,b1,b2,b3,bundle,status:old?old.status:"Ativo",removalDate:old?old.removalDate:null,removalReason:old?old.removalReason:null,removalNote:old?old.removalNote:null,removedAt:old?old.removedAt:null};
 if(record.removalDate&&record.removalDate<record.insertDate)return alert("A data de inserção não pode ser posterior à data de retirada.");
 if(editIndex!==null){S.picc[editIndex]=record;clearPiccForm();save();showToast("Registro de PICC atualizado",1200);return}
 const activeSameBed=S.picc.filter(x=>String(x.bed)===String(record.bed)&&x.status==="Ativo");if(activeSameBed.length){const proceed=confirm(`Já existe ${activeSameBed.length} PICC ativo no Leito ${pad(record.bed)}.\n\nSe for apenas correção, cancele e edite o registro existente.\n\nDeseja registrar outro PICC ativo neste leito?`);if(!proceed)return}
 S.picc.push(record);clearPiccForm();save();showToast("PICC registrado e indicadores atualizados",1400)
})
$("picc-cancel-edit").addEventListener("click",clearPiccForm)
$("picc-removal-cancel").addEventListener("click",cancelPiccRemoval)
$("picc-removal-form").addEventListener("submit",e=>{
 e.preventDefault();const i=+$("picc-removal-index").value,x=S.picc[i],date=$("picc-removal-date").value,reason=$("picc-removal-reason").value;if(!x||x.status!=="Ativo")return alert("PICC ativo não localizado.");if(!date||!reason)return alert("Informe a data e o motivo da retirada.");if(date<piccInsertDate(x))return alert("A retirada não pode ser anterior à inserção.");x.status="Retirado";x.removalDate=date;x.removalReason=reason;x.removalNote=$("picc-removal-note").value.trim();x.removedAt=nowBR();x.updated=nowBR();cancelPiccRemoval();save();showToast(`PICC do Leito ${pad(x.bed)} retirado`,1600)
})

$("pipa-form").addEventListener("submit",e=>{e.preventDefault();if(!$("pipa-month").value||!$("pipa-city").value)return alert("Informe competência e município.");S.pipa.push({month:$("pipa-month").value,city:$("pipa-city").value,qty:+$("pipa-qty").value||0,note:$("pipa-note").value.trim(),updated:nowBR()});$("pipa-qty").value=0;$("pipa-note").value="";save()})
$("pipa-month").addEventListener("change",renderPipa)
$("pending-form").addEventListener("submit",e=>{e.preventDefault();S.pending.push({bed:$("pending-bed").value,priority:$("pending-priority").value,text:$("pending-text").value.trim(),done:false});$("pending-text").value="";save()})
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
 const title=$("doc-title").value.trim(),code=$("doc-code").value.trim(),sector=$("doc-sector").value.trim()||"UTIN",type=$("doc-type")?.value||"POP";const access=currentDocAccess();if(!isOwner()&&access.sector!=="*"&&sector!==access.sector)return alert(`Seu acesso permite cadastrar documentos somente no setor ${access.sector}.`);const revision=$("doc-revision").value.trim()||"00",reviewDate=$("doc-review").value,period=+$("doc-period").value||24,workflow=$("doc-workflow").value,note=$("doc-note").value.trim()||"Emissão inicial.";
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
 try{if(pdf){version.pdfKey=`${d.id}|${revision}|pdf|${Date.now()}`;version.pdfName=pdf.name;await putDocBlob(version.pdfKey,pdf)}if(word){version.wordKey=`${d.id}|${revision}|word|${Date.now()}`;version.wordName=word.name;await putDocBlob(version.wordKey,word)}}catch(err){console.error(err);return alert("Não foi possível armazenar o arquivo desta revisão. Verifique as permissões do navegador.")}
 d.period=period;auditAdmin(`SIASH Docs: ${d.code} revisão ${revision} importada para conferência.`);save();showToast(`Revisão ${revision} pronta para conferência`,1500);renderProposalReady(i,vi);renderDocs();
})
$("huddle-form").addEventListener("submit",e=>{e.preventDefault();S.huddle.push({sector:$("h-sector").value,problem:$("h-problem").value.trim(),action:$("h-action").value.trim(),owner:$("h-owner").value.trim(),deadline:$("h-deadline").value,priority:$("h-priority").value,done:false});e.target.reset();save()})
$("swap-form").addEventListener("submit",e=>{e.preventDefault();S.rh.push({type:"Troca de plantão",name:$("swap-a").value.trim(),detail:`Substituto: ${$("swap-b").value.trim()} | ${dateBR($("swap-date-a").value)} ↔ ${dateBR($("swap-date-b").value)} | ${$("swap-reason").value.trim()}`,status:"Aguardando aprovação"});e.target.reset();save()})
$("point-form").addEventListener("submit",e=>{e.preventDefault();S.rh.push({type:"Inconsistência de ponto",name:$("point-name").value.trim(),detail:`${$("point-type").value} em ${dateBR($("point-date").value)} às ${$("point-time").value} | ${$("point-reason").value.trim()}`,status:"Aguardando aprovação"});e.target.reset();save()})
$("s-test-ai-fallback")?.addEventListener("click",runCloudflareFallbackDiagnostic);
$("settings-form").addEventListener("submit",e=>{e.preventDefault();if(!requireOwner("alterações nas Configurações da Unidade"))return;const beds=+$("s-beds").value,intensive=+$("s-intensive").value,intermediate=+$("s-intermediate").value;if(intensive+intermediate!==beds)return alert("Intensivos + intermediários deve ser igual ao total de leitos.");S.settings={unit:$("s-unit").value,beds,intensive,intermediate,target:+$("s-target").value,hospital:$("s-hospital").value,aiProvider:$("s-ai-provider")?.value||"auto"};auditAdmin("Configurações estruturais da unidade alteradas.");save();alert("Configurações salvas pelo Administrador Proprietário.")})
if($("admin-test-lock"))$("admin-test-lock").addEventListener("click",()=>{if(requireOwner("o teste administrativo")){auditAdmin("Teste de bloqueio estrutural executado com sucesso.");save();alert("Sessão proprietária validada: acesso estrutural autorizado.")}});$("export-local-backup")?.addEventListener("click",exportLocalBackup);
$("import-local-backup")?.addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{await importBackupFile(f,!!(SIASH_CLOUD.enabled&&SIASH_CLOUD.token))}catch(err){alert(err.message)}e.target.value=""});
$("d-date").value=todayISO();loadDailyForm($("d-date").value);$("picc-date").value=todayISO();$("picc-removal-date").value=todayISO();$("pipa-month").value=currentMonth();initSecurityUI();setInterval(renderClock,1000);
$("doc-access-form")?.addEventListener("submit",e=>{
 e.preventDefault();if(!requireOwner("a gestão de acessos documentais"))return;
 const user=$("doc-access-user").value.trim(),sector=$("doc-access-sector").value.trim(),level=$("doc-access-level").value;
 if(!user||!sector)return;
 const sec=securityState()||{};sec.docAccess=sec.docAccess||{};sec.docAccess[user]={sector,level};setSecurityState(sec);
 auditAdmin(`Acesso documental definido: ${user} · ${sector} · ${level}`);renderDocAccessList();showToast("Acesso documental salvo",1200);
});
renderAll();
// v0.12.8 — base consolidada: cadastro assistido de novos documentos + conferência técnica em janela; preserva todas as regras v0.12.5.
