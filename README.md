# R2R — Relatório diário do Meta ads no N8N

Pacote pronto para importar no N8N, integrado ao projeto Supabase **CRM R2 MARKETING DIGITAL**.

## Isolamento aplicado

```text
Supabase project: iqrnytsgwaiegddfxfjs
Schema do CRM existente: public               (não alterado)
Schema do SaaS Meta ads: gestao_ads            (não alterado)
Schema exclusivo deste fluxo: n8n_meta_reports
```

## Conteúdo

- `workflows/meta-ads-relatorio-diario.json`: workflow principal.
- `workflows/meta-ads-error-handler.json`: alertas globais.
- `database/001_reporting_schema.sql`: migração idempotente já aplicada.
- `env/n8n.env.example`: variáveis necessárias, sem segredos reais.
- `templates/cadastrar_cliente_rpc.json`: modelo de cadastro.
- `templates/clientes_meta_ads.csv`: planilha-modelo.
- `docs/IMPORTAR_NO_N8N.md`: instruções finais.

## Estado atual

O banco já está configurado e validado. Nenhum cliente real foi inserido, pois os IDs das BMs, contas de anúncio e contatos não foram fornecidos.

Consulte `docs/IMPORTAR_NO_N8N.md`.
