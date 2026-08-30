# SIASH v0.14.1 — correção do parser Cloudflare Workers AI

Correção orientada pelo teste real da v0.14 e pela documentação oficial atual do Workers AI.

- `@cf/moonshotai/kimi-k2.5` passa a ser tratado como configuração legada/incompatível com o plano gratuito e não é tentado antes dos modelos Free confirmados.
- O parser da resposta Cloudflare passa a aceitar tanto o envelope REST clássico (`result.response`) quanto o formato atual de chat completion (`result.choices[0].message.content` / `choices[0].message.content`).
- Conteúdo em arrays de partes de texto também é aceito.
- Resposta HTTP bem-sucedida porém sem texto utilizável passa a ser considerada falha recuperável, permitindo testar automaticamente o próximo modelo Free.
- Cadeia Free mantida: GLM-4.7-Flash → Gemma 4 26B → Nemotron 3.
- Logs continuam sem tokens ou conteúdo do POP.
- Demais correções consolidadas do SIASH Docs são preservadas.
