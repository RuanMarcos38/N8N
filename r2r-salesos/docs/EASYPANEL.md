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
