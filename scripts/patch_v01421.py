from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
old='if(requiresCurrentWebResearch&&!(["web_search","google_search"].includes(String(ai.researchMode||""))))throw new Error("Esta revisão exige pesquisa web atual. Nenhum provedor com pesquisa web verificável concluiu a análise; o POP vigente permanece inalterado.");'
new='if(requiresCurrentWebResearch&&!(["web_search","google_search","tavily_search"].includes(String(ai.researchMode||""))))throw new Error("Esta revisão exige pesquisa web atual. Nenhum provedor com pesquisa web verificável concluiu a análise; o POP vigente permanece inalterado.");'
if old not in s:
    if new in s:
        print('Patch v0.14.21 already applied')
    else:
        raise SystemExit('Expected final web-research validation line not found; refusing unsafe patch')
else:
    s=s.replace(old,new,1)
    p.write_text(s,encoding='utf-8')
    print('Applied v0.14.21: tavily_search accepted by final verified-research gate')
