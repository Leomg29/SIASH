# SIASH Cloud v0.13.0 — correções de referências e paginação

Data: 29/08/2026

## Correções implementadas

1. **Referências sempre dentro da seção bibliográfica**
   - A detecção do título de referências passou a exigir um cabeçalho inequívoco (ex.: `9. Referências bibliográficas:`).
   - A SIASH usa a última seção bibliográfica válida do documento e insere as novas fontes antes de `Assinatura e Carimbo`.
   - Após a inserção, o servidor verifica se nenhuma referência nova ficou fora da seção bibliográfica; se isso ocorrer, a proposta é bloqueada.

2. **Verificação eletrônica da publicação específica**
   - Uma URL institucional genérica (ex.: página inicial da ANVISA) não pode mais receber o selo `FONTE ELETRONICAMENTE VERIFICADA`.
   - A SIASH exige que o endereço específico responda e que haja correspondência mínima entre o título citado e o conteúdo/título/endereço acessado.
   - Fontes acessíveis, mas sem correspondência suficiente, permanecem como `REQUER CONFERÊNCIA PROFISSIONAL`.
   - Cada alteração técnica precisa estar vinculada a uma referência bibliográfica retornada de forma rastreável; referências soltas bloqueiam a proposta.

3. **Número de páginas do Controle Histórico**
   - O valor de `docProps/app.xml` não é mais usado como fonte automática de páginas, porque esse metadado pode permanecer desatualizado depois que a SIASH modifica o DOCX.
   - Na publicação, o profissional deve conferir o Word atualizado e informar o número total de páginas. Sem esse número, a publicação é bloqueada.
   - O número confirmado é gravado no Controle Histórico da nova revisão institucional.

## Proteções preservadas

- O POP vigente não é substituído durante a geração da proposta.
- A IA não publica automaticamente.
- Alterações reais no DOCX continuam sendo verificadas antes de inserir referências.
- Histórico institucional, revisão, validade e responsável pela aprovação continuam sendo atualizados somente após aprovação profissional.
- Referências antigas são preservadas.

## Testes executados

- `node --check server.js`: aprovado.
- `node --check app.js`: aprovado.
- `package.json`: JSON válido.
- Teste estrutural com o POP original `GLICEMIA CAPILAR EM RN`:
  - cabeçalho bibliográfico detectado corretamente em `9.Referencias bibliográficas:`;
  - novas referências posicionadas depois das referências existentes e antes de `Assinatura e Carimbo`;
  - nenhuma referência inserida dentro da descrição do procedimento.
- Teste de URL genérica:
  - `https://www.gov.br/anvisa/pt-br` => classificada como endereço genérico, portanto não verificável como publicação específica;
  - URL específica em PDF da BVS/MS => elegível à verificação específica, sujeita à resposta e correspondência de conteúdo em produção.
- Verificado no arquivo de teste real que `docProps/app.xml` permanecia com `Pages=2` embora o Word atualizado passasse visualmente a 3 páginas; por isso o metadado automático foi retirado da decisão institucional.
