# Validação de concorrência na inicialização do estado SIASH

## Objetivo
Verificar em HOMOLOGAÇÃO que `PUT /api/state/init` cria somente uma linha de estado central, mesmo sob duas requisições concorrentes. Não executar contra produção.

## Pré-condições
- Banco de homologação identificado e backup recuperável verificado.
- Credenciais de teste válidas; não usar dados de pacientes reais.
- Executar somente em uma instância de homologação descartável ou com estado central vazio preparado de forma controlada.

## Casos
1. Primeira inicialização com payload JSON objeto: HTTP 200, `revision=1`.
2. Segunda inicialização: HTTP 409, `conflict=true`; estado e revisão permanecem inalterados.
3. Duas inicializações simultâneas: exatamente uma HTTP 200 e uma HTTP 409.
4. Payload `null`, array ou string: HTTP 400, nenhuma gravação.
5. Sem token: HTTP 401, nenhuma gravação.
6. Conferir `SELECT count(*) FROM siash_state WHERE id=1` = 1 e revisão = 1 após o teste.
7. Confirmar que nenhuma alteração foi feita nos módulos clínicos.

## Critérios de liberação
- Todos os casos executados e aprovados com evidências.
- Sem alteração direta de produção.
- Revisão de impacto na rotina de primeiro login, migração e recuperação de sessão.

## Observação
Este documento é um plano; não comprova execução ou aprovação.
