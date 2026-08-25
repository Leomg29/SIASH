SIASH — Sistema de IA em Saúde Hospitalar
UTI Neonatal — Alpha Consolidada v0.10.6

EVOLUÇÃO DA BASE OFICIAL v0.8
- Preserva os módulos e dados da Alpha Consolidada v0.8.
- Adiciona Administrador Proprietário / Super Admin exclusivo.
- Primeiro uso exige criação local da credencial exclusiva do proprietário.
- Usuário operacional de teste permanece: coordenacao.utin / siash.
- Configurações estruturais ficam invisíveis/bloqueadas para usuário operacional.
- Área Administração SIASH com regra de governança e auditoria administrativa.
- Credencial proprietária armazenada como hash SHA-256 no navegador, não em texto puro.

IMPORTANTE — SEGURANÇA
Esta versão é um protótipo local (HTML/CSS/JavaScript). A proteção de interface e hash local evita alterações acidentais e separa os perfis durante os testes, mas não impede um usuário com acesso aos arquivos-fonte de modificar o próprio código. Na versão de produção, autenticação, autorização, auditoria e mudanças estruturais deverão ser validadas no backend/servidor, com banco de dados, hash robusto com salt (Argon2/bcrypt), MFA e trilha de auditoria imutável.

Não utilizar dados identificáveis reais de pacientes nesta fase local.


MELHORIA v0.9.3 — SALVAMENTO SEM CLIQUE EXTRA
- Ao salvar o Lançamento Diário, a janela bloqueante com botão OK foi removida.
- A SIASH exibe apenas a mensagem “Dados salvos” por aproximadamente 1 segundo e a remove automaticamente.
- O salvamento, os cálculos e os dados locais permanecem inalterados.


CORREÇÃO v0.9.3 — VENTILAÇÃO MECÂNICA
- RN em VM passa a ser tratado como censo diário, e não como novos pacientes somados a cada dia.
- Indicadores mensais agora separam: RN em VM atualmente (último dia lançado), VM-dia (soma dos RNs em VM por dia), intubações, extubações programadas e extubações acidentais.
- Foram adicionados os campos “Intubações no dia” e “Extubação programada”.
- Demais campos de evento (admissões, altas, transferências, óbitos, PICC inserido, teste do pezinho etc.) continuam acumulativos por ocorrência.
- Dados antigos permanecem compatíveis; novos campos assumem zero quando inexistentes.


CORREÇÃO v0.9.4 — DASHBOARD / PROGRAMA PIPA
- O card PIPA do Dashboard passa a usar como fonte o total registrado no módulo Programa PIPA para a competência atual.
- O valor é recalculado automaticamente após incluir ou excluir registros do Programa PIPA.

MELHORIA v0.9.4 — COMPARATIVO MENSAL
- Os três gráficos (Taxa de ocupação, Média de permanência e Pacientes-dia) foram reorganizados em uma grade compacta.
- Em telas desktop amplas, os três gráficos aparecem lado a lado e com altura reduzida para diminuir a necessidade de rolagem.
- Mantida adaptação responsiva para telas menores.


ATUALIZAÇÃO v0.9.6 — CICLO INTEGRADO DO PICC
- Gestão de PICC é a fonte oficial dos dados de PICC.
- Data da inserção é informada no registro do dispositivo.
- Lançamento Diário mostra PICCs inseridos automaticamente e em modo somente leitura.
- Lista de PICCs ativos por leito mostra dias de PICC calculados automaticamente.
- Retirada registra data, motivo e observação; o dispositivo sai dos ativos e permanece no histórico.
- Motivos incluem Programada / suspensão do tratamento e Infiltração.
- Indicadores mensais incluem PICCs inseridos, PICC-dia, ativos e retirados.
- Registros antigos são migrados preservando os dados existentes.


ATUALIZAÇÃO v0.10.6 — SIASH DOCS FUNCIONAL
- SIASH Docs deixa de ser apenas inventário e passa a operar com catálogo documental, consulta e versionamento.
- POPs iniciais incorporados: Admissão do Recém-Nascido na UTIN e Sepse Neonatal, em PDF e Word.
- Usuário operacional pode consultar a versão vigente e o histórico.
- Administrador Proprietário pode cadastrar documento, iniciar nova revisão, anexar PDF/Word atualizado e avançar o fluxo: Em elaboração → Em revisão → Aguardando aprovação → Vigente.
- Ao publicar nova revisão como Vigente, a versão vigente anterior é marcada como Obsoleta, mas permanece no histórico.
- Revisão bienal é o padrão, com alertas de próximo da revisão e revisão vencida.
- Arquivos adicionados pelo usuário são armazenados localmente no navegador por IndexedDB; metadados continuam no mesmo STORE da base oficial.
- A aprovação é sempre humana; o sistema não publica automaticamente alterações clínicas.
- Nesta fase local, edição do Word ocorre no aplicativo de edição instalado no computador; depois o arquivo revisado pode ser anexado ao SIASH Docs.
