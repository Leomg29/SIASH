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
 assert.match(js,/pipa:pipaCountOn\(date\)/);
 assert.match(js,/date:\$\("pipa-date"\)\.value,month:/);
});
