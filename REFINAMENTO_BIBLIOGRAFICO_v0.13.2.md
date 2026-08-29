# SIASH Cloud v0.13.2 — Refinamento bibliográfico

## Objetivo
Consolidar a geração de referências no SIASH Docs sem rótulos internos no Word institucional, com deduplicação semântica, distinção de volumes e posicionamento obrigatório dentro de Referências Bibliográficas.

## Correções
- Rótulos `[FONTE ELETRONICAMENTE VERIFICADA]` e `[REQUER CONFERÊNCIA PROFISSIONAL]` permanecem como metadados de auditoria da SIASH e não são gravados no Word institucional.
- Referências legadas rotuladas são removidas de qualquer posição e reinseridas de forma limpa somente na seção bibliográfica.
- Deduplicação por URL e similaridade bibliográfica, não apenas igualdade literal.
- Volume 2, 3 etc. é preservado como obra distinta; URL `_v1` é reconhecida como volume 1 para evitar duplicação do guia-base quando aplicável.
- Quando a bibliografia institucional usa numeração, novas referências continuam a sequência numérica.
- Auditoria final bloqueia proposta se houver rótulo interno no Word, referência fora da seção ou duplicidade semântica.

## Teste real
Executado sobre o DOCX de Glicemia Capilar em RN que apresentou os erros anteriores. Resultado esperado validado: referências somente na seção 9, antes de Assinatura e Carimbo; referência v1 redundante removida; volume 2 preservado; rótulos internos ausentes; três páginas preservadas.
