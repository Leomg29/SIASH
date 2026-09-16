# SIASH v0.14.19

Correção de integridade do Word no SIASH Docs.

- valida pacote DOCX e CRC antes da finalização;
- valida XMLs internos e estrutura mínima do Word;
- usa atualização segura da célula de histórico;
- valida novamente o DOCX gerado antes de gravá-lo como vigente;
- mantém backup pré-finalização;
- bloqueia substituição se o resultado final não passar na validação;
- preserva a governança de revisão institucional/interna em reparos técnicos.
