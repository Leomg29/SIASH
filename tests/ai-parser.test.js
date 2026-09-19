const fs=require("fs"),vm=require("vm"),assert=require("assert");
const source=fs.readFileSync("server.js","utf8");
const start=source.indexOf("function modelJsonCandidates");
const end=source.indexOf("function geminiGroundingSources",start);
if(start<0||end<0)throw new Error("Parser da IA não localizado.");
const sandbox={};vm.createContext(sandbox);vm.runInContext(source.slice(start,end)+";this.parseModelJson=parseModelJson;",sandbox);
const valid={summary:"Atualização técnica",updates:[{paragraph_index:12,new_text:"Texto atualizado.",reason:"Adequação científica.",references:["Fonte oficial"]}],references:[{title:"Fonte oficial",url:"https://example.org/documento"}]};
const raw=JSON.stringify(valid);
assert.equal(sandbox.parseModelJson(raw).summary,valid.summary);
assert.equal(sandbox.parseModelJson("```json\n"+raw+"\n```").summary,valid.summary);
assert.equal(sandbox.parseModelJson("Resposta:\n"+raw+"\nFim.").summary,valid.summary);
assert.equal(sandbox.parseModelJson(JSON.stringify({result:valid})).summary,valid.summary);
const braces={...valid,summary:"Uso de {chaves} e aspas no texto"};
assert.equal(sandbox.parseModelJson("texto "+JSON.stringify(braces)).summary,braces.summary);
for(const bad of ["{bad",JSON.stringify({summary:"x",updates:"não",references:[]}),JSON.stringify({summary:"x",updates:[{paragraph_index:1,new_text:"x",reason:"r"}],references:[]})]){let rejected=false;try{sandbox.parseModelJson(bad)}catch(e){rejected=e.modelJsonParseFailure===true}assert.ok(rejected,"Saída inválida deveria ser rejeitada");}
console.log("OK: parser seguro passou nos testes de regressão.");