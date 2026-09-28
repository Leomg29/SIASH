const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes("REPARO OBRIGATÓRIO DE VALIDAÇÃO SIASH:"),"binding rejection must trigger the unified validation repair prompt");
assert(s.includes("proposta reparada e revalidada"),"successful repair must be diagnosed after revalidation");
assert(s.includes("scientificRejections.push")&&s.includes("errors.push(`${p} repair: ${repairMsg}`)"),"failed repair must remain diagnosable by real error class");
assert(s.includes("return repaired;"),"successful same-provider repair must be returned");
assert(/^0\.14\.(?:44|4[5-9]|[5-9]\d|\d{3,})$/.test(p.version),"version must retain or advance beyond v0.14.44");
assert(html.includes(p.version),"UI must display the current package version");
console.log("v0.14.44 scientific binding repair retry regression OK");
