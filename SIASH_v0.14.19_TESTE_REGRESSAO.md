# Validação v0.14.19

Workflow `SIASH v0.14.19 DOCX safe finalization`, run 35114638335: concluído com sucesso em 16/09/2026.

Validações executadas:
- aplicação idempotente do patch;
- `node --check app.js`;
- `node --check server.js`;
- assertivas de regressão para CRC32, validação do blob final, backup pré-finalização e bloqueio de DOCX inválido;
- confirmação da versão 0.14.19.

A validação em produção do Microsoft Word continua obrigatória após o deploy e antes de encerrar o incidente LEG-UTIN-019.
