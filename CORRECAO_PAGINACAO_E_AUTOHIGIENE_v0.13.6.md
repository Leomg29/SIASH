# SIASH Cloud v0.13.6 — Paginação final e auto-higiene retrocompatível

## Causa raiz da paginação
Até a v0.13.5, o profissional informava o total de páginas antes de o SIASH acrescentar a nova linha da revisão institucional no Controle Histórico. Em documentos próximos do limite de página, a própria inclusão do histórico podia alterar a paginação depois da confirmação, tornando o número gravado incorreto.

## Correção v0.13.6
A publicação passa a ocorrer em duas fases:
1. PREPARAR PUBLICAÇÃO: o SIASH monta o Word final com nova revisão institucional, data, validade, responsáveis e histórico; o campo Nº Páginas fica como "A conferir".
2. O profissional abre esse Word já estruturalmente final e confere a paginação real.
3. FINALIZAR PUBLICAÇÃO: o total informado é gravado na linha que já existe; nenhuma nova linha é criada nessa etapa.
4. Somente após essa confirmação a versão anterior é marcada como obsoleta e a nova versão torna-se vigente.

O resumo inserido no Controle Histórico também foi limitado a uma descrição concisa (até 100 caracteres) para reduzir expansão desnecessária da tabela sem perder rastreabilidade. Se o documento realmente precisar ganhar uma página, a segunda fase registra o total real, em vez de tentar forçar a paginação anterior.

## Auto-higiene de referências de versões antigas
A rotina de atualização com IA agora detecta resíduos bibliográficos deixados por versões anteriores do SIASH:
- homepages/portais institucionais genéricos na bibliografia;
- marcadores internos legados da SIASH.

Quando um POP antigo for atualizado novamente, esses resíduos são saneados na PROPOSTA mesmo se a IA não encontrar mudança técnico-científica necessária. O Word vigente original não é alterado silenciosamente; a correção continua sujeita à conferência e aprovação humana.

Referências institucionais históricas válidas não são reescritas automaticamente. O saneamento automático é conservador e focado em resíduos gerados pela própria SIASH ou URLs institucionais claramente genéricas.

## Pedido de correção realmente enviado à IA
O texto registrado em "Solicitar correção" passa a ser enviado ao backend e incorporado ao prompt da revisão. Antes, o pedido ficava salvo na interface, mas não chegava efetivamente ao provedor de IA.

## Governança preservada
- aprovação humana obrigatória;
- nenhuma publicação automática;
- versão vigente anterior preservada até a finalização;
- histórico institucional anterior preservado;
- deduplicação semântica e higiene bibliográfica mantidas;
- proteção contra fontes genéricas mantida;
- 13 rotas do backend preservadas;
- sem alteração dos demais módulos da SIASH.

## Testes de regressão
- sintaxe app.js: OK;
- sintaxe server.js: OK;
- package.json: válido;
- 13/13 rotas do backend preservadas;
- POP Glicemia Capilar: inclusão de nova linha com histórico conciso permaneceu em 3 páginas no cenário real testado;
- cenário de histórico longo que cresce para 4 páginas: a segunda fase mantém 4 páginas após gravar o número, validando a ordem correta do fluxo;
- POP antigo com ANVISA/SBP genéricos: auto-higiene removeu 2 URLs genéricas sem exigir alteração técnica nova;
- POP com marcador SIASH legado combinado: marcador e fonte genérica foram removidos, preservando referência específica válida;
- Word atual com bibliografia limpa: permaneceu estável, sem remoção indevida.
