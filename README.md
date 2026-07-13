# N8N — R2R Marketing Digital

Automações profissionais da R2R Marketing Digital.

## Relatório diário do Meta ads

Arquivos:

- `workflows/meta-ads-relatorio-diario.json`: fluxo principal importável no N8N.
- `workflows/meta-ads-error-handler.json`: tratador de erros importável no N8N.
- `database/001_reporting_schema.sql`: tabelas de clientes, bloqueios e logs.
- `templates/clientes_meta_ads.csv`: modelo de cadastro.
- `docs/ARQUITETURA_RELATORIO_META_ADS.md`: arquitetura, segurança e configuração.

## Instalação

1. Execute o SQL.
2. Importe os dois workflows.
3. Associe as credenciais PostgreSQL e SMTP.
4. Configure as variáveis/segredos.
5. Selecione o error workflow nas configurações do fluxo principal.
6. Faça um teste controlado antes de publicar.