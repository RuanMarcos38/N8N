# Situação de módulos — 02/11/2026

Snapshot: `1793623299507`. Compilação e publicação do AppDeploy reportadas como prontas; testes ponta a ponta dos provedores não executados.

| Módulo | Situação |
|---|---|
| Frontend de 15 menus, tema claro e escuro | Implementado |
| Backend, autenticação e espaços de trabalho | Implementado no ambiente AppDeploy |
| Leads, LGPD, importação, Kanban, notas e tarefas | Implementado; revisão de produção pendente |
| Campanhas, pausa e agendador | Implementado; envios não homologados |
| Agenda | Interna; Google Calendar OAuth pendente |
| Agentes IA | Perfis e rascunhos; orquestração autônoma pendente |
| Inbox omnichannel | Eventos internos; callbacks de provedores pendentes |
| Carteira | Asaas sandbox condicionado a credenciais; produção pendente |
| Email, Meta WhatsApp, Vapi e Retell | Workflows importáveis; credenciais e testes pendentes |
| Telefonia 500 chamadas/dia | Planejado; capacidade e conformidade não testadas |
| Banco gerenciado e credenciais | Não incluídos neste repositório |

**Não declarar produção finalizada.** Os fluxos não realizaram disparos reais e o controle de chaves externas ainda não está isolado por tenant.
