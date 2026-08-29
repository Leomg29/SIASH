# SIASH Cloud v0.13.1 — correção estrutural definitiva das referências

## Causa raiz identificada
A v0.13.0 passou a validar corretamente se referências gerenciadas pela SIASH estavam dentro da seção bibliográfica. Porém, um POP que já havia sido publicado/testado na v0.12.9 podia carregar referências SIASH antigas posicionadas no meio do procedimento. A v0.13.0 encontrava essas referências legadas fora da bibliografia e bloqueava a nova proposta, mesmo quando a nova inserção estava correta.

## Correção
- Foi criada uma normalização estrutural das referências gerenciadas pela SIASH.
- Antes de concluir a proposta, todas as linhas marcadas como `[FONTE ELETRONICAMENTE VERIFICADA]` ou `[REQUER CONFERÊNCIA PROFISSIONAL]` são localizadas em todo o corpo do DOCX.
- Referências SIASH antigas/mal posicionadas são removidas do local incorreto e reinseridas exclusivamente na seção `Referências Bibliográficas`.
- A inserção ocorre antes do bloco institucional `Assinatura e Carimbo`, `Carimbo`, `Anexo(s)` ou outro delimitador reconhecido.
- As referências são deduplicadas por URL/conteúdo normalizado.
- Após a gravação, o DOCX é reaberto e auditado: quantidade, posição e duplicidade são verificadas.
- Se qualquer referência gerenciada permanecer fora da bibliografia, a proposta é bloqueada.

## Segurança preservada
- Alterações técnico-científicas continuam sendo verificadas antes de qualquer mudança estrutural.
- Referências genéricas não são promovidas a fonte eletronicamente verificada.
- Fonte não confirmada continua marcada como `REQUER CONFERÊNCIA PROFISSIONAL`.
- Nenhuma proposta é publicada automaticamente.
- O Word vigente não é substituído em caso de falha.
- A numeração da próxima revisão continua derivada apenas da versão publicada/vigente; falhas do endpoint de IA não publicam nem avançam revisão.

## Testes executados
1. POP real Glicemia Capilar em RN com duas referências SIASH legadas posicionadas no meio do procedimento: ambas foram identificadas para migração ao bloco bibliográfico.
2. Cabeçalhos `9.Referências bibliográficas:`, `Referencias bibliograficas` e variações com número/pontuação.
3. Documento com `Assinatura e Carimbo` como delimitador.
4. Documento sem bloco de assinatura: inserção controlada ao final da seção/documento.
5. Referência duplicada: deduplicação por URL/conteúdo.
6. Referência previamente mal posicionada: remoção e reinserção no bloco correto.
7. Verificação de sintaxe de `server.js` e `app.js` e validação JSON de `package.json`.
