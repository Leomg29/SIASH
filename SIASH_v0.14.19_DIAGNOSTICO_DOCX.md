# SIASH v0.14.19 — Diagnóstico e proteção DOCX

## Incidente observado
O Word vigente do LEG-UTIN-019, já publicado no mesmo ciclo institucional Rev.05 / revisão interna Rev.02, passou a ser rejeitado pelo Microsoft Word. A correção deve preservar o ciclo documental e não criar Rev.06 apenas para reparar o arquivo.

## Ponto de risco identificado
O fluxo de finalização alterava diretamente `word/document.xml` dentro do pacote DOCX e gravava o blob resultante como vigente sem uma validação estrutural completa do pacote imediatamente antes da substituição.

## Proteções v0.14.19
1. valida o DOCX de entrada com CRC32 e partes obrigatórias;
2. valida todos os XML do pacote com parser XML;
3. exige `word/document.xml` com `w:document`/`w:body` e células de tabela estruturalmente válidas;
4. atualiza o texto final do histórico pela célula-alvo, com escape XML, em vez de substituição textual bruta;
5. valida novamente o DOCX gerado antes de substituir o vigente;
6. cria backup do blob imediatamente anterior à finalização;
7. se qualquer validação falhar, a publicação é bloqueada e o Word vigente não é sobrescrito.

## Governança
O reparo do LEG-UTIN-019 deve manter Rev.05 institucional e Rev.02 interna. Uma nova revisão só será criada por nova revisão técnico-científica real, não por reparo técnico do arquivo.
