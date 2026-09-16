# SIASH v0.14.12c — Reimportação segura de Word

## Problema confirmado
Após um Word ter sido preparado com uma revisão institucional indevida, a reimportação de um DOCX correto substituía o arquivo, mas podia manter o estado `publicationPrepared` e a revisão institucional preparada anteriormente.

## Correção
Ao reimportar um Word para uma proposta existente, o SIASH agora invalida somente os metadados da preparação/publicação anterior antes de armazenar e analisar o novo DOCX. Em seguida, a revisão institucional do Word reimportado é detectada novamente pelo Controle Histórico.

Isso permite recuperar com segurança o LEG-UTIN-033: reimportar o Word original Rev.02 deve limpar a preparação Rev.03 e registrar a Rev.02 como revisão institucional importada. Na nova preparação, a Rev.02 deve ser reutilizada, não incrementada.

## Segurança
- Nenhuma versão vigente é alterada durante a reimportação.
- Nenhum histórico publicado é apagado.
- A preparação anterior é invalidada porque se refere a outro conteúdo binário do Word.
- As travas de validação e publicação profissional permanecem ativas.

## Testes
GitHub Actions: sintaxe de `app.js` e `server.js`, JSON de `package.json` e assertivas do ciclo de reimportação concluídas com sucesso.
