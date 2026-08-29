# SIASH Cloud v0.12.8 — correção de integridade DOCX

Correção aditiva sobre a v0.12.7.

## Causa raiz
A v0.12.7 validava as alterações por índice de parágrafo depois de inserir novas referências bibliográficas. A inserção de um novo parágrafo na seção de referências deslocava os índices seguintes e podia gerar falso erro de integridade, embora o conteúdo tivesse sido gravado corretamente.

## Correção
1. Aplica as alterações técnico-científicas no DOCX.
2. Verifica imediatamente cada alteração nos índices estruturais originais.
3. Somente depois incorpora as referências verificadas.
4. Faz uma verificação independente de que as URLs verificadas estão presentes no Word final.
5. Mantém o bloqueio da proposta se qualquer uma das duas verificações falhar.

Nenhuma regra de governança, aprovação humana, histórico, preservação do Word vigente ou validação de referências foi removida.
