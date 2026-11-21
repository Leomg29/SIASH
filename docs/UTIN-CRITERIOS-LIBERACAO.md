# SIASH UTIN — Critérios de liberação assistencial (homologação)

**Situação:** NÃO LIBERADO PARA REGISTRO CLÍNICO REAL. Esta lista não comprova execução; cada item requer evidência, data e responsável.

## Bloqueadores antes do primeiro plantão

- [ ] Conferir backup restaurável do PostgreSQL, procedimento de restauração e responsável, **sem executar restauração em produção**.
- [ ] Testar em homologação com dados fictícios, em dois navegadores e dois logins independentes, gravação simultânea e erro HTTP 409; nenhuma alteração pode ser sobrescrita silenciosamente.
- [ ] Simular queda de conexão **antes e depois do commit** do PUT, falha de leitura GET e retorno de rede; conferir rascunho local, bloqueio de reenvio incerto e conciliação manual.
- [ ] Testar sessão expirada (401), integridade PIPA (422), revisão ausente (428), armazenamento local indisponível e recuperação após recarregar.
- [ ] Conferir admissão, alta, transferência, isolamento e perfil assistencial em 10 leitos; isolamento não determina perfil intermediário.
- [ ] Conferir censo fechado pelo plantão noturno à meia-noite, sem duplicidade com lançamentos diários.
- [ ] Validar indicadores de ocupação, pacientes-dia, leitos-dia, saídas e média de permanência com cálculo manual de amostra.
- [ ] Verificar PIPA apenas após alta, por município de origem, exclusão de cancelados das contagens, auditoria imutável e preservação de histórico sem data; **não inventar data** para registro histórico.
- [ ] Verificar PICC, VM, mapa de dieta e impressão, pendências compartilhadas, login e permissões de usuários.
- [ ] Confirmar que dados de teste não migrarão para produção e que nenhuma informação clínica real foi alterada durante homologação.
- [ ] Realizar aceite documentado da coordenação da UTIN e dos responsáveis por TI/segurança da informação, com plano de contingência manual para indisponibilidade.

## Condições de liberação

1. CI e testes Cloud verdes no **commit exato** candidato a release.
2. Testes de integração com banco de homologação e múltiplos usuários, com evidências; verificações estáticas isoladas não bastam.
3. Backup e recuperação validados; plano de reversão acordado.
4. Aprovação explícita para merge/deploy e janela de implantação. Não realizar publicação automática a partir desta checklist.
5. Iniciar piloto supervisionado, mantendo rotina de contingência e conferência dos indicadores.

## Registro de evidências

| Cenário | Evidência / link | Data | Responsável | Resultado |
| --- | --- | --- | --- | --- |
| CI / Cloud | | | | Pendente |
| Banco / revisão concorrente | | | | Pendente |
| Falhas de rede / rascunho | | | | Pendente |
| Indicadores / censo | | | | Pendente |
| PIPA / auditoria | | | | Pendente |
| Fluxos assistenciais | | | | Pendente |
| Backup / restauração | | | | Pendente |
| Aceite / implantação | | | | Pendente |
