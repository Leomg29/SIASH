# SIASH v0.13.14 — Teste diagnóstico controlado do fallback Cloudflare

- Mantém a v0.13.13 como base.
- Adiciona diagnóstico autenticado em Configurações.
- O teste simula a indisponibilidade do Gemini somente na requisição diagnóstica.
- Usa o mesmo `runAIRevision` e a mesma ordem de fallback da produção.
- Esperado: Gemini simulado indisponível → Cloudflare Workers AI.
- Não envia POP, não usa dados de paciente, não cria revisão, não publica documento e não altera chaves.
- Registra somente eventos técnicos de provedor/modelo/tempo, sem tokens e sem conteúdo de POP.
