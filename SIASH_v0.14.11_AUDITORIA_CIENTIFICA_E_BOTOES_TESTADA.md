# SIASH v0.14.11 — Auditoria científica e botões de revisão

## Base de derivação

Esta versão foi construída diretamente sobre o pacote atual da branch `main` do repositório SIASH, correspondente ao estado funcional identificado no Render/GitHub como v0.14.10. Nenhum arquivo de documento/POP foi alterado durante a consolidação.

## Objetivo

Corrigir a causa-raiz identificada na auditoria retroativa dos POPs: o SIASH não deve interpretar "a IA não encontrou mudança" como prova de que "não existe atualização técnico-científica necessária".

## Regras científicas introduzidas

1. Revisões periódicas e POPs sinalizados pela auditoria exigem pesquisa web atual verificável.
2. Provedores sem pesquisa web ficam fora desse fluxo específico. Gemini só é aceito quando Google Search está habilitado; OpenAI usa `web_search`. Cloudflare permanece disponível para fluxos que não exijam pesquisa atual e para o diagnóstico de fallback já existente.
3. Para concluir revisão periódica sem alteração técnico-científica são exigidas, no mínimo, 2 referências específicas elegíveis e ao menos 1 referência de fonte oficial/autoridade reconhecida.
4. O SIASH detecta o ano mais recente da seção bibliográfica e instrui a revisão a procurar deliberadamente publicações posteriores.
5. POP classificado como `Revisão necessária` não pode ter simples renovação de vigência sem alteração; os pontos auditados devem ser enfrentados com fontes atuais.
6. A aprovação/publicação continua humana. Nenhum POP é alterado ou despublicado automaticamente pela matriz de auditoria.

## Matriz da auditoria retroativa

### Revisão necessária — 10
- LEG-UTIN-032 — Montagem do Box para Admissão do RN
- LEG-UTIN-031 — Montagem do sistema de Drenagem de tórax
- LEG-UTIN-030 — Monitorização da temperatura corporal
- LEG-UTIN-027 — Manipulação mínima UTIN
- LEG-UTIN-026 — Lavagem Gástrica
- LEG-UTIN-024 — Higienização do RN em incubadora
- LEG-UTIN-023 — Higienização das mãos com álcool gel
- LEG-UTIN-022 — Higiene Oral
- LEG-UTIN-020 — Desinfecção Terminal da Incubadora
- LEG-UTIN-018 — Cuidados de Enfermagem na Fototerapia

### Ajuste recomendado — 3
- LEG-UTIN-029 — Monitorização Cardíaca
- LEG-UTIN-019 — Cuidados Pós-Morte
- LEG-UTIN-017 — Cuidados com a Pele do RN

### Confirmados — 2
- LEG-UTIN-021 — Glicemia Capilar em RN
- LEG-UTIN-025 — Inserção de PICC

## Interface SIASH Docs

- Os 10 POPs em revisão necessária exibem `Revisão necessária` e botão `Revisar agora`.
- Os 3 POPs em ajuste recomendado exibem `Ajuste recomendado` e botão `Ajustar`.
- Os 2 POPs confirmados aparecem identificados como `Confirmado` e não são forçados a uma nova revisão.
- Ao abrir um POP auditado, os achados são adicionados ao pedido de revisão como pontos obrigatórios de verificação.

## Preservações verificadas

- Fluxo de contexto seguro da revisão proposta (`ACTIVE_DOC_PROPOSAL`, validação de contexto e reabertura da proposta).
- Verificação estrutural do Word e referências.
- Higiene e deduplicação bibliográfica das versões anteriores.
- Revisão periódica com aprovação humana.
- Migração segura `.doc → .docx`.
- Glicemia Capilar em RN permanece classificada como confirmada, sem rollback do ciclo institucional consolidado.
- PICC permanece classificado como confirmado.
- PostgreSQL não recebeu mudança de estrutura por esta versão; o payload continua sendo persistido no mesmo estado central.

## Testes executados antes do empacotamento

- `node --check server.js`: aprovado.
- `node --check app.js`: aprovado.
- `package.json`: JSON válido e versão 0.14.11.
- Referências locais do `index.html`: `styles.css`, `jszip.min.js` e `app.js` presentes.
- Matriz de auditoria: 10/3/2, sem sobreposição.
- Todos os 15 códigos auditados existem no catálogo real do SIASH Docs.
- Glicemia (`LEG-UTIN-021`) e PICC (`LEG-UTIN-025`) confirmados.
- Higiene das mãos (`LEG-UTIN-023`) classificada como revisão necessária.
- Regra de pesquisa web e mínimo 2+1 presente no backend.
- Bloqueio de renovação simples nos POPs de revisão necessária presente.
- Fluxo de aprovação humana, contexto seguro e migração DOC/DOCX preservados.
- Comparação com o pacote-base: antes da inclusão deste relatório, somente `server.js`, `app.js`, `index.html` e `package.json` foram modificados; nenhum arquivo de documento foi removido ou alterado.

## Observação operacional

Se o ambiente Render tiver apenas Cloudflare Workers AI configurado e nenhum Gemini com Google Search nem OpenAI com web search disponível, os fluxos que exigem pesquisa científica atual serão bloqueados de propósito. O POP vigente continuará intacto até existir um provedor de pesquisa atual verificável.
