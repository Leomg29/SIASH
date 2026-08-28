# SIASH Cloud v0.12.2 — Restauração individual de Word vigente

## Objetivo
Permitir que o Administrador Proprietário restaure o arquivo Word correspondente à revisão que já está vigente no SIASH Docs, sem usar o fluxo de atualização por IA.

## Proteções
- Não cria nova revisão.
- Não altera workflow.
- Não altera datas de revisão/validação.
- Não muda aprovação.
- Solicita confirmação mostrando código, título, revisão vigente e nome do arquivo escolhido.
- Registra a operação na auditoria administrativa.
- Envia o Word para o armazenamento Cloud e só então atualiza o vínculo da revisão vigente.

## Uso
Na linha do documento, o Administrador Proprietário verá **Restaurar Word vigente**. Selecione o Word correto, confira a confirmação e conclua. Depois teste o botão **Word** da mesma linha.
