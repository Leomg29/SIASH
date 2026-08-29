# SIASH v0.13.8 — correção da página final fantasma

## Causa raiz confirmada
Alguns POPs institucionais legados possuem, na última célula da última tabela (área “Assinatura e Carimbo”), vários parágrafos vazios invisíveis. Ao acrescentar a nova linha do Controle Histórico, esses parágrafos residuais podiam transbordar para uma nova página, produzindo uma página final aparentemente vazia com apenas o cabeçalho.

## Correção
Na preparação da publicação, depois de inserir a única revisão institucional definitiva, o SIASH remove apenas os parágrafos vazios residuais no final da célula “Assinatura e Carimbo”. A limpeza é deliberadamente restrita à última célula da última linha da última tabela e só é executada quando a célula contém “Assinatura ... Carimbo”. Nenhum texto, referência, histórico ou conteúdo técnico é removido.

## Regressão preservada
- mantém a revisão institucional 05 única;
- mantém 00, 03 e 04;
- mantém referências bibliográficas;
- mantém assinatura/carimbo;
- mantém confirmação humana de paginação e publicação.

## Teste real
Aplicado ao Word preparado do LEG-UTIN-021 que apresentava 4 páginas. Foram encontrados 3 parágrafos vazios residuais após “Assinatura e Carimbo”. Após a limpeza restrita, o mesmo documento renderizou em 3 páginas, sem alterar conteúdo visível.
