# SIASH Cloud v0.13.10 — Correção do ciclo de revisão institucional

## Causa raiz
A numeração interna das propostas do SIASH (Rev.01, Rev.02, Rev.03...) estava sendo confundida com a numeração institucional gravada no Controle Histórico do Word.

Durante correções sucessivas no mesmo dia/ciclo, o Word já possuía uma revisão institucional criada pelo SIASH (ex.: Rev.04), mas a preparação de uma nova proposta interna calculava `max + 1` e criava Rev.05, Rev.06 etc. mesmo quando se tratava da continuação/correção da mesma atualização institucional.

## Regra implementada
- Revisão interna SIASH e revisão institucional do Word permanecem independentes.
- Se a versão vigente anterior foi validada no mesmo dia e a última linha institucional do Word foi criada pelo SIASH no mesmo mês, a nova proposta é tratada como continuação do mesmo ciclo institucional.
- Nesse caso, a linha institucional existente é atualizada/consolidada no lugar, sem criar nova numeração.
- Em um novo ciclo (data diferente), o comportamento normal volta a ser incrementar a revisão institucional.
- Se um Word já havia sido preparado indevidamente com uma revisão extra, a v0.13.10 remove a linha preparada excedente, volta o fluxo para “Preparar publicação” e consolida a revisão correta.

## Proteções preservadas
- aprovação humana obrigatória;
- versão vigente anterior preservada até a publicação final;
- referências e higiene bibliográfica mantidas;
- página fantasma continua saneada;
- histórico humano/institucional anterior não é apagado;
- backend e rotas preservados.

## Testes
Cenário real `LEG-UTIN-021 — Glicemia Capilar em RN`:
1. Word preparado com Rev.05 indevida: detectado.
2. Ao ignorar a linha preparada, alvo correto identificado: Rev.04 (`mode=reuse`).
3. Rev.05 removida e Rev.04 consolidada: OK.
4. Word preparado final: 3 páginas, revisões 00/03/04, sem Rev.05.
5. Paginação final confirmada como 3 na Rev.04: OK.
6. Simulação de novo ciclo no dia seguinte: nova revisão Rev.05 (`mode=append`), confirmando que o incremento continua disponível quando realmente necessário.
7. `node --check app.js`: OK.
8. `node --check server.js`: OK.
9. `package.json`: válido.
10. `server.js`: idêntico à v0.13.9.
