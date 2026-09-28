const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes('if(repairError?.code==="SCIENTIFIC_BINDING_REJECTED")'),"repair must preserve scientific rejection class");
assert(s.includes("reparo não concluído pelo provedor"),"provider repair failures must not be mislabeled as scientific rejection");
assert(s.includes("todas as propostas utilizáveis foram rejeitadas"),"scientific rejection message must require usable rejected proposals");
assert(s.includes("A revisão proposta foi preservada e nenhuma alteração foi publicada."),"correction failure must describe protected proposal state");
assert.strictEqual(p.version,"0.14.45");
assert(html.includes("0.14.45"),"UI must display v0.14.45");
console.log("v0.14.45 repair error classification regression OK");
