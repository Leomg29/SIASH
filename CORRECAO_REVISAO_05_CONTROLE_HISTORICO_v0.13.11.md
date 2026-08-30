# SIASH v0.13.11 — correção da Revisão 05 indevida no Controle Histórico

## Causa raiz
Alguns Words já preparados continham duas revisões institucionais criadas pelo SIASH na mesma competência (ex.: Rev.04 e Rev.05 em Agosto/2026). A Rev.05 intermediária ficava fisicamente gravada no DOCX e voltava a aparecer mesmo após correções no fluxo.

## Correção
- Antes de qualquer nova preparação/publicação, o SIASH lê o Controle Histórico do próprio DOCX.
- Agrupa linhas geradas por `SIASH Docs` pela competência gravada no documento.
- Quando encontra mais de uma revisão SIASH na mesma competência, preserva a primeira revisão institucional do ciclo e remove as posteriores intermediárias.
- Exemplo real esperado: `04 + 05` em Agosto/2026 => mantém `04` e remove `05`.
- A limpeza vale também para POPs antigos já contaminados: ao serem atualizados novamente, o Word-base é saneado antes de criar/consolidar o próximo ciclo.
- Revisões históricas não geradas pelo SIASH (ex.: 00 e 03) não são alteradas.
- O restante do documento e as referências bibliográficas permanecem preservados.

## Segurança
A limpeza é restrita a duplicidade de linhas cuja coluna Elaboração contém `SIASH Docs` e cuja competência é a mesma. Não remove revisões institucionais históricas de outros autores.
