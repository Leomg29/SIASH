const fs=require("fs");
const assert=require("assert");
const server=fs.readFileSync("server.js","utf8");
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
const html=fs.readFileSync("index.html","utf8");

assert(server.includes("function institutionalStructureProtectedText"),"missing institutional structure guard");
assert(server.includes("if(institutionalStructureProtectedText(before))continue;"),"effective updates must reject protected headings");
assert(server.includes("!institutionalStructureProtectedText(p.text)"),"protected headings must be excluded from editable paragraphs");
assert(server.includes('replace(/[“”„‟]/g'),"comparison normalization must normalize cosmetic quote variants");
assert(server.includes("ESTRUTURA INSTITUCIONAL IMUTÁVEL"),"AI prompt must explicitly protect section structure");
assert(server.includes("Fundação Oswaldo Cruz/FIOCRUZ"),"AI prompt must prioritize Fiocruz");
assert(server.includes("Fiocruz IFF Fundação Oswaldo Cruz"),"research query must include Fiocruz/IFF");
assert(server.includes('if(domainMatches(host,"fiocruz.br"))return "FIOCRUZ";'),"Fiocruz must remain a primary scientific institution");
assert(server.includes('"fiocruz.br"'),"Fiocruz domain must remain preferred");
assert(/^0\.14\.\d+$/.test(pkg.version),"invalid consolidated version");
assert(html.split(pkg.version).length-1>=2,"UI must display current package version");
console.log("v0.14.38 structure/source governance tests passed");
