const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes("Tavily busca geral falhou; tentando busca oficial restrita"),"general-search failure must fall back to restricted official search");
assert(s.includes("Tavily busca oficial restrita falhou"),"restricted-search failure must be diagnosed");
assert(s.includes("if(!ranked.length&&lastSearchError)throw lastSearchError;"),"Tavily must fail only after usable results are exhausted");
assert.strictEqual(p.version,"0.14.42");
assert(html.includes("0.14.42"),"UI must display v0.14.42");
console.log("v0.14.42 resilient Tavily research regression OK");
