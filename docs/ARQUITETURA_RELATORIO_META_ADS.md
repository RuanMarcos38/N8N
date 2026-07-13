# Arquitetura profissional — relatório diário do Meta ads com N8N

## Objetivo

Processar múltiplos clientes, cada um com suas próprias BMs e contas de anúncios, consultar dados do Meta ads, comparar o dia atual com o dia anterior, enviar o relatório no horário configurado e registrar toda execução.

> Observação: os dados de Insights são próximos do tempo real, mas podem sofrer atraso e atualização posterior, principalmente nas conversões atribuídas.

## Arquitetura recomendada

```text
BMs dos clientes
   │
   ├─ compartilham as contas de anúncios com a BM da agência
   │
   ▼
Usuário do sistema da BM da agência
   │  token de leitura armazenado como segredo
   ▼
N8N - Despachante a cada 5 minutos
   │
   ├─ consulta e bloqueia clientes devidos no PostgreSQL
   ├─ Loop Over Items, lote 1
   ├─ consulta Meta ads: hoje
   ├─ espera 2 segundos
   ├─ consulta Meta ads: ontem
   ├─ normaliza métricas e calcula variações
   ├─ envia por WhatsApp ou e-mail
   └─ grava log e libera o bloqueio
          │
          └─ em falha, Error Workflow envia alerta interno
```

## Estratégia de acesso às BMs

### Produção recomendada

1. Use uma BM da agência.
2. Cada cliente compartilha a conta de anúncios com a BM da agência como parceiro.
3. Crie um aplicativo da agência e habilite o produto Marketing API.
4. Crie um usuário do sistema na BM da agência.
5. Atribua somente os ativos necessários a esse usuário.
6. Para leitura, prefira a menor permissão possível. Use `ads_read` quando o aplicativo e o cenário permitirem. Use permissões adicionais apenas quando forem realmente necessárias para listar ou administrar ativos.
7. Gere o token do usuário do sistema.
8. Armazene o token em credencial/secret manager do N8N. Nunca armazene o token na tabela de clientes.

### Alternativa

Quando o cliente não puder compartilhar o ativo com a BM da agência, mantenha uma credencial separada por cliente no backend `RuanMarcos38/Meta-ads`, que já possui estrutura para criptografia de tokens. O N8N deve chamar o backend e nunca receber tokens em texto puro.

## Variáveis e credenciais

Configure no ambiente do N8N ou substitua por credenciais do próprio N8N:

```env
META_GRAPH_VERSION=vXX.X
META_SYSTEM_USER_TOKEN=token_do_usuario_do_sistema
EVOLUTION_API_URL=https://sua-evolution.example.com
EVOLUTION_API_KEY=chave_da_evolution
EVOLUTION_INSTANCE=R2R
REPORT_FROM_EMAIL=relatorios@seudominio.com.br
INTERNAL_ALERT_WEBHOOK_URL=https://seu-webhook-interno.example.com/alerts
GENERIC_TIMEZONE=America/Sao_Paulo
```

Não fixe a versão da Graph API no código. Atualize `META_GRAPH_VERSION` depois de validar cada nova versão.

## Requisição HTTP usada

```http
GET https://graph.facebook.com/{META_GRAPH_VERSION}/act_{AD_ACCOUNT_ID}/insights
Authorization: Bearer {META_SYSTEM_USER_TOKEN}
```

Parâmetros:

```json
{
  "level": "account",
  "fields": "account_id,account_name,account_currency,date_start,date_stop,spend,reach,impressions,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,purchase_roas",
  "time_range": "{\"since\":\"2026-07-12\",\"until\":\"2026-07-12\"}",
  "action_attribution_windows": "[\"7d_click\",\"1d_view\"]",
  "use_account_attribution_setting": "true",
  "limit": "10"
}
```

Use `level=account` para os totais, evitando somar `reach` de campanhas. Para ranking ou detalhamento, crie uma segunda chamada com `level=campaign` e trate paginação.

## Métricas

| Métrica | Campo/origem |
|---|---|
| Investimento | `spend` |
| Alcance | `reach` |
| Impressões | `impressions` |
| Cliques | `clicks` |
| CTR | `ctr` |
| CPC | `cpc` |
| CPM | `cpm` |
| Conversões | soma de `actions` conforme `conversion_action_types` |
| Custo por resultado | `spend / conversions` ou `cost_per_action_type` |
| ROAS | `purchase_roas` ou valor de compra dividido por `spend` |

A definição de “resultado” deve ser configurada por cliente. Exemplo: `lead`, `purchase` ou `onsite_conversion.messaging_conversation_started_7d`.

## Cálculo da variação

```text
variação % = ((valor_hoje - valor_ontem) / |valor_ontem|) × 100
```

Regras:

- ontem = 0 e hoje = 0: `0,0%`;
- ontem = 0 e hoje > 0: `novo/sem base`;
- para CPC, CPM e custo por resultado, aumento nem sempre é positivo;
- para ROAS e resultados, aumento normalmente é desejável, mas depende da meta do cliente.

## Rate limits e resiliência

- Processar um cliente por vez.
- Esperar 2 segundos entre chamadas e entre clientes.
- Usar retry com até 3 tentativas.
- Backoff sugerido: 30, 90 e 300 segundos, adicionando jitter.
- Respeitar `Retry-After` quando retornado.
- Monitorar cabeçalhos de uso da Graph API.
- Reduzir a concorrência quando o consumo atingir 70% a 80%.
- Para relatórios grandes em nível de campanha/anúncio, usar Insights assíncrono.
- Implementar paginação quando houver `paging.next`.

## Idempotência

A consulta PostgreSQL bloqueia cada cliente com `locked_until` e `lock_token`. O relatório do mesmo cliente e data possui chave única em `reporting_runs`. Isso impede envios duplicados em execuções concorrentes.

## Passo a passo no N8N

1. Execute `database/001_reporting_schema.sql` no PostgreSQL/Supabase do projeto.
2. Importe `workflows/meta-ads-relatorio-diario.json`.
3. Configure a credencial PostgreSQL nos nós:
   - Buscar e bloquear clientes devidos;
   - Registrar envio WhatsApp;
   - Registrar envio E-mail;
   - Registrar falha do cliente.
4. Configure a credencial SMTP no nó `Enviar E-mail`.
5. Configure os segredos/variáveis.
6. Importe `workflows/meta-ads-error-handler.json`.
7. No workflow principal, abra Settings e selecione o error workflow importado.
8. Ajuste a timezone para `America/Sao_Paulo`.
9. Teste primeiro com um cliente de homologação.
10. Publique os dois workflows.

## Mensagem sem atividade

Quando `spend`, `impressions` e `reach` forem zero, o cliente recebe uma mensagem informando ausência de veiculação, sem apresentar números enganadores.

## Segurança

- Nunca versionar tokens, chaves, `.env` ou credenciais.
- Usar somente o acesso necessário.
- Rotacionar o token e as chaves periodicamente.
- Ativar `N8N_ENCRYPTION_KEY`.
- Restringir acesso ao editor do N8N.
- Usar HTTPS.
- Redigir dados sensíveis nos logs.
- Separar desenvolvimento, homologação e produção.
- Manter o schema `gestao_ads` isolado.
- Validar o destino antes do envio.
- Registrar auditoria de alteração dos clientes.

## Monitoramento

Monitore diariamente:

- clientes processados;
- clientes com falha;
- tempo médio por cliente;
- erros 401, 403, 429 e 5xx;
- token próximo da expiração;
- relatórios não enviados;
- aumento anormal de custo por resultado;
- campanhas sem entrega;
- diferença entre gasto atual e orçamento diário.

## Melhorias opcionais

- Dashboard por cliente;
- PDF e gráficos;
- ranking de campanhas;
- alertas de aumento de custo;
- alertas de campanha parada;
- relatório semanal e mensal;
- aprovação do relatório por gestor;
- integração com o backend `RuanMarcos38/Meta-ads`;
- fila Redis para alto volume;
- observabilidade com Sentry, Grafana e OpenTelemetry.