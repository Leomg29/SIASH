# SIASH Cloud v0.13.5 — Correção da causa raiz das referências genéricas

## Causa raiz confirmada
A v0.13.4 removia corretamente referências genéricas já localizadas dentro da seção bibliográfica e bloqueava novas fontes genéricas vindas da IA. Porém, POPs revisados por versões antigas da SIASH podiam conter um parágrafo legado fora da bibliografia, no formato `Referências incorporadas na revisão: ...`, reunindo mais de uma fonte.

Durante a normalização, a v0.13.4 removia esse parágrafo legado, extraía suas referências e as recolocava como candidatos bibliográficos. O erro estava aqui: **as referências extraídas do legado não passavam novamente pelo filtro `wordReferenceEligibility`**. Assim, uma homepage antiga (por exemplo, a raiz da ANVISA) era removida e logo em seguida reintroduzida na bibliografia. A validação final detectava a homepage e bloqueava a proposta.

## Correção
- Toda referência legada extraída agora passa pela mesma regra de elegibilidade aplicada às fontes atuais da IA.
- Homepage/portal genérico legado é descartado antes de entrar em `candidates`.
- Fonte específica legada válida continua sendo migrada normalmente.
- A validação final contra URLs genéricas permanece ativa como barreira de segurança.
- Nenhuma regra de governança, aprovação humana, histórico, deduplicação semântica ou proteção estrutural foi removida.

## Regressão reproduzida e testada
Foi usado o Word real da revisão vigente que contém um único parágrafo legado com:
1. uma URL genérica da ANVISA;
2. uma URL específica do guia do Ministério da Saúde, volume 2.

Na v0.13.4 o cenário reproduziu exatamente o erro do Cloud: `Falha de integridade: referência com URL institucional genérica permaneceu na bibliografia do Word.`

Na v0.13.5 o mesmo arquivo e as mesmas referências foram processados com sucesso:
- homepage ANVISA legada: rejeitada;
- homepage SBP atual: não elegível para Word;
- guia específico do Ministério da Saúde v.2: preservado;
- nenhuma URL genérica permaneceu na bibliografia;
- nenhum rótulo interno da SIASH permaneceu no Word;
- documento final renderizado em 3 páginas sem quebra estrutural.
