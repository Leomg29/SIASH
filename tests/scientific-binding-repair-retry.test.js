const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes("REPARO OBRIGATÓRIO DE RASTREABILIDADE SIASH"),"binding rejection must trigger a repair prompt");
assert(s.includes("rastreabilidade reparada"),"successful repair must be diagnosed");
assert(s.includes("reparo de rastreabilidade falhou"),"failed repair must remain diagnosable");
assert(s.includes("return repaired;"),"successful same-provider repair must be returned");
assert.strictEqual(p.version,"0.14.44");
assert(html.includes("0.14.44"),"UI must display v0.14.44");
console.log("v0.14.44 scientific binding repair retry regression OK");
