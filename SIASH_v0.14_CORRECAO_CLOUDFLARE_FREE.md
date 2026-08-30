# SIASH v0.14 — Correção do fallback Cloudflare no plano Free

## Causa raiz confirmada
O teste da v0.13.14 comprovou que a cadeia Gemini → Cloudflare → OpenAI estava correta, mas o modelo Cloudflare configurado pertencia ao grupo que exige Workers Paid. A Cloudflare passou a retornar HTTP 403 / erro interno 5035 para esses modelos no plano Free.

## Correção
- Mantém a ordem global Gemini → Cloudflare → OpenAI.
- Dentro da Cloudflare, tenta o modelo configurado e, se ele estiver indisponível no Free/403/404/429/capacidade, alterna automaticamente para modelos oficialmente listados pela Cloudflare como disponíveis no Workers Free:
  1. @cf/zai-org/glm-4.7-flash
  2. @cf/google/gemma-4-26b-a4b-it
  3. @cf/nvidia/nemotron-3-120b-a12b
- O modelo padrão Cloudflare no código passa a ser @cf/zai-org/glm-4.7-flash.
- Se a variável de ambiente ainda apontar para um modelo conhecido como Paid (`kimi-k2.6`, `kimi-k2.7-code` ou `glm-5.2`), o SIASH não desperdiça a tentativa: pula diretamente para os modelos Free.
- O status da IA informa os fallbacks Free automáticos.
- Logs registram apenas provedor/modelo/erro resumido, nunca tokens nem conteúdo do POP.
- O diagnóstico controlado continua sem usar POP nem alterar revisão.

## Segurança e governança
Nenhuma regra de publicação, validação profissional, histórico institucional, correção da Revisão 05 ou higiene do Word foi removida.
