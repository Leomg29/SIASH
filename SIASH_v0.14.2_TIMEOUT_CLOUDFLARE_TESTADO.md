# SIASH v0.14.2 — timeout e latência do fallback Cloudflare

Correção baseada no log real de 30/08/2026: Gemini retornou alta demanda; o fallback chegou ao GLM-4.7-Flash, mas o SIASH abortou a inferência aos 90 segundos.

Alterações:
- timeout padrão da Cloudflare ampliado de 90 s para 240 s;
- limite de saída reduzido de 12.000 para 5.000 tokens para evitar geração excessiva e reduzir latência/custo;
- `reasoning_effort=low` no GLM-4.7-Flash para revisão documental objetiva;
- timeout da Cloudflare passa a ser considerado recuperável, permitindo tentar o próximo modelo gratuito se necessário;
- logs registram modelo, timeout, limite de tokens e esforço de raciocínio, sem registrar token nem conteúdo do POP;
- fluxo preservado: Gemini → Cloudflare (modelos Free) → OpenAI;
- nenhuma regra de publicação, histórico institucional, Word ou referências foi alterada.

Validações locais antes do pacote:
- sintaxe Node de `server.js` e `app.js`;
- teste do parser Cloudflare nos formatos REST/chat já suportados;
- teste escalonado do mecanismo de timeout comprovando que uma resposta que ultrapassaria o limite antigo não é abortada pelo novo limite proporcional;
- teste de AbortController confirmando interrupção quando o limite novo é realmente excedido;
- inspeção do ZIP final com exatamente cinco arquivos.
