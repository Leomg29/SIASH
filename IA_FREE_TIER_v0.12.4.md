# SIASH Cloud v0.12.4 — Gemini Free Tier estável

## Regra de Ouro preservada
Esta versão foi construída diretamente sobre a SIASH Cloud v0.12.3 consolidada. Nenhum módulo, documento, dado, regra de negócio, fluxo de aprovação, governança, restauração de Word ou funcionalidade validada foi removido ou substituído.

## Motivo da atualização
O Gemini 3.6 Flash está disponível no nível gratuito para geração de texto, mas o Grounding com Google Search não está disponível no Free Tier. A v0.12.3 acionava `google_search` em toda revisão, o que podia produzir erro 429 de quota.

## Alterações técnicas
- Gemini padrão atualizado para `gemini-3.6-flash`.
- Pesquisa Google integrada do Gemini fica DESATIVADA por padrão (`GEMINI_SEARCH_MODE=off`).
- Pode ser reativada futuramente, sem nova alteração de código, definindo `GEMINI_SEARCH_MODE=on` no Render quando o projeto tiver um plano compatível.
- Saída do Gemini passou a usar JSON estruturado (`responseMimeType=application/json` + schema) para reduzir respostas malformadas.
- Removido `temperature`, parâmetro descontinuado para os modelos Gemini mais recentes.
- Timeout de segurança de 90 segundos (`GEMINI_TIMEOUT_MS`) para evitar requisições presas indefinidamente.
- Mensagens de erro de quota, indisponibilidade e timeout ficaram mais claras.
- A resposta da API informa o modo de pesquisa usado (`google_search` ou `model_knowledge`).
- A tela de Configurações informa quando a Pesquisa Google está desativada no Free Tier.
- O fluxo continua com Gemini primeiro e OpenAI como alternativa, sem alterar a versão vigente em caso de falha.
- `package.json` atualizado para 0.12.4, corrigindo a divergência cosmética que fazia o log do Render mostrar uma versão anterior.

## Segurança documental mantida
- Somente o Administrador Proprietário pode iniciar revisão automática.
- O Word vigente é a base da proposta.
- Cabeçalho, identidade institucional, código, histórico e campos administrativos continuam protegidos pelo mecanismo existente.
- A IA gera apenas PROPOSTA.
- A revisão vigente não é substituída automaticamente.
- A publicação exige validação profissional.
- Nenhum dado de paciente deve ser enviado no Free Tier.
- Referências geradas sem Pesquisa Google são sugestões e precisam ser verificadas antes da aprovação.

## Validações realizadas antes da entrega
- `node --check server.js`: OK.
- `node --check app.js`: OK.
- `package.json`: JSON válido.
- Auditoria de integridade: todos os arquivos da v0.12.3 não envolvidos nesta atualização permaneceram byte-a-byte idênticos.
- Nenhum documento do acervo foi alterado nesta versão.

## Arquivos alterados
- `server.js`
- `app.js`
- `index.html`
- `package.json`
- este relatório de versão

## Observação operacional
A execução real da API Gemini depende da chave, das quotas do projeto Google e da disponibilidade externa do provedor. A versão foi preparada para evitar o uso automático do recurso pago/indisponível no Free Tier, mas nenhum software pode garantir ausência absoluta de falhas em serviços externos.
