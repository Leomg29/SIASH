'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
test('checkbox opt-in exists and is not preselected',()=>{
 assert.match(html,/id="d-altas-todas-canguru" type="checkbox"/);
 assert.doesNotMatch(html,/id="d-altas-todas-canguru"[^>]*checked/);
});
test('mirror only acts when opt-in checked',()=>{
 const start=app.indexOf('function syncAllDischargesToCanguru(){');
 const end=app.indexOf('function loadDailyForm(date){',start);
 assert.ok(start>=0&&end>start);
 const elements={'d-altas-todas-canguru':{checked:false},'d-altas':{value:'3'},'d-alta-canguru':{value:'1'}};
 const sandbox={$:id=>elements[id]};
 vm.createContext(sandbox);vm.runInContext(app.slice(start,end),sandbox);
 vm.runInContext('syncAllDischargesToCanguru()',sandbox);
 assert.equal(elements['d-alta-canguru'].value,'1');
 elements['d-altas-todas-canguru'].checked=true;
 vm.runInContext('syncAllDischargesToCanguru()',sandbox);
 assert.equal(elements['d-alta-canguru'].value,'3');
 elements['d-altas'].value='2';
 vm.runInContext('syncAllDischargesToCanguru()',sandbox);
 assert.equal(elements['d-alta-canguru'].value,'2');
});
test('historical canguru guard and reset on date switch',()=>{
 assert.match(app,/if\(\(Number\(existing\?\.canguru\)\|\|0\)>0\)/);
 assert.match(app,/\$\("d-altas-todas-canguru"\)\.checked=false\}/);
 assert.match(app,/\$\("d-alta-canguru"\)\.addEventListener\("input"/);
 assert.match(app,/altaPediatria:\(S\.daily\.find/);
});
