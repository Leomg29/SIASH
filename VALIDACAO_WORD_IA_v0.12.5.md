# SIASH Cloud v0.12.5 — Validação real do Word gerado pela IA

Base: v0.12.4 consolidada.

## Regra de Ouro preservada
Nenhum módulo, documento institucional, dado, fluxo validado ou regra de governança foi removido. A versão vigente continua protegida e só muda após validação profissional.

## Correção principal
A SIASH agora só libera uma proposta de IA para conferência quando comprova que o DOCX gerado recebeu alterações reais.

- elimina atualizações sem mudança efetiva;
- bloqueia proposta se o DOCX final for idêntico ao vigente;
- reabre o DOCX gerado e verifica cada parágrafo alterado;
- bloqueia a proposta se qualquer alteração solicitada não tiver sido realmente gravada;
- registra antes/depois/motivo de cada alteração;
- exibe quantidade de alterações comprovadas;
- adiciona botão **VER ALTERAÇÕES APLICADAS**;
- propostas de IA antigas sem selo de verificação não podem ser publicadas automaticamente na v0.12.5.

## Observação sobre o Controle Histórico institucional
A numeração interna do SIASH (ex.: revisão 02) não deve sobrescrever automaticamente a numeração institucional existente dentro do Word (ex.: revisão 04). A atualização do Controle Histórico institucional permanece sob validação profissional para evitar apagar ou falsificar revisões anteriores.

## Segurança
O Word vigente não é substituído durante a geração. Falhas de IA, OOXML, quota ou verificação deixam a versão vigente intacta.

## Consolidação adicional — Controle Histórico institucional
Antes do deploy da v0.12.5 foi incorporada a regra de publicação institucional: durante a proposta o histórico do Word permanece preservado; somente após validação profissional a SIASH detecta a maior revisão institucional existente no próprio DOCX, calcula a próxima revisão (ex.: 04 -> 05), acrescenta nova linha ao Controle Histórico, registra mês/ano atual, número de páginas disponível nos metadados do DOCX, resumo da revisão, responsável pela verificação/aprovação e atualiza a validade bienal. A revisão interna da SIASH permanece independente da revisão institucional. Se a tabela de Controle Histórico não puder ser localizada/atualizada com segurança, a publicação é bloqueada e a versão vigente anterior permanece preservada.


## Consolidação final — autoria e histórico institucional
Na publicação, o campo **Histórico de Alteração** recebe somente o resumo objetivo das alterações realizadas, sem os rótulos internos “PROPOSTA gerada por IA” ou “verificada pelo SIASH”. O campo **Elaboração** passa a ser preenchido como `SIASH Docs / <profissional aprovador>`. Os campos **Verificação** e **Aprovação** recebem o nome do profissional que efetivamente aprovou a revisão, informado e confirmado no momento da publicação.
