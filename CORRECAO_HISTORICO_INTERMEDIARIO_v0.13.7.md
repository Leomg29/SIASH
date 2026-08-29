# SIASH v0.13.7 — correção do acúmulo de revisões intermediárias no Controle Histórico

## Causa confirmada
A página adicional não era um problema de paginação em si. Ela era consequência de uma linha intermediária gerada pelo próprio SIASH (ex.: Revisão 05) permanecer no Word-base e ser carregada para a revisão seguinte.

## Correção
Na geração de uma nova proposta, o SIASH agora executa saneamento conservador do Controle Histórico:
- preserva integralmente linhas institucionais legadas/humanas;
- identifica apenas linhas cuja Elaboração começa por `SIASH Docs /`;
- dentro do mesmo mês/ano e com os mesmos responsáveis, preserva a primeira linha SIASH e remove somente linhas posteriores duplicadas/intermediárias;
- não altera referências bibliográficas, conteúdo técnico, cabeçalho, código ou assinaturas;
- registra em auditoria quantas linhas intermediárias foram saneadas.

## Proteção
Revisões SIASH de períodos diferentes ou com responsáveis diferentes permanecem preservadas. A regra não é uma exclusão genérica do histórico.
