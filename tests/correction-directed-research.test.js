const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes("correção solicitada pelo profissional:"),"professional correction must enter the scientific research query");
assert(s.includes("compare o pedido diretamente com os PARÁGRAFOS EDITÁVEIS desta proposta"),"correction prompt must compare request against proposal paragraphs");
assert(s.includes("Word da revisão proposta. A proposta anterior foi preservada"),"no-op message must identify the actual proposal baseline");
assert.strictEqual(p.version,"0.14.43");
assert(html.includes("0.14.43"),"UI must display v0.14.43");
console.log("v0.14.43 correction-directed research regression OK");
