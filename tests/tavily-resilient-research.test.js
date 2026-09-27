const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes("Tavily busca geral falhou; tentando busca oficial restrita"),"general-search failure must fall back to restricted official search");
assert(s.includes("Tavily busca oficial restrita falhou"),"restricted-search failure must be diagnosed");
assert(s.includes("if(!ranked.length&&lastSearchError)throw lastSearchError;"),"Tavily must fail only after usable results are exhausted");
assert(/^0\.14\.(?:42|4[3-9]|[5-9]\d|\d{3,})$/.test(p.version),"version must retain or advance beyond v0.14.42");
assert(html.includes(p.version),"UI must display the current package version");
console.log("v0.14.42 resilient Tavily research regression OK");
