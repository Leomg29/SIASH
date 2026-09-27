const fs=require("fs"),assert=require("assert");
const app=fs.readFileSync("app.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(app.includes("if(options.correctionRegeneration){const existing="),"correction regeneration must locate existing proposal");
assert(app.includes("revisionBase=existing"),"existing proposal Word must become correction baseline");
assert(app.includes("current_revision:options.correctionRegeneration?rev:pub.revision"),"backend context must identify the proposal revision during correction");
assert(app.includes('options.correctionRegeneration?"Word da revisão proposta não pôde ser aberto."'),"proposal baseline failure must be explicit");
assert.strictEqual(p.version,"0.14.41");
assert((html.match(/0\.14\.41/g)||[]).length>=2,"UI must display v0.14.41");
console.log("v0.14.41 correction proposal baseline regression OK");
