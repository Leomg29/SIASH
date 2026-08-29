# SIASH v0.13.9 — correção da página fantasma em Word já preparado

## Causa raiz confirmada
A v0.13.8 continha a rotina correta de remoção dos parágrafos vazios após “Assinatura e Carimbo”, mas ela era executada apenas durante **PREPARAR PUBLICAÇÃO**. No teste real, o Word já havia sido preparado na v0.13.7 e o estado `publicationPrepared=true` foi preservado. Após o deploy, a interface mostrou diretamente **FINALIZAR PUBLICAÇÃO**, portanto a v0.13.8 nunca voltou a executar a limpeza no arquivo já preparado.

## Correção
- A limpeza agora é aplicada também ao **abrir/download do Word preparado**, cobrindo propostas preparadas em versões anteriores.
- A limpeza também é repetida imediatamente antes da finalização/publicação como segunda barreira.
- A busca da célula “Assinatura e Carimbo” deixou de assumir que ela é obrigatoriamente a última célula da última tabela.
- São removidos somente parágrafos vazios posteriores à assinatura; texto, imagens, campos, referências e demais elementos são preservados.
- Nenhuma revisão é publicada automaticamente.

## Regressão
Testado no DOCX real que apresentava 4 páginas. A remoção dos 3 parágrafos vazios residuais reduziu o documento para 3 páginas, preservando as revisões 00, 03, 04 e 05 e toda a bibliografia.
