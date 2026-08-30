# SIASH v0.14.5 — Reabertura segura da revisão proposta

## Problema reproduzido
Na v0.14.4, o botão **Abrir revisão proposta** executava `renderProposalReady(...)` enquanto o painel-pai `doc-revision-panel` permanecia oculto e, logo em seguida, chamava `showDocHistory(...)`. O resultado visual era o histórico do POP, não o painel de conferência da revisão. Ao fechar o histórico, a lista principal reaparecia e o fluxo ficava sem acesso visível a **PREPARAR PUBLICAÇÃO**.

## Causa raiz
A correção da v0.14.4 protegeu o contexto entre POPs, mas não restaurou o contêiner visual completo da revisão ao reabrir uma proposta já existente. O estado interno e o estado visual ficaram parcialmente sincronizados.

## Correção
- Criada a rotina `openProposalWorkspace(i, proposalI)` para restaurar explicitamente o contexto completo da proposta.
- O painel de revisão é reaberto antes da renderização da proposta.
- O histórico é ocultado ao abrir a revisão proposta.
- Código, título, revisão proposta, revisão vigente, notas e fontes são restaurados no painel correto.
- O foco/rolagem é direcionado para **Revisão pronta para conferência**.
- Ao fechar o Histórico, se existir uma proposta ativa, o SIASH retorna ao painel da proposta em vez de deixar o usuário apenas na lista.
- Mantidas as travas da v0.14.4 que comparam documento, código, revisão e arquivo Word antes de ações críticas.
- Mantida a idempotência institucional da v0.14.3: no mesmo ciclo, `00 → 03 → 04` permanece `00 → 03 → 04`; uma 05 duplicada do mesmo ciclo é removida.
- Rótulos visuais atualizados para v0.14.5.

## Testes executados antes do pacote
1. `node --check app.js` — aprovado.
2. `node --check server.js` — aprovado.
3. Regressão exata da v0.14.4 simulada: painel de revisão inicialmente oculto + histórico visível + clique em Abrir revisão proposta.
   - proposta correta recuperada: PASS;
   - painel-pai exibido: PASS;
   - histórico ocultado: PASS;
   - LEG-UTIN-021 e revisão 03 restaurados: PASS;
   - rolagem para a proposta: PASS.
4. Regressão da revisão institucional:
   - histórico `00 → 03 → 04` no mesmo ciclo reutiliza 04: PASS;
   - histórico contaminado `00 → 03 → 04 → 05` remove 05 e preserva 04: PASS.
5. Trava de contexto crítico da v0.14.4 preservada.
6. Timeout/fallback Cloudflare de 240 s da v0.14.2 preservado.

## Resultado esperado no teste de produção
Em **Glicemia Capilar em RN — LEG-UTIN-021**, clicar em **Abrir revisão proposta** deve abrir diretamente o painel **Revisão pronta para conferência**, identificado como revisão 03, com os botões **ABRIR WORD ATUALIZADO**, **VER ALTERAÇÕES APLICADAS**, **PREPARAR PUBLICAÇÃO** e **SOLICITAR CORREÇÃO**. Não deve abrir somente o histórico.
