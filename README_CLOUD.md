# SIASH UTIN Alpha Consolidada v0.11.0 — Cloud

## O que muda
Esta versão mantém a v0.10.10 e adiciona uma camada de servidor e banco PostgreSQL.
Quando executada por uma URL HTTP/HTTPS:
- login é validado no servidor;
- o estado completo da SIASH é salvo no banco central;
- POPs/Word/PDF importados pelo SIASH Docs são sincronizados no banco;
- o localStorage e IndexedDB permanecem como cópia local de contingência;
- no primeiro login em casa, se o banco central estiver vazio, os dados locais existentes são migrados automaticamente.

## Arquitetura
Navegador (casa/hospital) -> SIASH Cloud (Node/Express) -> PostgreSQL central.

## Variáveis obrigatórias
DATABASE_URL
JWT_SECRET (mínimo 32 caracteres)
PGSSLMODE=require

## Implantação
1. Criar um PostgreSQL em um provedor de nuvem.
2. Publicar esta pasta em uma hospedagem Node.js.
3. Definir as variáveis acima.
4. Abrir a URL publicada.
5. No PRIMEIRO acesso, criar o Administrador Proprietário usando as mesmas credenciais desejadas.
6. No computador de casa, após o primeiro login, a SIASH migra o estado local atual para o banco central se o banco estiver vazio.
7. No hospital, basta abrir a mesma URL e entrar com o mesmo usuário. O estado será carregado do banco central.

IMPORTANTE: não abrir index.html via file:// para uso sincronizado. O modo file:// continua sendo apenas contingência local.

## Implantação simplificada no Render
O pacote inclui `render.yaml`. Depois de colocar a pasta em um repositório GitHub/GitLab/Bitbucket:
1. No Render, escolha **New > Blueprint**.
2. Conecte o repositório.
3. O Blueprint cria o serviço Node e o PostgreSQL e gera automaticamente o JWT_SECRET.
4. Aguarde o deploy e abra a URL `*.onrender.com`.
5. Faça a configuração inicial do Administrador Proprietário.
6. Use a mesma URL em casa e no hospital.

O plano `free` está configurado apenas para TESTE/VALIDAÇÃO. Para uso assistencial real, adotar infraestrutura compatível com requisitos institucionais, LGPD, disponibilidade, backup e segurança.
