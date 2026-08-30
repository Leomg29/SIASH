# SIASH v0.13.12 — Cloudflare Workers AI

- Mantém integralmente as correções consolidadas da v0.13.11.
- Adiciona Cloudflare Workers AI como fallback entre Gemini e OpenAI.
- Ordem automática: Gemini → Cloudflare Workers AI → OpenAI.
- Usa `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_AI_MODEL` do ambiente do Render.
- Falha de todos os provedores retorna mensagem amigável e não cria revisão.
- Mantém validação profissional obrigatória e o pipeline de referências/rastreabilidade do SIASH Docs.
- Não altera banco de dados nem a lógica institucional de Controle Histórico da v0.13.11.
