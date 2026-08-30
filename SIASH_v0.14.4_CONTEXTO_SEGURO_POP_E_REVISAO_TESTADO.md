# SIASH v0.14.4 — Contexto seguro de POP e revisão

Correção construída após reprodução da ocorrência em que o histórico de LEG-UTIN-021 permanecia aberto enquanto a lista principal permitia acionar Preparar publicação de outro POP (LEG-UTIN-016).

## Causa raiz
- A lista principal exibia ações críticas de preparação/publicação para cada documento.
- O botão “Abrir revisão proposta” atualizava o Histórico, mas não atualizava o painel contextual “Revisão pronta para conferência”.
- Assim, a tela podia mostrar contextos diferentes simultaneamente. O alerta com LEG-UTIN-016 era coerente com a ação acionada; não houve troca silenciosa de documento no backend.
- A proteção `history-table-not-found` funcionou e impediu alteração insegura do Word.

## Correções
- Ações críticas Preparar/Finalizar/Solicitar correção foram removidas da lista geral e permanecem no painel da revisão explicitamente aberta.
- “Abrir revisão proposta” agora sincroniza o painel de conferência e o histórico do mesmo documento.
- O painel exibe código, título e revisão ativos.
- Foi adicionada trava de contexto por `docId + code + revision + wordKey`; qualquer ação crítica com contexto divergente é bloqueada.
- A regra v0.14.3 de idempotência mensal da revisão institucional foi preservada.
- A trava `history-table-not-found` foi preservada.

## Testes
- Reprodução estática da inconsistência da v0.14.3.
- Teste de sincronização do contexto da proposta.
- Teste de bloqueio de ação crítica em POP divergente.
- Testes da revisão institucional: 00→03→04 no mesmo ciclo permanece 04; duplicata 05 do mesmo ciclo é removida; novo ciclo pode avançar para 05.
- `node --check` em app.js e server.js.
- Integridade do ZIP validada.
