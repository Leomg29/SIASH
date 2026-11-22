'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
test('coverage banner appears after indicator hero and before metric cards',()=>{
 const section=html.slice(html.indexOf('id="view-indicadores"'),html.indexOf('<!-- COMPARATIVO -->'));
 const hero=section.indexOf('Central de Indicadores');
 const alert=section.indexOf('id="indicator-coverage-alert"');
 const cards=section.indexOf('class="cards six"');
 assert.ok(hero>=0&&alert>hero&&cards>alert);
 assert.match(section,/id="indicator-coverage-alert"[^>]*role="status"[^>]*hidden/);
});
test('coverage alert is controlled by selected month and absent from table rows',()=>{
 assert.match(js,/coverageAlert\.hidden=!coverage\?\.incomplete/);
 assert.match(js,/coverageAlert\.textContent=coverage\?\.incomplete\?/);
 const begin=js.indexOf('$("indicator-production").innerHTML=');
 const end=js.indexOf('const g={}',begin);
 assert.ok(begin>=0&&end>begin);
 assert.doesNotMatch(js.slice(begin,end),/Cobertura parcial:/);
});
test('notice wraps, and hidden attribute is respected',()=>{
 assert.match(css,/\.indicator-coverage-alert\{[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.indicator-coverage-alert\[hidden\]\{display:none\}/);
});
