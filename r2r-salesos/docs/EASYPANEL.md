# R2R SalesOS na VPS / EasyPanel

A aplicação executa frontend e API no mesmo serviço Node.js 24, na porta 3000. Não exige mais o SDK do AppDeploy.

## EasyPanel

- Fonte: `RuanMarcos38/N8N`, ramo `main`, caminho `/`.
- Construção: `Dockerfile`, arquivo `Dockerfile`.
- Volume persistente: `salesos-data` em `/data`.
- Domínio HTTPS encaminhado à porta 3000.
- Variáveis: `DATA_DIR=/data`, `PORT=3000`, `APP_URL=https://seu-dominio`, `COOKIE_SECURE=true` e `SETUP_TOKEN` aleatório com pelo menos 32 caracteres.

Depois de implantar, abra `/login` e crie a primeira conta usando o código de instalação. Após a primeira conta, o cadastro público fica fechado. Contas adicionais exigem convite do proprietário para o e-mail informado. O código de instalação não permite criar novos administradores depois dessa etapa. Não publique senhas nem o arquivo de ambiente no GitHub.

## Persistência e recuperação

O banco SQLite e os arquivos ficam em `/data/salesos.sqlite`, com WAL. Use uma única réplica da aplicação. Faça backups consistentes com a API de backup do SQLite ou pare o serviço antes de copiar o volume inteiro; copiar apenas o arquivo principal durante escrita pode perder alterações do WAL. O volume deve ser preservado nas atualizações. Dados, contas e arquivos antigos do AppDeploy não são migrados automaticamente.

## Integrações

As funcionalidades locais incluem empresas, contatos, pipeline, tarefas, agenda, base de conhecimento, equipe e relatórios sobre os dados registrados. Os serviços externos exigem configuração própria:

- n8n: `N8N_WEBHOOK_URL` HTTPS e `N8N_WEBHOOK_TOKEN`; callbacks usam `SALESOS_EVENT_TOKEN` no cabeçalho `x-salesos-token`.
- IA: `AI_DRAFT_WEBHOOK_URL` HTTPS e `AI_DRAFT_WEBHOOK_TOKEN`. O webhook recebe JSON `{ "prompt": "..." }` e `Authorization: Bearer ...`; deve retornar `{ "text": "rascunho" }`. Sem configuração, a interface informa a ausência do serviço.
- Voz, WhatsApp e pagamentos: mantenha as chaves específicas dos provedores no ambiente do serviço e valide os fluxos n8n antes de habilitar envios. `SALESOS_LIVE_DISPATCH_APPROVED=approved` libera campanhas reais e só deve ser definido após essa validação. O backend mantém as regras de elegibilidade e limites.
- Google Calendar e cobranças de produção não foram implementados neste snapshot; a agenda local e o fluxo Asaas sandbox são recursos distintos.

O agendamento de campanhas roda a cada minuto, com os controles de horário já existentes no backend. Nenhum envio externo é iniciado sem a configuração e habilitação correspondentes.

## Validação

`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

`GET /api/health` verifica a API e a conexão com o banco. Os testes de integração verificam autenticação, cadastro fechado, isolamento de dados, permissões, contatos, pipeline, arquivos assinados, convites, proteção de origem, logout e persistência após reiniciar. Há também testes de rollback, atualização condicional, incremento e paginação.


## Conector com o n8n existente

A versão atual tem um conector para IA local, Hostinger Mail, Evolution e Google Calendar/Meet. Configure `N8N_CONNECTION_OWNER_EMAIL` com o e-mail do administrador autorizado e `N8N_WEBHOOK_TOKEN` com o mesmo código protegido configurado na credencial Header Auth do webhook n8n. O workflow deve estar publicado em `/webhook/r2r-salesos/v1` na instância n8n autorizada.

Em Integrações, clique Conectar e testar ferramentas para vincular o acesso à conta do proprietário. Outras contas não podem vincular ou usar as credenciais dessa instalação. Membros da mesma empresa seguem suas permissões de acesso. O teste é somente de leitura.

Na agenda, o botão Criar Google Meet sincroniza um compromisso salvo. A criação usa ID fixo para reconciliar novas tentativas. Cancelar um compromisso sincronizado também solicita o cancelamento no Google antes de alterar o estado local. Os envios mantêm as verificações de elegibilidade, reserva e a habilitação de produção preexistentes.

As contas de voz e de pagamentos ainda precisam ser identificadas e configuradas. O conector não declara esses serviços conectados. Mensagens recebidas dos workflows anteriores continuam na operação anterior até configurar os callbacks correspondentes.
