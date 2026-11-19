const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
test('aba diaria tem painel de conferencia do censo',()=>{
 assert.match(html,/id="daily-census-panel"/);
 assert.match(js,/function renderCensusConference\(date\)/);
 assert.match(js,/renderThermalEvents\(date\);renderCensusConference\(date\)/);
});
test('campo de alta pediatria nao pode ser preenchido em novo lancamento',()=>{
 assert.doesNotMatch(html,/id="d-alta-pediatria"/);
 assert.doesNotMatch(js,/\$\("d-alta-pediatria"\)/);
 assert.match(html,/id="d-alta-canguru"/);
});
test('editar lancamento nao descarta dados historicos de pediatria',()=>{
 assert.match(js,/altaPediatria:\(S\.daily\.find\(x=>x\.date===date\)\?\.altaPediatria\|\|0\)/);
});
test('conferencia de censo nao altera o estado nem salva',()=>{
 const start=js.indexOf('function renderCensusConference(date){');
 const end=js.indexOf('function renderDaily(){',start);
 assert.ok(start>=0&&end>start);
 const body=js.slice(start,end);
 assert.doesNotMatch(body,/\bsave\s*\(/);
 assert.doesNotMatch(body,/S\.daily\s*=/);
 assert.doesNotMatch(body,/S\.beds\s*=/);
});

test('PIPA exige confirmacao de alta e quantidade positiva',()=>{
 assert.match(html,/id="pipa-post-discharge" type="checkbox" required/);
 assert.match(html,/id="pipa-qty" type="number" min="1"/);
 assert.match(js,/Number\.isSafeInteger\(qty\)\|\|qty<1/);
 assert.match(js,/!\$\("pipa-post-discharge"\)\.checked/);
 assert.match(js,/postDischargeConfirmed:true/);
});

test('PIPA datado alimenta o censo sem redistribuir registros mensais antigos',()=>{
 assert.match(html,/id="pipa-date" type="date" required/);
 assert.match(html,/id="d-pipa" type="number"[^>]*readonly/);
 assert.match(js,/function pipaCountOn\(date\)/);
 assert.match(js,/S\.pipa\.filter\(x=>x\.date===date\)/);
 assert.match(js,/function pipaDailyAudit\(date\)/);
 assert.match(js,/pipa:\(S\.daily\.find\(x=>x\.date===date\)\?\.pipa\|\|0\)/);
 assert.match(js,/date:\$\("pipa-date"\)\.value,month:/);
});

test('PIPA legado e datado nao sao somados automaticamente',()=>{
 assert.match(html,/id="d-pipa-audit"/);
 assert.match(js,/pipaDailyAudit\(r\.date\)\.legacy/);
 assert.match(js,/Valores não somados automaticamente/);
 assert.match(js,/pipa:\(S\.daily\.find\(x=>x\.date===date\)\?\.pipa\|\|0\)/);
});

test('resumo mensal distingue fontes PIPA sem agregacao cruzada',()=>{
 assert.match(html,/id="pipa-reconciliation"/);
 assert.match(js,/function pipaReconciliationSummary\(month\)/);
 assert.match(js,/monthlyOnly=S\.pipa\.filter\(x=>!x\.date&&x\.month===month\)/);
 assert.match(js,/overlapDays=S\.daily\.filter/);
 assert.match(js,/Não somar as fontes sem conciliação/);
});

test('conferencia noturna exige lancamento e responsavel',()=>{
 assert.match(html,/id="census-closer"/);
 assert.match(html,/id="census-close"/);
 assert.match(js,/function registerCensusConference\(date,responsible\)/);
 assert.match(js,/if\(!daily\)return \{ok:false/);
 assert.match(js,/if\(!String\(responsible\|\|""\)\.trim\(\)\)return/);
});
test('conferencia registra horario real e preserva somente se total nao mudar',()=>{
 assert.match(js,/registeredAt:new Date\(\)\.toISOString\(\)/);
 assert.match(js,/bedOccupancyAtRegistration:/);
 assert.match(js,/Number\(previous\.internados\)===r\.internados/);
 assert.match(js,/r\.censusConference=previous\.censusConference/);
 assert.match(js,/Conferência anterior desatualizada/);
});

test('bloqueia conferencia com data futura ou formulario divergente',()=>{
 assert.match(js,/if\(date>todayISO\(\)\)return \{ok:false/);
 assert.match(js,/Number\(\$\("d-internados"\)\.value\)!==Number\(daily\.internados\)/);
});
test('confirmacao precede qualquer mutacao de conferencia',()=>{
 const start=js.indexOf('$("census-close").addEventListener("click"');
 const end=js.indexOf('$("daily-clear").addEventListener',start);
 assert.ok(start>=0&&end>start);
 const body=js.slice(start,end);
 assert.ok(body.indexOf('window.confirm(')<body.indexOf('registerCensusConference(date,responsible)'));
 assert.ok(body.indexOf('registerCensusConference(date,responsible)')<body.indexOf('save();'));
});

test('altas para pediatria nao sao classificadas como leito canguru',()=>{
 assert.match(js,/canguru:sum\("canguru"\)\+sum\("altaCanguru"\)/);
 assert.doesNotMatch(js,/canguru:sum\("canguru"\)\+sum\("altaPediatria"\)/);
 assert.match(js,/\["Altas para Leito Canguru \(total\)",c\.canguru\]/);
});

test('competencia PIPA prioriza data do encaminhamento em todas as visoes',()=>{
 assert.match(js,/function pipaMonthTotal\(m\)\{return S\.pipa\.filter\(x=>\(x\.date\?monthOf\(x\.date\):x\.month\)===m\)/);
 assert.match(js,/S\.pipa\.filter\(x=>\(x\.date\?monthOf\(x\.date\):x\.month\)===m\)\.forEach/);
 assert.match(js,/\.\.\.S\.pipa\.map\(r=>r\.date\?monthOf\(r\.date\):r\.month\)/);
});

test('conferencias anteriores permanecem no historico apos nova conferencia',()=>{
 assert.match(js,/daily\.censusConferenceHistory=\[\.\.\.\(daily\.censusConferenceHistory\|\|\[\]\),daily\.censusConference\]/);
 assert.match(js,/registeredBy:SESSION\.user\|\|null/);
});
test('alterar total diario arquiva conferencia anterior sem apaga-la',()=>{
 assert.match(js,/if\(previous\?\.censusConferenceHistory\)r\.censusConferenceHistory=previous\.censusConferenceHistory/);
 assert.match(js,/else r\.censusConferenceHistory=\[\.\.\.\(r\.censusConferenceHistory\|\|\[\]\),previous\.censusConference\]/);
});
