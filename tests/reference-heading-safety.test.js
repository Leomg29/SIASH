const fs=require("fs");const s=fs.readFileSync("server.js","utf8"),i=fs.readFileSync("index.html","utf8"),p=require("../package.json");
function ok(v,m){if(!v)throw new Error(m)}
ok(s.includes("normalizeReferenceHeadingText"),"normalizer missing");
ok(s.includes("bibliogr[aá]ficas?|t[eé]cnicas?|normativas?"),"institutional heading variants missing");
ok(s.includes("headingCandidates.length !== 1"),"ambiguity safety gate removed");
ok(s.includes("A seção de Referências não foi localizada de forma inequívoca"),"zero-heading safety error removed");
ok(s.includes("Foram localizadas múltiplas seções possíveis de Referências"),"multiple-heading safety error removed");
ok(p.version==="0.14.34","package version mismatch");
ok((i.match(/v0\.14\.34/g)||[]).length>=2,"UI version not updated");
console.log("v0.14.34 reference heading safety OK");
