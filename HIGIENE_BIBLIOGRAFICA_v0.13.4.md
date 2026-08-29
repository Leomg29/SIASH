# SIASH Cloud v0.13.4 — Higiene bibliográfica e proteção contra fontes genéricas

## Objetivo
Impedir que homepages, portais institucionais e URLs raiz sejam incorporados como referências bibliográficas em POPs institucionais, sem enfraquecer a rastreabilidade e a validação profissional.

## Correções
- Fontes com homepage/portal genérico ficam somente na auditoria interna da SIASH e não são inseridas no Word.
- Alterações técnico-científicas precisam ter ao menos uma fonte bibliográfica específica elegível; alterações sustentadas apenas por fonte genérica são descartadas/bloqueadas.
- O prompt da IA proíbe explicitamente usar homepage institucional como referência.
- A proposta remove referências genéricas já presentes na seção bibliográfica, sem alterar o documento vigente armazenado.
- Após a limpeza, referências numeradas em texto são renumeradas sequencialmente para evitar lacunas.
- Validação final bloqueia a proposta se uma URL genérica permanecer na bibliografia.
- Status de fonte pendente/verificada e motivo de exclusão permanecem na auditoria da SIASH, separados do Word institucional.

## Governança preservada
- Nenhuma publicação automática.
- Versão vigente permanece intacta até aprovação humana.
- Estrutura institucional, histórico e campos administrativos permanecem protegidos.
- Deduplicação semântica e distinção de volumes permanecem ativas.
- Fail-safe: inconsistência bibliográfica bloqueia a proposta.
