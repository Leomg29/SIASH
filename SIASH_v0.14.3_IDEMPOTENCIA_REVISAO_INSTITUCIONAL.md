# SIASH v0.14.3 — Idempotência da revisão institucional

Correção da regressão observada no LEG-UTIN-021 — Glicemia Capilar em RN.

- PREPARAR PUBLICAÇÃO não cria nova revisão institucional quando já existe uma linha SIASH Docs na mesma competência (mês/ano).
- O ciclo institucional reutiliza a primeira revisão SIASH da competência.
- Revisões internas, correções, reprocessamentos e testes do mesmo ciclo não geram 04→05→06.
- A limpeza de duplicidades do mesmo ciclo permanece ativa e preserva a primeira revisão institucional.
- A versão vigente anterior continua protegida até a finalização profissional.
- Fluxo de IA Gemini → Cloudflare → OpenAI e correções anteriores do Word/referências foram preservados.
