const fs=require("fs");
const s=fs.readFileSync("server.js","utf8");
const i=fs.readFileSync("index.html","utf8");
const p=require("../package.json");
function ok(x,m){if(!x)throw new Error(m)}
ok(s.includes("SCIENTIFIC_PREFERRED_DOMAINS"),"preferred domains missing");
ok(s.includes('"gov.br"')&&s.includes('"who.int"')&&s.includes('"paho.org"'),"official health domains missing");
ok(s.includes('"instagram.com"')&&s.includes("SCIENTIFIC_BLOCKED_DOMAINS"),"social blocking missing");
ok(s.includes("if(official.length<2)"),"minimum official source gate missing");
ok(s.includes("include_domains:SCIENTIFIC_PREFERRED_DOMAINS"),"official retry missing");
ok(s.includes("sourceTier:r._tier"),"source provenance tier missing");
const version=p.version;
ok(/^0\.14\.\d+$/.test(version),"invalid release version");
ok((i.match(new RegExp(`v${version.replace(/\./g,"\\.")}`,"g"))||[]).length>=2,"UI version not updated everywhere");
console.log(`scientific source governance OK on v${version}`);
