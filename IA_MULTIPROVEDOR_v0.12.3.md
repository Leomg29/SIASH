# SIASH Cloud v0.12.3 — IA Multi-Provedor

## Objetivo
Desacoplar o SIASH Docs de um único fornecedor de IA e permitir testes com Google Gemini sem remover a integração OpenAI já existente.

## Provedores
- Google Gemini (`GEMINI_API_KEY`), modelo padrão `gemini-2.5-flash`.
- OpenAI (`OPENAI_API_KEY`), preservada como alternativa.
- Modo `auto`: tenta Gemini primeiro e, se necessário, OpenAI.
- Seleção do provedor disponível em Configurações para o Administrador Proprietário.

## Pesquisa e segurança documental
- Gemini usa Grounding with Google Search para buscar referências atuais.
- OpenAI mantém web_search.
- A IA continua gerando apenas uma PROPOSTA; nenhuma revisão é publicada automaticamente.
- Cabeçalho, identidade institucional, código, histórico e campos administrativos continuam protegidos pelo patch OOXML existente.
- O Word vigente permanece intacto até validação profissional.

## Privacidade
Durante testes no nível gratuito do Gemini, utilizar somente POPs/documentos sem dados identificáveis de pacientes. A produção hospitalar deve passar por validação institucional de privacidade, LGPD, segurança, contratos e configuração adequada do provedor.

## Variáveis Render
- `GEMINI_API_KEY`: chave criada no Google AI Studio.
- `GEMINI_MODEL`: opcional; padrão `gemini-2.5-flash`.
- `AI_PROVIDER`: opcional; `auto`, `gemini` ou `openai`. Padrão `auto`.
- As variáveis OpenAI existentes permanecem válidas.
