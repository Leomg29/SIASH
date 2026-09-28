const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes("correção solicitada pelo profissional:"),"professional correction must enter the scientific research query");
assert(s.includes("compare o pedido diretamente com os PARÁGRAFOS EDITÁVEIS desta proposta"),"correction prompt must compare request against proposal paragraphs");
assert(s.includes("Word da revisão proposta. A proposta anterior foi preservada"),"no-op message must identify the actual proposal baseline");
assert(/^0\.14\.(?:43|4[4-9]|[5-9]\d|\d{3,})$/.test(p.version),"version must retain or advance beyond v0.14.43");
assert(html.includes(p.version),"UI must display the current package version");
console.log("v0.14.43 correction-directed research regression OK");
