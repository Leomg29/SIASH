'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const charts=fs.readFileSync('indicator-charts.js','utf8');
const app=fs.readFileSync('app.js','utf8');
test('grafico consolidado de canguru aparece uma unica vez',()=>{
 assert.equal((charts.match(/\["Altas para Leito Canguru","canguru"\]/g)||[]).length,1);
 assert.doesNotMatch(charts,/\["Altas para Pediatria","altaPediatria"\]/);
 assert.doesNotMatch(charts,/\["Altas para Canguru","altaCanguru"\]/);
 assert.doesNotMatch(charts,/\["Altas Pediatria\/Canguru \(total\)","canguru"\]/);
});
test('formula mensal e campos historicos nao sao modificados',()=>{
 assert.match(app,/canguru:sum\("canguru"\)\+sum\("altaCanguru"\)/);
 assert.match(app,/altaPediatria:sum\("altaPediatria"\)/);
 assert.match(app,/altaCanguru:sum\("altaCanguru"\)/);
});
