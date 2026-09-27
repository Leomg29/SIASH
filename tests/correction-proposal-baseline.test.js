const fs=require("fs"),assert=require("assert");
const app=fs.readFileSync("app.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(app.includes("if(options.correctionRegeneration){const existing="),"correction regeneration must locate existing proposal");
assert(app.includes("revisionBase=existing"),"existing proposal Word must become correction baseline");
assert(app.includes("current_revision:options.correctionRegeneration?rev:pub.revision"),"backend context must identify the proposal revision during correction");
assert(app.includes('options.correctionRegeneration?"Word da revisão proposta não pôde ser aberto."'),"proposal baseline failure must be explicit");
assert(/^0\.14\.(?:41|4[2-9]|[5-9]\d|\d{3,})$/.test(p.version),"version must retain or advance beyond v0.14.41");
assert(html.includes(p.version),"UI must display the current package version");
console.log("v0.14.41 correction proposal baseline regression OK");
