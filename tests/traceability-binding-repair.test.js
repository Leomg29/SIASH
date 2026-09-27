const fs=require("fs"),assert=require("assert");
const s=fs.readFileSync("server.js","utf8"),p=require("../package.json"),html=fs.readFileSync("index.html","utf8");
assert(s.includes("const claims=claimedInstitutionFamilies(u.new_text);"),"binding must inspect published new_text only");
assert(!s.includes('claimedInstitutionFamilies([u.new_text,u.reason].join(" "))'),"audit reason must not create false institutional binding rejection");
assert(s.includes("Na reason, descreva a justificativa sem criar atribuições científicas novas."),"prompt must constrain audit reason");
assert(s.includes("sem atribuição nominal"),"prompt must allow evidence-backed neutral wording");
assert.strictEqual(p.version,"0.14.39");
assert((html.match(/0\.14\.39/g)||[]).length>=2,"UI must display v0.14.39");
console.log("v0.14.39 traceability binding regression OK");
