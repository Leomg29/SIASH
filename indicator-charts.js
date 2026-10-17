/* SIASH — gráficos automáticos de indicadores. Apenas leitura; não altera dados. */
(function(){
  const original=renderIndicators;
  function barChart(title,items,maxValue,suffix=""){
    const panel=document.createElement("article");panel.className="panel";
    const head=document.createElement("div");head.className="panel-head";
    const h=document.createElement("h3");h.textContent=title;head.appendChild(h);panel.appendChild(head);
    const content=document.createElement("div");content.style.cssText="display:grid;gap:9px;padding:12px 0";
    if(!items.length){content.textContent="Sem lançamentos nesta competência.";panel.appendChild(content);return panel;}
    const max=Math.max(1,maxValue||0,...items.map(x=>Number(x.value)||0));
    items.forEach(item=>{
      const line=document.createElement("div");line.style.cssText="display:grid;grid-template-columns:minmax(90px,145px) 1fr 70px;gap:10px;align-items:center;font-size:13px";
      const label=document.createElement("span");label.textContent=item.label;
      const track=document.createElement("div");track.style.cssText="background:#edf1f3;border-radius:6px;overflow:hidden;height:14px";
      const fill=document.createElement("div");fill.style.cssText="background:#995a35;height:100%;width:"+Math.max(0,Math.min(100,(Number(item.value)||0)/max*100))+"%";
      track.appendChild(fill);
      const value=document.createElement("strong");value.style.textAlign="right";value.textContent=String(item.value)+suffix;
      line.append(label,track,value);content.appendChild(line);
    });panel.appendChild(content);return panel;
  }
  function renderCharts(){
    const container=document.getElementById("siash-indicator-charts");
    if(!container)return;
    const month=document.getElementById("indicator-month").value;
    const stats=monthStats(month);
    const rows=stats.rows||[];
    const daily=rows.map(r=>({label:r.date.slice(8,10)+"/"+r.date.slice(5,7),value:Number(r.internados)||0}));
    container.replaceChildren();
    const heading=document.createElement("h3");heading.textContent="Evolução automática dos indicadores";
    const note=document.createElement("p");note.className="muted";note.textContent="Dados da competência selecionada. Correções e exclusões dos lançamentos são refletidas automaticamente.";
    container.append(heading,note);
    const grid=document.createElement("div");grid.className="comparison-grid";
    grid.appendChild(barChart("Pacientes-dia por data",daily,stats.ld));
    grid.appendChild(barChart("Admissões e saídas",[{label:"Admissões",value:stats.adm},{label:"Altas",value:stats.altas},{label:"Transferências",value:stats.transf},{label:"Óbitos",value:stats.deaths}]));
    grid.appendChild(barChart("PICC",[{label:"Inseridos",value:stats.picc},{label:"Retirados",value:stats.piccRemoved},{label:"PICC-dia",value:stats.piccDays}]));
    grid.appendChild(barChart("Ventilação mecânica",[{label:"VM-dia",value:stats.vmDays},{label:"Intubações",value:stats.intub},{label:"Extubações programadas",value:stats.extubProg},{label:"Extubações acidentais",value:stats.extub}]));
    grid.appendChild(barChart("Segurança assistencial",[{label:"Hipotermia",value:stats.hypothermia},{label:"Hipertermia",value:stats.hyperthermia},{label:"Lesões por pressão",value:stats.lpp}]));
    const pct=Number(stats.occ)||0;
    grid.appendChild(barChart("Taxa de ocupação",[{label:"Ocupação",value:Number(pct.toFixed(1))}],100,"%"));
    container.appendChild(grid);
  }
  renderIndicators=function(){original();renderCharts();};
  if(document.getElementById("indicator-month"))renderCharts();
})();
