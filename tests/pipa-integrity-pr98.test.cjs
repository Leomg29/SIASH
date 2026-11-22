'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
const chart=fs.readFileSync('indicator-charts.js','utf8');
test('gráfico municipal ignora cancelados e respeita competência efetiva',()=>{
 assert.match(chart,/!x\.cancelledAt&&\(x\.date\?String\(x\.date\)\.slice\(0,7\):x\.month\)===month/);
 assert.match(app,/function pipaMonthTotal\(m\)\{return S\.pipa\.filter\(x=>!x\.cancelledAt/);
 assert.match(app,/function pipaCountOn\(date\)\{return S\.pipa\.filter\(x=>!x\.cancelledAt/);
});
test('normalização de municípios não altera registros persistidos',()=>{
 const start=app.indexOf('function pipaMunicipalityKey('),end=app.indexOf('function pipaCountOn(',start);
 assert.ok(start>=0&&end>start);
 const context={S:{pipa:[]},monthOf:x=>x.slice(0,7),String,Number};vm.createContext(context);vm.runInContext(app.slice(start,end),context);
 const key=x=>vm.runInContext('pipaMunicipalityKey('+JSON.stringify(x)+')',context);
 assert.equal(key('Santa Fé de Minas'),key(' santa fe de minas '));
 assert.equal(key('IBIAÍ'),key('Ibiai'));
 const original={id:'legacy',date:'2026-11-22',month:'2026-11',city:'Ibiaí',qty:1};context.S.pipa=[original];
 const found=vm.runInContext('pipaPossibleDuplicates({date:"2026-11-22",month:"2026-11",city:"Ibiai",qty:1})',context);
 assert.equal(found.length,1);assert.equal(original.city,'Ibiaí');
});
test('cadastro exige confirmação explícita diante de possível duplicidade',()=>{
 assert.match(app,/const duplicates=pipaPossibleDuplicates\(candidate\)/);
 assert.match(app,/duplicates\.length&&!window\.confirm/);
});
