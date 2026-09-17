const fs=require('fs');
const p='server.js';
let s=fs.readFileSync(p,'utf8');
function rep(a,b,label){if(!s.includes(a))throw new Error('Trecho não encontrado: '+label);s=s.replace(a,b);}
rep(`const CLOUDFLARE_FREE_MODEL_FALLBACKS = [\n  "@cf/zai-org/glm-4.7-flash",\n  "@cf/google/gemma-4-26b-a4b-it",\n  "@cf/nvidia/nemotron-3-120b-a12b"\n];`,`// v0.14.22 — prioriza o modelo gratuito que concluiu com sucesso o fluxo Tavily no ambiente real.\nconst CLOUDFLARE_FREE_MODEL_FALLBACKS = [\n  "@cf/nvidia/nemotron-3-120b-a12b",\n  "@cf/zai-org/glm-4.7-flash",\n  "@cf/google/gemma-4-26b-a4b-it"\n];`,'ordem Cloudflare');
rep(`  if(requireWebResearch){const err=new Error("Esta revisão exige pesquisa web atual, mas a pesquisa verificável não ficou disponível. Verifique Tavily, Gemini com Google Search ou OpenAI com web_search; o POP vigente permanece inalterado.");err.code="AI_WEB_RESEARCH_REQUIRED";throw err}`,
`  if(requireWebResearch){\n    const tavilyOk=!!webResearch;\n    const err=new Error(tavilyOk\n      ? "A pesquisa web verificável da Tavily foi concluída, porém nenhum modelo de IA disponível conseguiu gerar a proposta dentro dos limites atuais. O POP vigente permanece inalterado."\n      : "Esta revisão exige pesquisa web atual, mas a pesquisa verificável não ficou disponível. Verifique Tavily, Gemini com Google Search ou OpenAI com web_search; o POP vigente permanece inalterado.");\n    err.code=tavilyOk?"AI_GENERATION_UNAVAILABLE_AFTER_WEB_RESEARCH":"AI_WEB_RESEARCH_REQUIRED";\n    throw err\n  }`,'erro final');
fs.writeFileSync(p,s);
console.log('v0.14.22 aplicado');
