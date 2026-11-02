# R2R SalesOS — importação integral do snapshot de código

Este diretório reúne o **código-fonte da versão publicada** e os modelos de integração n8n. O projeto existente `RuanMarcos38/N8N` foi preservado.

**Aplicação publicada:** https://sdrflow-intelligence-1bxmzi.v2.appdeploy.ai/

**Origem:** AppDeploy `sdrflow-intelligence-1bxmzi`, snapshot `1793623299507`.

### Conteúdo
- `app/`: 15 arquivos originais (React, TypeScript, CSS, backend, cron, dependências e testes). Inclui interface SDRFlow legada.
- `integrations/n8n/`: modelos de envio Vapi, alternativa Retell e callback de eventos, **todos desativados**.
- `docs/`: limitações de execução e configuração.
- `templates/modelo-leads.csv`: cabeçalho de importação.

### Execução
O backend usa o SDK gerenciado **AppDeploy**. Copiar arquivos para o GitHub **não instala o SaaS no n8n ou na sua VPS**, nem migra banco de dados, contas ou chaves. O endereço publicado continua ativo em AppDeploy. Para implantar em EasyPanel/VPS, portar o SDK gerenciado, autenticação, persistência e serviços de IA e realizar testes.

As integrações externas não foram configuradas/homologadas e nenhuma chamada, e-mail, WhatsApp ou cobrança foi realizada por este commit.

Leia [Status](docs/STATUS.md), [Integrações](docs/INTEGRACOES.md) e [Migração](docs/MIGRACAO.md). Nunca registre segredos neste repositório público.
