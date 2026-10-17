/* SIASH — gráficos automáticos de indicadores. Apenas leitura; não altera dados. */
(function(){
  const original=renderIndicators;
  // Reaproveita a renderização oficial; não altera a persistência de dados.
  function formatNumber(value){
    const n=Number(value);
    if(!Number.isFinite(n))return "0";
    return n.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:2});
  }
  function barChart(title,items,maxValue,suffix=""){
    const panel=document.createElement("article");panel.className="panel";
    const head=document.createElement("div");head.className="panel-head";
    const h=document.createElement("h3");h.textContent=title;head.appendChild(h);panel.appendChild(head);
    const content=document.createElement("div");content.style.cssText="display:grid;gap:9px;padding:12px 0";
    if(!items.length){content.textContent="Sem lançamentos nesta competência.";panel.appendChild(content);return panel;}
    const max=Math.max(1,maxValue||0,...items.map(x=>Number(x.value)||0));
    items.forEach(item=>{
      const line=document.createElement("div");line.style.cssText="display:grid;grid-template-columns:minmax(90px,145px) minmax(48px,1fr) minmax(65px,auto);gap:10px;align-items:center;font-size:13px";
      const label=document.createElement("span");label.textContent=item.label;
      const track=document.createElement("div");track.style.cssText="background:#edf1f3;border-radius:6px;overflow:hidden;height:14px";
      const missing=item.value===null||item.value===undefined;
      const fill=document.createElement("div");fill.style.cssText="background:#995a35;height:100%;width:"+(missing?0:Math.max(0,Math.min(100,(Number(item.value)||0)/max*100)))+"%";
      track.appendChild(fill);
      const value=document.createElement("strong");value.style.cssText="text-align:right;min-width:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums";value.textContent=missing?"Sem dados":formatNumber(item.value)+suffix;
      line.append(label,track,value);content.appendChild(line);
    });panel.appendChild(content);return panel;
  }
  const GROUPS=[
    {title:"Gestão assistencial",items:[["Pacientes-dia","pd"],["Leitos-dia","ld"],["Dias lançados","days"],["Taxa de ocupação (%)","occ"],["Média de permanência (dias)","los"]]},
    {title:"Movimentação e desfechos",items:[["Admissões","adm"],["Saídas","outs"],["Altas","altas"],["Transferências","transf"],["Óbitos","deaths"],["Altas para Pediatria","altaPediatria"],["Altas para Canguru","altaCanguru"],["Altas Pediatria/Canguru (total)","canguru"]]},
    {title:"PIPA e procedimentos",items:[["PIPA","pipa"],["PICCs inseridos","picc"],["PICCs retirados","piccRemoved"],["PICC-dia","piccDays"],["Testes do pezinho","pezinho"]]},
    {title:"Ventilação mecânica",items:[["VM-dia","vmDays"],["Intubações","intub"],["Extubações programadas","extubProg"],["Extubações acidentais","extub"]]},
    {title:"Segurança do paciente",items:[["Lesões por pressão","lpp"],["Hipotermia","hypothermia"],["Hipertermia","hyperthermia"]]}
  ];
  function monthBefore(m,offset){
    const p=m.split("-").map(Number),d=new Date(p[0],p[1]-1+offset,1);
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  }
  function monthlyChart(label,key,months){
    const items=months.map(m=>{const stats=monthStats(m);return {label:m.slice(5)+"/"+m.slice(0,4),value:stats.days?Number(stats[key])||0:null};});
    return barChart(label,items,["occ"].includes(key)?100:undefined,key==="occ"?"%":key==="los"?" d":"");
  }
  function renderCharts(){
    const container=document.getElementById("siash-indicator-charts");
    if(!container)return;
    const selected=document.getElementById("indicator-month");
    if(!selected||!selected.value)return;
    const month=selected.value,stats=monthStats(month),rows=stats.rows||[];
    const months=[-5,-4,-3,-2,-1,0].map(i=>monthBefore(month,i));
    container.replaceChildren();
    const heading=document.createElement("h3");heading.textContent="Painel gráfico completo dos indicadores";
    const note=document.createElement("p");note.className="muted";
    note.textContent="Atualização automática pelos lançamentos existentes. Comparativos dos últimos seis meses até a competência selecionada; meses sem lançamentos diários são identificados como 'Sem dados', sem confundir ausência de registros com valor zero. Valores atuais são mostrados separadamente.";
    container.append(heading,note);
    const daily=rows.map(r=>({label:r.date.slice(8,10)+"/"+r.date.slice(5,7),value:Number(r.internados)||0}));
    const evolution=document.createElement("div");evolution.className="comparison-grid";
    evolution.appendChild(barChart("Pacientes-dia por data",daily));
    evolution.appendChild(barChart("Ocupação mensal (%)",months.map(m=>({label:m.slice(5)+"/"+m.slice(0,4),value:monthStats(m).days?Number(monthStats(m).occ.toFixed(2)):null})),100,"%"));
    evolution.appendChild(monthlyChart("Pacientes-dia por mês","pd",months));
    evolution.appendChild(monthlyChart("Média de permanência por mês","los",months));
    container.appendChild(evolution);
    const h=document.createElement("h3");h.textContent="Indicadores da competência";container.appendChild(h);
    GROUPS.forEach(group=>{
      const grid=document.createElement("div");grid.className="comparison-grid";
      const items=group.items.map(([label,key])=>({label,value:Number(stats[key])||0}));
      grid.appendChild(barChart(group.title,items));
      group.items.forEach(([label,key])=>grid.appendChild(monthlyChart(label+" — evolução mensal",key,months)));
      container.appendChild(grid);
    });
    const current=document.createElement("h3");current.textContent="Situação atual (não acumulativa)";container.appendChild(current);
    const currentGrid=document.createElement("div");currentGrid.className="comparison-grid";
    const activePiccs=S.picc.filter(x=>x.status==="Ativo").length;
    currentGrid.appendChild(barChart("PICCs ativos agora",[{label:"Ativos",value:activePiccs}]));
    const latest=rows.length?rows[rows.length-1]:null;
    currentGrid.appendChild(barChart("RN em VM — último dia lançado no mês",latest?[{label:latest.date.slice(8,10)+"/"+latest.date.slice(5,7),value:Number(latest.vm)||0}]:[]));
    container.appendChild(currentGrid);
    const pipa=S.pipa.filter(x=>x.month===month).reduce((a,x)=>{const city=String(x.city||"Não informado");a[city]=(a[city]||0)+(Number(x.qty)||0);return a;},{});
    const cities=Object.entries(pipa).sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value}));
    container.appendChild(barChart("PIPA por município",cities));
  }
  renderIndicators=function(){original();renderCharts();};
  // app.js renderiza antes deste script; desenha os gráficos na carga inicial.
  if(document.getElementById("indicator-month"))renderCharts();
})();
