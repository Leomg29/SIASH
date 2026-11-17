# SIASH — Plano de testes de resiliência (17/11/2026)

Escopo: somente homologação, dados fictícios e dois usuários de teste. Não executar testes destrutivos na produção.

## Achados na revisão estática de app.js (main v0.14.69)
1. scheduleCloudSave: em falha transitória de rede, exibe aviso mas não agenda nova tentativa se editGeneration não mudou. Risco de edição ficar apenas local sem sincronização.
2. cloudLoadAfterLogin: carrega o payload remoto e substitui S/localStorage sem verificar se existe edição local não sincronizada. Risco de perda da cópia de trabalho após novo login.
3. cloudSave: resposta 401 cai no mesmo tratamento genérico de falha de rede. Necessário fluxo explícito de reautenticação, preservando rascunho.
4. O status Sincronizado deve corresponder à geração efetivamente confirmada pelo servidor. Reavaliar alterações durante requests em andamento.
5. Conflito 409/428: bloqueia novo salvamento e preserva S local, mas não oferece conciliação de diferenças por registro.

## Matriz de testes (executar na homologação)
| ID | Cenário | Resultado esperado |
| --- | --- | --- |
| R01 | Interromper conexão antes de PUT /api/state | Rascunho local preservado, status pendente e retry controlado ao reconectar |
| R02 | Desconectar após envio, antes de receber resposta | Consultar revisão remota antes de repetir; evitar sobrescrita |
| R03 | HTTP 500 e 503 intermitentes | Retry com backoff, sem duplicar nem perder edição |
| R04 | HTTP 401 / token expirado | Solicitar novo login sem descartar rascunho |
| R05 | Reabrir aba com edição pendente | Não substituir local por remoto antes de resolver divergência |
| R06 | Dois usuários alteram o mesmo campo | Detectar conflito e preservar ambas versões |
| R07 | Dois usuários alteram campos diferentes | Conciliar sem perda, mediante validação de regras |
| R08 | Nova edição durante PUT em andamento | Status só passa a Sincronizado após confirmar última geração |
| R09 | Queda da rede durante módulo PICC e Mapa de Dieta | Recuperar alterações pendentes e não duplicar eventos |
| R10 | Repetir login após conflito | Bloquear substituição silenciosa do rascunho local |

## Condições de aprovação
- Zero perda de dados; zero sobrescrita silenciosa.
- Reautenticação não apaga edição pendente.
- Status visível: sincronizado, pendente, offline, conflito, sessão expirada.
- Logs sem dados pessoais de pacientes ou tokens.
- Backup verificado antes de qualquer alteração de banco.
- Testes automatizados e manuais documentados; merge e deploy somente após aprovação.

## Próxima implementação proposta
Adicionar camada de rascunho pendente versionado por usuário, reconciliação ao login, retry exponencial com limite e gatilho online, tratamento de 401, e testes de integração com fetch simulado. Nenhuma dessas correções está implementada por este documento.
