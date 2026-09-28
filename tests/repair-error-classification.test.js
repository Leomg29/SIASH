const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes('if(repairError?.code==="SCIENTIFIC_BINDING_REJECTED")'),"repair must preserve scientific rejection class");
assert(s.includes("errors.push(`${p} repair: ${repairMsg}`)"),"provider repair failures must remain classified as provider errors");
assert(s.includes("todas as propostas utilizáveis foram rejeitadas"),"scientific rejection message must require usable rejected proposals");
assert(s.includes("A revisão proposta foi preservada e nenhuma alteração foi publicada."),"correction failure must describe protected proposal state");
assert(/^0\.14\.(?:45|4[6-9]|[5-9]\d|\d{3,})$/.test(p.version),"version must retain or advance beyond v0.14.45");
assert(html.includes(p.version),"UI must display the current package version");
console.log("v0.14.45 repair error classification regression OK");
