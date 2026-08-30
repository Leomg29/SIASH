# SIASH v0.14.7 — migração segura de Word .doc para .docx + revisão periódica

## Base consolidada
Esta versão parte integralmente da v0.14.6 e preserva as correções já validadas até a v0.14.5, incluindo:
- contexto seguro entre POP e revisão;
- reabertura correta da revisão proposta;
- idempotência da revisão institucional por ciclo;
- remoção da revisão institucional intermediária duplicada (caso Glicemia: manter 00 → 03 → 04, sem 05);
- confirmação real da paginação antes da publicação;
- limpeza de página fantasma e preservação da estrutura institucional;
- referências bibliográficas rastreáveis;
- Gemini → Cloudflare → OpenAI, com timeout Cloudflare de 240 s e fallback de modelos Free;
- revisão periódica sem alteração técnico-científica, permitindo renovar vigência somente após conferência e aprovação humana.

## Nova correção v0.14.7 — Word antigo .doc
O SIASH agora reconhece exclusivamente arquivos Word binários antigos com extensão `.doc` (não confunde `.docx`).

Quando o Administrador Proprietário entra na SIASH Cloud:
1. o sistema varre as versões documentais cadastradas;
2. somente se localizar `wordName` ou `wordPath` terminado em `.doc`, tenta a migração;
3. recupera o arquivo original sem modificar o histórico;
4. envia o arquivo ao backend autenticado;
5. valida a assinatura binária OLE do Word antigo;
6. converte com LibreOffice Writer em modo headless;
7. valida que o resultado é um DOCX OOXML real com `word/document.xml`;
8. grava o novo `.docx` em uma nova chave documental;
9. só depois atualiza o vínculo da versão para o `.docx`;
10. não cria revisão, não altera vigência, workflow, validação ou aprovação.

Se a conversão falhar, o vínculo original `.doc` é preservado.

Além da varredura automática, o fluxo `Atualizar com IA` possui uma segunda proteção: caso a versão vigente ainda esteja em `.doc`, ela é convertida para `.docx` antes da revisão automática. A revisão técnica continua sendo executada somente sobre DOCX validado.

## Infraestrutura
O Dockerfile passa de `node:20-alpine` para `node:20-bookworm-slim` e instala somente os componentes necessários para a conversão (`libreoffice-writer` e fontes DejaVu). Isso é necessário para garantir que o Render tenha o conversor disponível em produção.

## Testes executados antes do pacote
- `node --check server.js`: aprovado.
- `node --check app.js`: aprovado.
- detector: `arquivo.doc` e `ARQUIVO.DOC` reconhecidos; `arquivo.docx` e PDF ignorados.
- assinatura OLE obrigatória: arquivo falso com extensão `.doc` bloqueado.
- conversão real de 2 arquivos `.doc` binários: ambos convertidos para `.docx`.
- validação OOXML dos 2 resultados: `word/document.xml` presente e íntegro.
- pacote Debian confirmado com `libreoffice-writer` disponível.
- regressão de código: funções críticas de contexto, reabertura, preparação, normalização da revisão institucional, finalização, publicação e limpeza de duplicidade foram comparadas com a v0.14.6 e permaneceram idênticas.
- revisão periódica v0.14.6 preservada (`periodicReviewRequired` / `periodicReviewOnly`).
- fallback Cloudflare v0.14.2 preservado (240 s, 5.000 tokens, reasoning low).
- fixture de Glicemia Capilar conferida: histórico 00 → 03 → 04, sem revisão 05.

## Governança
A migração automática `.doc` → `.docx` é uma operação documental restrita ao Administrador Proprietário e é auditada. Ela não equivale a revisão institucional e não renova vigência por si só.
