# Arquitetura — Relatório diário do Meta ads

## Projeto utilizado

```text
Supabase: CRM R2 MARKETING DIGITAL
Project ref: iqrnytsgwaiegddfxfjs
URL: https://iqrnytsgwaiegddfxfjs.supabase.co
Schema exclusivo: n8n_meta_reports
```

O fluxo não reutiliza nem altera as tabelas existentes dos schemas `public` e `gestao_ads`.

## Fluxo

```text
Schedule Trigger / Teste manual
        ↓
RPC n8n_meta_claim_due_clients
        ↓
Separar clientes
        ↓
Loop por cliente — lote 1
        ↓
Meta ads Insights — hoje e ontem em uma chamada
        ↓
Normalização, métricas e variação
        ↓
Validação de dados
    ┌───┴──────────────┐
    ↓                  ↓
 WhatsApp            E-mail
 Evolution API       Resend
    ↓                  ↓
Validação HTTP       Validação HTTP
    └───┬──────────────┘
        ↓
RPC de sucesso ou falha
        ↓
Espera
        ↓
Próximo cliente
```

## Banco isolado

### `n8n_meta_reports.reporting_clients`

Armazena somente a configuração operacional dos relatórios: nome do cliente, BM ID, Ad Account ID, fuso, moeda, canal, destino, horário, dias de envio, ações consideradas como resultado, janela de atribuição, métricas e bloqueio de concorrência.

Nenhum token do Meta ads é salvo nessa tabela.

### `n8n_meta_reports.reporting_runs`

Registra data, execução do N8N, métricas de hoje e ontem, mensagem, status, falhas e tentativas. A chave única `client_id + report_date` impede dois registros para o mesmo cliente e data.

## RPCs

| Função | Finalidade |
|---|---|
| `n8n_meta_health` | Confirma projeto, schema e disponibilidade |
| `n8n_meta_claim_due_clients` | Seleciona e bloqueia clientes devidos |
| `n8n_meta_record_delivery` | Registra entrega e libera o bloqueio |
| `n8n_meta_record_failure` | Registra falha e libera o bloqueio |
| `n8n_meta_upsert_client` | Cadastra ou atualiza cliente |

As funções foram revogadas de `PUBLIC`, `anon` e `authenticated`. Somente `service_role` pode executá-las.

## Segurança

- RLS ativada nas duas tabelas novas.
- Sem políticas públicas de leitura ou escrita.
- Schema novo sem `USAGE` para `anon` e `authenticated`.
- Service role apenas no ambiente do N8N.
- Tokens do Meta ads e Evolution API apenas em variáveis de ambiente.
- Nenhum segredo versionado no GitHub.
- Project ref fixado no workflow para impedir uso acidental em outro projeto.

## Métricas

Investimento, alcance, impressões, frequência, cliques, CTR, CPC, CPM, resultados personalizados, custo por resultado e ROAS.

## Variação diária

```text
((hoje - ontem) / |ontem|) × 100
```

Quando ontem é zero e hoje possui valor, o relatório informa `novo/sem base`.

## Concorrência

Cada cliente recebe `lock_token` e `locked_until`. Somente a execução proprietária do token pode concluir ou registrar falha. A seleção usa `FOR UPDATE SKIP LOCKED`, permitindo crescimento horizontal sem processar o mesmo cliente simultaneamente.

## Canais

WhatsApp:

```text
POST {EVOLUTION_API_URL}/message/sendText/{instance}
```

E-mail:

```text
POST https://api.resend.com/emails
```

O envio por e-mail utiliza chave de idempotência composta por cliente e data.

## Rate limits e falhas

- leitura do Meta ads com até três tentativas;
- espera de 30 segundos entre tentativas;
- uma única consulta diária por cliente contendo hoje e ontem;
- espera entre clientes;
- respostas HTTP não 2xx tratadas e registradas;
- falha individual não interrompe os demais clientes;
- bloqueios expiram após 30 minutos.

## Escalabilidade

Para volume maior, o mesmo banco pode ser usado com N8N em queue mode e múltiplos workers. O bloqueio transacional do Supabase preserva a exclusividade por cliente.
