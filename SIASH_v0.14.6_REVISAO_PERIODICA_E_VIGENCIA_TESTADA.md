# SIASH v0.14.6 — Revisão periódica e renovação de vigência

## Causa identificada
O fluxo de atualização com IA tratava a ausência de alteração técnico-científica rastreável como motivo para bloquear toda a revisão. Isso era correto para impedir revisões artificiais, mas incorreto quando o documento estava em ciclo de revisão periódica/vigência: um POP pode permanecer tecnicamente adequado e ainda assim precisar de nova revisão institucional, nova data de revisão e nova vigência após conferência e aprovação humana.

Caso que revelou o problema: LEG-UTIN-022 — Higiene Oral. O Word institucional possui Revisão 03 (Março/2024) e vigência declarada até Setembro/2025. A IA concluiu que não havia mudança técnica rastreável, e a v0.14.5 bloqueou a criação da revisão documental.

## Correção v0.14.6
- Separação explícita entre **alteração técnico-científica** e **revisão documental periódica**.
- Quando o documento está em revisão necessária, vencida, prioritária ou próxima e a IA não encontra mudança técnica necessária, a SIASH pode criar uma **proposta de revisão periódica sem alteração de conteúdo**.
- A proposta continua sem publicação automática.
- A vigência só é renovada depois de abrir/conferir o Word, aprovação profissional, preparação do Controle Histórico, confirmação da paginação e publicação.
- O Controle Histórico recebe a descrição: **“Revisão periódica — conteúdo técnico mantido sem alterações técnico-científicas após análise assistida.”**
- Fora de um ciclo de revisão periódica, a proteção contra “falsa revisão” continua ativa.
- Se houver alteração técnico-científica, continuam obrigatórias referências específicas/rastreáveis e todas as verificações já existentes.

## Regressões preservadas
Foram mantidas as correções anteriores:
- contexto seguro entre POP e revisão;
- reabertura correta de revisão proposta;
- idempotência da revisão institucional no mesmo ciclo;
- remoção da revisão institucional 05 duplicada no caso Glicemia Capilar;
- Controle Histórico final 00 → 03 → 04 para o caso de regressão da Glicemia;
- paginação registrada como 3 páginas na Revisão Institucional 04 do caso de regressão;
- saneamento de páginas vazias finais;
- bibliografia sem homepages genéricas inseridas como referência institucional;
- fallback Gemini → Cloudflare → OpenAI;
- timeout Cloudflare de 240 s e parâmetros de resposta da v0.14.2.

## Testes executados antes do empacotamento
1. `node --check server.js` — aprovado.
2. `node --check app.js` — aprovado.
3. Documento real Higiene Oral: histórico 00/03 identificado; vigência “Setembro de 2025” identificada; 2 páginas; cenário sem alteração técnica + revisão periódica marcada agora é aceito como proposta periódica.
4. Regressão Glicemia Capilar: artefato de teste final continua 00/03/04, sem Revisão 05, e Rev.04 mantém Nº Páginas = 3.
5. Blocos críticos de idempotência, contexto seguro e reabertura de proposta comparados com v0.14.5 e preservados.
6. Proteções contra alteração técnica sem referência continuam presentes.
7. Configuração Cloudflare/timeout preservada.
8. Integridade do ZIP validada após criação.

## Regra de governança preservada
Nenhuma revisão é publicada automaticamente. Mesmo quando o conteúdo técnico permanece inalterado, a nova vigência depende de conferência e aprovação profissional.
