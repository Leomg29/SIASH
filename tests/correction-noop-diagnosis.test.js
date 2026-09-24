const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),i=fs.readFileSync("index.html","utf8");
assert.ok(s.includes('const correctionRequested=!!String(correction_request||"").trim()'));
assert.ok(s.includes('AI_CORRECTION_NO_EFFECTIVE_CHANGE'));
assert.ok(s.includes('A proposta anterior foi preservada e nenhuma nova revisão foi criada.'));
assert.ok(s.indexOf('AI_CORRECTION_NO_EFFECTIVE_CHANGE')<s.indexOf('Este POP foi classificado pela auditoria científica como REVISÃO NECESSÁRIA'));
assert.equal(p.version,"0.14.37");
assert.ok(i.split("v0.14.37").length-1>=2);
console.log("v0.14.37 correction no-op diagnosis OK");
