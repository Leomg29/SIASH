# SIASH Cloud v0.12.0 — Migração segura + SIASH Docs IA

## O que mudou
- Importação reconhece o backup legado v0.10.10 exportado do localStorage.
- Na tela de login, o backup fica apenas preparado; nada é sobrescrito antes da autenticação do Administrador Proprietário.
- Antes de qualquer substituição do estado Cloud, o backend grava automaticamente um snapshot em `siash_state_history`.
- A credencial/hash local do backup legado não substitui a autenticação Cloud.
- O botão **Atualizar com IA** agora chama o backend da SIASH, usa OpenAI Responses API + Web Search e cria somente uma **proposta Em revisão**.
- A versão vigente permanece intacta até conferência e aprovação profissional.
- O Word vigente é clonado e o conteúdo técnico é alterado dentro do OOXML existente, preservando a estrutura do arquivo; campos administrativos são protegidos contra edição automática.
- Auditoria registra a geração da proposta.

## Variáveis Render
- `OPENAI_API_KEY`: segredo, nunca colocar no GitHub.
- `OPENAI_MODEL`: padrão `gpt-5.2`.

## Limite de segurança
A revisão automática exige Word `.docx`. Documentos antigos `.doc` devem ser convertidos para `.docx` antes da revisão automática. A IA não publica o POP.

## Migração documental
O JSON legado contém metadados e referências `wordKey`, mas não contém os blobs do IndexedDB do navegador antigo. Esses arquivos devem ser exportados/migrados antes de considerar a migração documental completa.
