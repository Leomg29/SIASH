const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const source=fs.readFileSync("app.js","utf8");
test("conferencia manual: envio automatico, bloqueio de clique duplo e feedback",()=>{
 const start=source.indexOf('$("census-close").addEventListener("click"');
 const end=source.indexOf('$("daily-clear").addEventListener',start);
 assert.ok(start>=0&&end>start);
 const handler=source.slice(start,end);
 assert.match(handler,/if\(censusConferencePending\)return/);
 assert.match(handler,/registerCensusConference\(date,responsible\)/);
 assert.match(handler,/save\(\)/);
 assert.match(handler,/censusConferencePending=\{date,generation:SIASH_CLOUD.editGeneration\}/);
 assert.match(source,/if\(btn\)btn.disabled=Boolean\(censusConferencePending\)/);
 assert.match(source,/Conferência enviada; verificando confirmação do servidor/);
 assert.match(source,/Falha na confirmação da conferência/);
 assert.match(source,/Conferência salva somente neste navegador/);
});
test("conferencia nao confirma antes da resposta do servidor",()=>{
 const begin=source.indexOf('function scheduleCloudSave(');
 const end=source.indexOf('function scheduleCloudSaveRetry(',begin);
 const sync=source.slice(begin,end);
 assert.match(sync,/await cloudJson\("\/api\/state"/);
 assert.ok(sync.indexOf('await cloudJson("/api/state"')<sync.indexOf('Conferência enviada; verificando confirmação do servidor'));
});
