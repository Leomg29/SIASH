# Análise de causa — DOCX vigente

A análise retrocedeu ao fluxo de montagem e publicação do Word. O ponto crítico não era a numeração Rev.05/Rev.02, mas a ausência de uma barreira de integridade entre a manipulação de `word/document.xml` e a gravação do blob como vigente.

A v0.14.18 ampliou o saneamento textual do documento final, porém a arquitetura continuava aceitando a gravação do pacote reconstruído sem reabrir e validar o DOCX completo. Assim, um problema estrutural do pacote/XML podia chegar ao usuário e só ser percebido quando o Microsoft Word tentasse abrir o arquivo.

A v0.14.19 transforma a finalização em operação transacional: validar origem -> modificar -> validar XML -> reconstruir -> reabrir/validar pacote -> salvar backup -> somente então substituir o vigente.

O incidente específico do LEG-UTIN-019 ainda exige reparo do blob já armazenado; deploy de código não modifica retroativamente esse blob.
