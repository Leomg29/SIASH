const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes("const generationFailures=[];"),"generation failures must be collected separately");
assert(s.includes("geração falhou | provider="),"provider generation failure must be diagnosable");
assert(s.includes("err.details={generationFailures,errors};"),"final error must retain provider failure details");
assert(s.includes("revisão proposta anterior foi preservada"),"correction failure message must describe proposal preservation");
assert.strictEqual(p.version,"0.14.45");
assert(html.includes("0.14.45"),"UI must display v0.14.45");
console.log("v0.14.45 provider failure diagnostics regression OK");
