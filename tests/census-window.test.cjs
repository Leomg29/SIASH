const test=require("node:test");
const assert=require("node:assert/strict");
const {censusWindow,censusAttention,effectiveAdmissionDate}=require("../census-window.cjs");
const at=(day,time)=>new Date(day+"T"+time+"-03:00");
test("23h54 bloqueia; 23h55 permite apenas preparar; 23h59 não fecha",()=>{
 assert.equal(censusWindow(at("2026-11-22","23:54:59")).phase,"outside");
 for(const time of ["23:55:00","23:59:59"]){
  const w=censusWindow(at("2026-11-22",time));
  assert.equal(w.phase,"preparation");assert.equal(w.canPrepare,true);assert.equal(w.canConfirm,false);
  assert.equal(w.referenceDate,"2026-11-22");
 }
});
test("00h00 a 00h09:59 permite confirmação humana do dia anterior",()=>{
 for(const time of ["00:00:00","00:05:00","00:09:59"]){
  const w=censusWindow(at("2026-11-23",time));
  assert.equal(w.phase,"confirmation");assert.equal(w.canConfirm,true);
  assert.equal(w.referenceDate,"2026-11-22");
 }
 assert.equal(censusAttention({now:at("2026-11-23","00:04:59")}).attention,"open");
 assert.equal(censusAttention({now:at("2026-11-23","00:05:00")}).attention,"warning");
});
test("00h10 encerra janela, sem certificar contagem automaticamente",()=>{
 const w=censusAttention({now:at("2026-11-23","00:10:00")});
 assert.equal(w.phase,"expired");assert.equal(w.canConfirm,false);
 assert.equal(w.requiresJustification,true);assert.equal(w.attention,"overdue");
 assert.equal(censusAttention({now:at("2026-11-23","00:10:00"),officiallyClosed:true}).attention,"closed");
});
test("admissão 00h20 pertence ao novo dia, independente do registro",()=>{
 assert.equal(effectiveAdmissionDate({effectiveAt:"2026-11-23T00:20:00-03:00",recordedAt:"2026-11-23T04:00:00Z"}),"2026-11-23");
 assert.equal(effectiveAdmissionDate({effectiveAt:"2026-11-22T23:58:00-03:00",recordedAt:"2026-11-23T03:15:00Z"}),"2026-11-22");
});
test("não aceitar timestamp ambíguo ou admissão futura",()=>{
 assert.throws(()=>effectiveAdmissionDate({effectiveAt:"2026-11-23T00:20:00"}),/fuso/);
 assert.throws(()=>effectiveAdmissionDate({effectiveAt:"2026-11-23T01:00:00-03:00",recordedAt:"2026-11-23T03:00:00Z"}),/posterior/);
});

test("pendência continua visível após 00h10, sem fechamento automático",()=>{
 for(const time of ["00:10:01","00:11:00","08:42:00","23:54:59"]){
  const w=censusAttention({now:at("2026-11-23",time)});
  assert.equal(w.attention,"overdue");assert.equal(w.canConfirm,false);
  assert.equal(w.referenceDate,"2026-11-22");
 }
});
test("API de janela apenas consulta o estado e usa relógio do servidor",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const server=fs.readFileSync(path.join(__dirname,"../server.js"),"utf8");
 const start=server.indexOf('app.get("/api/census/window-status"');
 const end=server.indexOf('app.get("/api/census/midnight-status"',start);
 assert.ok(start>0&&end>start);
 const route=server.slice(start,end);
 assert.match(route,/const now=new Date\(\)/);
 assert.match(route,/SELECT payload FROM siash_state/);
 assert.doesNotMatch(route,/INSERT INTO|UPDATE siash_|DELETE FROM|pool\.query\("INSERT/i);
});
