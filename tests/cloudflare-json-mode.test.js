const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8");
assert.ok(s.includes('response_format:{type:"json_schema",json_schema:revisionSchema}'));
assert.ok(s.includes('chat_template_kwargs:{enable_thinking:false}'));
assert.ok(s.includes('r?.output?.[0]?.content?.[0]?.text'));
assert.ok(s.includes('Object.hasOwn(r,"updates")&&Object.hasOwn(r,"references")'));
assert.ok(s.includes("Cloudflare resposta sem texto"));
assert.ok(!/console\.(log|warn).*JSON\.stringify\(data\)/.test(s),"Não registrar payload completo do documento.");
console.log("OK: JSON Mode, thinking desativado, extração ampliada e diagnóstico sem conteúdo sensível.");