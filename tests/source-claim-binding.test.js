const fs=require("fs");const s=fs.readFileSync("server.js","utf8"),i=fs.readFileSync("index.html","utf8"),p=require("../package.json");function ok(x,m){if(!x)throw new Error(m)}
ok(s.includes("enforceScientificClaimSourceBinding"),"claim-source binding missing");
ok(s.includes("sourceInstitutionFamily"),"institution family resolver missing");
ok(s.includes("claimedInstitutionFamilies"),"claim detector missing");
ok(s.includes("fonte secundária não pode sustentar alteração clínica"),"secondary-source clinical gate missing");
ok(s.includes("Use a fonte primária da própria instituição citada"),"institution mismatch block missing");
ok(s.includes("const selected=official.slice(0,6)"),"official-only evidence selection missing");
ok(s.includes("HIERARQUIA OBRIGATÓRIA"),"prompt hierarchy rule missing");
ok(s.includes("VÍNCULO INSTITUCIONAL OBRIGATÓRIO"),"prompt institutional binding rule missing");
ok(p.version==="0.14.35","package version mismatch");
ok((i.match(/v0\.14\.35/g)||[]).length>=2,"UI version missing");
console.log("v0.14.35 source claim binding OK");