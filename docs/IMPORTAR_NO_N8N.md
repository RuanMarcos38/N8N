# Importação no N8N — R2R Meta ads

## Já configurado

- Supabase: `CRM R2 MARKETING DIGITAL`
- Project ref: `iqrnytsgwaiegddfxfjs`
- Schema exclusivo: `n8n_meta_reports`
- Tabelas: `reporting_clients` e `reporting_runs`
- RPCs acessíveis somente por `service_role`
- RLS ativada nas tabelas novas
- Schemas `public` e `gestao_ads` não alterados

## Arquivos para importar

1. `workflows/meta-ads-relatorio-diario.json`
2. `workflows/meta-ads-error-handler.json` — opcional

## Segredos necessários no ambiente do N8N

```env
SUPABASE_SERVICE_ROLE_KEY=...
META_GRAPH_VERSION=vXX.X
META_SYSTEM_USER_TOKEN=...
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE=R2R
RESEND_API_KEY=...
REPORT_FROM_EMAIL=R2R Marketing Digital <relatorios@seudominio.com.br>
INTERNAL_ALERT_WEBHOOK_URL=...
```

Use `env/n8n.env.example` como modelo e reinicie o N8N após alterar as variáveis.

## Importação

1. No N8N, abra **Workflows**.
2. Escolha **Import from File**.
3. Importe `meta-ads-relatorio-diario.json`.
4. Importe o workflow de erros quando desejar alertas globais.
5. Execute o gatilho **Teste manual**.
6. Depois da homologação, publique/ative o workflow principal.

## Cadastro dos clientes

Nenhum cliente real foi cadastrado automaticamente porque BM ID, Ad Account ID e contato não foram fornecidos. Isso evita disparos para destinatários errados.

Endpoint:

```text
POST https://iqrnytsgwaiegddfxfjs.supabase.co/rest/v1/rpc/n8n_meta_upsert_client
```

Headers:

```text
apikey: SUA_SERVICE_ROLE_KEY
Authorization: Bearer SUA_SERVICE_ROLE_KEY
Content-Type: application/json
```

Use `templates/cadastrar_cliente_rpc.json` como body. Comece com `p_active=false`; ative somente após conferir a conta, o horário e o contato.

## Segurança

- Nunca publique `SUPABASE_SERVICE_ROLE_KEY`.
- Nunca cole tokens reais diretamente nos nós.
- O workflow está fixado no project ref `iqrnytsgwaiegddfxfjs`.
