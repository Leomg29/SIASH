/* SIASH Mapa de Dietas — rascunho clínico; não prescreve nem altera volumes automaticamente. */
(function(){
const $d=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dateNow=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const emptyRow=(n,rn="")=>({bed:n,rn,mode:"unica",milk1:"",vol1:"",milk2:"",vol2:"",interval:"",note:""});
const MILK_OPTIONS=["Neocate","Pregomim","Aptamil Pré","Aptamil 1","LHP"];
const milkSelect=(i,k,value)=>{
 const current=String(value||"").trim();
 const options=current&&!MILK_OPTIONS.includes(current)?[current,...MILK_OPTIONS]:MILK_OPTIONS;
 return '<select id="diet-'+i+'-'+k+'"><option value="">Selecione a fórmula</option>'+options.map(v=>'<option value="'+esc(v)+'" '+(current===v?'selected':'')+'>'+esc(v)+(v===current&&!MILK_OPTIONS.includes(v)?' (registro anterior)':'')+'</option>').join("")+"</select>";
};
const occupied=b=>b&&b.status==="Ocupado"&&String(b.rn||"").trim();
const rowsForBeds=()=>Array.from({length:10},(_,i)=>emptyRow(i+1,occupied(S.beds[i])?S.beds[i].rn:""));
const mapList=()=>Array.isArray(S.dietMaps)?S.dietMaps:[];
let draft=null;
const selected=()=>($d("diet-date")?.value||dateNow());
function load(){
 const date=selected(),saved=mapList().find(m=>m.date===date);
 if(saved){draft=JSON.parse(JSON.stringify(saved));reconcileBeds();}
 else {
  const prior=mapList().filter(m=>m.date<date&&m.status==="emitido").sort((a,b)=>b.date.localeCompare(a.date))[0];
  const base=prior?JSON.parse(JSON.stringify(prior.rows)):rowsForBeds();
  draft={date,status:"rascunho",source:prior?.date||null,rows:base,author:"",checked:false};
  draft.rows=Array.from({length:10},(_,i)=>{
   const b=S.beds[i],r=draft.rows.find(x=>+x.bed===i+1)||emptyRow(i+1);
   const current=occupied(b)?String(b.rn).trim():"";
   if(!current||current!==String(r.rn||"").trim())return emptyRow(i+1,current);
   return {...r,bed:i+1};
  });
 }
 reconcileBeds();
 render();
}
// Reconcilia o mapa em edição com a ocupação atual, preservando a dieta do mesmo RN ao mudar de leito.
function reconcileBeds(){
 if(!draft)return false;
 const original=draft.rows||[];
 const currentBeds=Array.from({length:10},(_,i)=>({bed:i+1,rn:occupied(S.beds[i])?String(S.beds[i].rn).trim():""}));
 const oldByRn=new Map();
 for(const r of original){const key=String(r.rn||"").trim().toLocaleLowerCase("pt-BR");if(key&&!oldByRn.has(key))oldByRn.set(key,r);}
 let changed=false;
 const next=currentBeds.map(({bed,rn})=>{
  const old=original.find(r=>+r.bed===bed)||emptyRow(bed);
  if(!rn){if(old.rn)changed=true;return emptyRow(bed);}
  const same=String(old.rn||"").trim()===rn;
  const source=same?old:(oldByRn.get(rn.toLocaleLowerCase("pt-BR"))||emptyRow(bed,rn));
  if(!same||+source.bed!==bed)changed=true;
  return {...source,bed,rn};
 });
 if(changed){
  draft.rows=next;
  if(draft.status==="emitido"){
   // A emissão anterior permanece no histórico; alterações assistenciais exigem nova conferência.
   draft.status="rascunho";draft.issuedAt=null;draft.checked=false;
   draft.source=draft.date;
  }else draft.checked=false;
 }
 return changed;
}
function read(){
 if(!draft)return;
 draft.rows.forEach((r,i)=>{
  const prefix="diet-"+i+"-";
  for(const k of ["rn","mode","milk1","vol1","milk2","vol2","interval","note"]){const e=$d(prefix+k);if(e)r[k]=e.value;}
 });
 draft.author=$d("diet-author").value.trim();
 draft.checked=$d("diet-check").checked;
}
function validate(){
 if(!draft.author)return "Informe o responsável pela elaboração.";
 if(!draft.checked)return "Confirme a conferência com a prescrição vigente.";
 for(const r of draft.rows){
  if(!r.rn)continue;
  if(!r.milk1&&!r.vol1&&!r.milk2&&!r.vol2)continue; // RN sem dieta registrada
  const a=Number(r.vol1),b=Number(r.vol2);
  if(!r.milk1||!r.vol1||!Number.isFinite(a)||a<=0)return "Leito "+r.bed+": informe primeira fórmula e volume válido.";
  if(r.mode!=="unica"&&(!r.milk2||r.milk1.trim().toLowerCase()===r.milk2.trim().toLowerCase()))return "Leito "+r.bed+": informe duas fórmulas distintas.";
  if(r.mode==="transicao"&&(!r.vol2||!Number.isFinite(b)||b<=0))return "Leito "+r.bed+": informe o volume da segunda fórmula.";
 }
 return "";
}
function hasDiet(r){return !!(String(r.milk1||"").trim()&&Number(r.vol1)>0);}
function render(){
 if(!$d("diet-rows")||!draft)return;
 $d("diet-source").textContent=draft.source?"Rascunho baseado no mapa emitido de "+draft.source+"; confira todas as prescrições.":"Mapa novo; confira todas as prescrições.";
 $d("diet-author").value=draft.author||"";
 $d("diet-check").checked=!!draft.checked;
 $d("diet-status").textContent=draft.status==="emitido"?"Mapa emitido — alterações exigem nova emissão":"Rascunho não emitido";
 $d("diet-rows").innerHTML=draft.rows.map((r,i)=>{
 const field=(k,type="text",attrs="")=>'<input id="diet-'+i+'-'+k+'" type="'+type+'" value="'+esc(r[k])+'" '+attrs+'>';
 const sel='<select id="diet-'+i+'-mode">'+[["unica","Dieta única"],["transicao","Transição (preparos separados)"],["alternativa","Alternativas (uma ou outra)"]].map(([v,t])=>'<option value="'+v+'" '+(r.mode===v?"selected":"")+'>'+t+'</option>').join("")+'</select>';
 return '<tr><td>'+String(r.bed).padStart(2,"0")+'</td><td>'+field("rn")+'</td><td>'+sel+'</td><td>'+milkSelect(i,"milk1",r.milk1)+'</td><td>'+field("vol1","number",'min="0" step="0.1"')+'</td><td>'+milkSelect(i,"milk2",r.milk2)+'</td><td>'+field("vol2","number",'min="0" step="0.1" '+(r.mode!=="transicao"?"disabled":""))+'</td><td>'+field("interval","text",hasDiet(r)?"":'placeholder="Sem dieta" disabled')+'</td><td>'+field("note")+'</td></tr>';
 }).join("");
 draft.rows.forEach((r,i)=>{const prefix="diet-"+i+"-";$d(prefix+"mode").addEventListener("change",()=>{read();render()});for(const key of ["milk1","vol1"]){$d(prefix+key).addEventListener("change",()=>{read();if(!hasDiet(draft.rows[i]))draft.rows[i].interval="";else if(!draft.rows[i].interval)draft.rows[i].interval="3/3 h";render()})}});
}
function persist(emit=false){
 read();
 if(emit){const err=validate();if(err){alert(err);return;}
  if(!confirm("Conferiu todas as dietas com a prescrição vigente? Emitir mapa de 24 horas?"))return;
  draft.status="emitido";draft.issuedAt=new Date().toISOString();draft.issuedBy=SESSION.user||draft.author;
 }else if(draft.status==="emitido"){draft.status="rascunho";draft.issuedAt=null;}
 S.dietMaps=S.dietMaps||[];
 const ix=S.dietMaps.findIndex(m=>m.date===draft.date);
 if(ix>=0){
  const old=S.dietMaps[ix];
  if(old.status==="emitido"){S.dietMapHistory=S.dietMapHistory||[];S.dietMapHistory.push(JSON.parse(JSON.stringify(old)));}
  S.dietMaps[ix]=JSON.parse(JSON.stringify(draft));
 }else S.dietMaps.push(JSON.parse(JSON.stringify(draft)));
 save();
 render();
 alert(emit?"Mapa emitido e salvo. Verifique o indicador Cloud: Sincronizado antes de imprimir.":"Rascunho salvo. Verifique a sincronização Cloud.");
}
function printMap(){
 read();
 if(draft.status!=="emitido"){alert("Emita o mapa antes de imprimir.");return;}
 const current=mapList().find(m=>m.date===draft.date);
 if(!current||current.status!=="emitido"){alert("Mapa ainda não salvo.");return;}
 if(SIASH_CLOUD.enabled&&(SIASH_CLOUD.conflict||localStorage.getItem(CLOUD_PENDING_STORE)==="1")){alert("A sincronização Cloud está pendente. Confirme a sincronização antes de imprimir.");return;}
 const lines=current.rows.map(r=>{
 const f1=r.milk1?esc(r.milk1)+" — "+esc(r.vol1)+" mL":"";
 const f2=r.milk2?esc(r.milk2)+" — "+esc(r.mode==="alternativa"?r.vol1:r.vol2)+" mL":"";
 const mode=r.mode==="transicao"?"TRANSIÇÃO: preparar separadamente":r.mode==="alternativa"?"ALTERNATIVAS: preparar somente uma":"";
 return '<tr><td>'+String(r.bed).padStart(2,"0")+'</td><td>'+esc(r.rn)+'</td><td>'+f1+(f2?"<br>"+f2:"")+(mode?"<br><strong>"+mode+"</strong>":"")+'</td><td>'+((r.rn&&r.milk1&&r.vol1)?esc(r.interval):'')+'</td></tr>';
 }).join("");
 const w=window.open("","_blank");
 if(!w){alert("Permita a janela de impressão neste navegador.");return;}
 w.document.write('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Mapa de Dietas '+esc(current.date)+'</title><style>body{font:12px Arial;margin:18mm;color:#222}h2,h3{text-align:center;margin:5px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #555;padding:7px;vertical-align:top}th{background:#9b6038;color:white}p{margin:12px 0}@page{size:A4 portrait;margin:12mm}</style><h3>FUNDAÇÃO HOSPITALAR DR. MOISÉS MAGALHÃES FREIRE</h3><h2>UTI NEONATAL | REQUISIÇÃO DE DIETAS</h2><p>Data: '+esc(current.date)+' &nbsp; Validade: 24 horas</p><p>Conferir as informações com a prescrição vigente antes do preparo e da administração.</p><table><thead><tr><th>LEITO</th><th>IDENTIFICAÇÃO DO RN</th><th>DIETA / VOLUME POR TIPO</th><th>INTERVALO</th></tr></thead><tbody>'+lines+'</tbody></table><p style="margin-top:36px">Responsável pela elaboração: '+esc(current.author)+'</p></html>');
 w.document.close();w.focus();w.print();
}
window.renderDietMap=function(){if(!$d("diet-date"))return;if(!draft){$d("diet-date").value=dateNow();load();return;}if(selected()!==draft.date){load();return;}read();if(reconcileBeds())render();};
window.initDietMap=function(){
 if(!$d("diet-date"))return;
 $d("diet-date").value=dateNow();
 $d("diet-date").addEventListener("change",load);
 $d("diet-load").addEventListener("click",load);
 $d("diet-save").addEventListener("click",()=>persist(false));
 $d("diet-issue").addEventListener("click",()=>persist(true));
 $d("diet-print").addEventListener("click",printMap);
};
})();