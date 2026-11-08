# Censo Neonatal Integrado — contrato de integração (rascunho técnico)

> Status: desenvolvimento isolado no PR #74. Não conectar dados identificáveis de pacientes ao protótipo. Não implantar em produção.

## Fonte única de dados
- Uma internação possui `id` imutável, identificação inicial `RN de [mãe]`, nome civil opcional, sexo, IG em semanas e dias, peso de admissão em gramas, leito e município de origem.
- Alterar o nome civil **não** cria uma segunda internação. Registrar quem e quando alterou, com trilha de auditoria no backend.
- A saída é evento único por internação: tipo (Alta/Transferência/Óbito), instante com fuso, peso de saída, destino, confirmação explícita do PIPA.
- PIPA somente após **Alta** e confirmação; nunca inferir encaminhamento pelo município de origem.
- Contagem por município de origem e mês **local da alta**; um único evento de encaminhamento por alta. Padronizar nomes/identificadores municipais na implementação definitiva.

## Censo diário
- Fotografia às 00:00 no horário local da UTIN (America/Sao_Paulo; atualmente UTC-03).
- Contar RN com `admittedAt <= corte` e sem saída, ou `dischargedAt > corte`.
- Plantão noturno confirma fechamento; registrar usuário, instante, competência, revisão e alterações posteriores.
- Confirmar com a instituição a convenção de paciente-dia antes de substituir os números históricos: a fotografia de 00h pode exigir convenção de atribuição da competência.
- Proibir ocupações simultâneas incompatíveis do mesmo leito, mas permitir remanejamento com trilha temporal.

## Migração e consistência
- Preservar `daily`, `movements`, `beds`, `pipa` e todos os registros antigos.
- Durante transição, **não somar** registros individuais a totais manuais já lançados.
- Implementar reconciliação por competência com status: histórico manual / censo parcial / censo validado.
- Vincular outros módulos ao ID de internação, não ao nome ou leito, inclusive PICC e eventos térmicos.
- Operações devem ser transacionais, com controle de revisão/concorrência e auditoria; avaliar schema PostgreSQL separado ou migração versionada antes de adicionar dados identificáveis ao JSON `siash_state`.
- Permissões por perfil e acesso mínimo, TLS, backups e retenção conforme política institucional e LGPD.

## Aceite antes de disponibilizar em homologação
1. Executar `node --test tests/censo-core.test.js` com resultado verde.
2. Testar admissão 23:59, 00:00 e 00:01; alta exatamente 00:00.
3. Testar virada do mês no PIPA e municípios diferentes.
4. Testar troca de nome sem alterar ID, alta sem PIPA, reinternação e leito remanejado.
5. Testar dois usuários simultâneos, conflitos de revisão e correções de censo fechado.
6. Conferir invariantes de ocupação, saídas e indicadores sem apagar histórico.
7. Validar backup, restauração e permissões antes de usar dados reais.
