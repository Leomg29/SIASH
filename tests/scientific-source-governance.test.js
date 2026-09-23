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
ok(p.version==="0.14.33","package version mismatch");
ok((i.match(/v0\.14\.33/g)||[]).length>=2,"UI version not updated everywhere");
console.log("v0.14.33 scientific source governance OK");
