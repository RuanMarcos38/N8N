-- R2R Marketing Digital
-- Estrutura isolada para relatórios diários do Meta ads no schema gestao_ads.
-- Não armazene access tokens nesta tabela.

CREATE SCHEMA IF NOT EXISTS gestao_ads;

CREATE TABLE IF NOT EXISTS gestao_ads.reporting_clients (
  id UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
  client_name TEXT NOT NULL,
  business_id TEXT NOT NULL,
  ad_account_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  destination TEXT NOT NULL,
  send_time TIME NOT NULL DEFAULT '08:00',
  send_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::SMALLINT[],
  conversion_action_types TEXT[] NOT NULL DEFAULT ARRAY[
    'lead',
    'onsite_conversion.messaging_conversation_started_7d'
  ]::TEXT[],
  attribution_windows TEXT[] NOT NULL DEFAULT ARRAY['7d_click','1d_view']::TEXT[],
  metrics TEXT[] NOT NULL DEFAULT ARRAY[
    'spend','reach','impressions','clicks','ctr','cpc','cpm',
    'conversions','cost_per_result','roas'
  ]::TEXT[],
  channel_config JSONB NOT NULL DEFAULT '{}'::JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_report_date DATE,
  last_sent_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  lock_token UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ad_account_id, channel, destination)
);

CREATE INDEX IF NOT EXISTS idx_reporting_clients_due
  ON gestao_ads.reporting_clients (active, send_time, last_sent_report_date);

CREATE INDEX IF NOT EXISTS idx_reporting_clients_lock
  ON gestao_ads.reporting_clients (locked_until)
  WHERE locked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS gestao_ads.reporting_runs (
  id UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
  client_id UUID NOT NULL REFERENCES gestao_ads.reporting_clients(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  execution_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'no_activity', 'failed')),
  channel TEXT,
  destination TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  metrics_today JSONB,
  metrics_yesterday JSONB,
  message TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_reporting_runs_status_date
  ON gestao_ads.reporting_runs (status, report_date DESC);

-- Exemplo de cliente. Substitua pelos dados reais.
INSERT INTO gestao_ads.reporting_clients (
  client_name,
  business_id,
  ad_account_id,
  timezone,
  currency,
  channel,
  destination,
  send_time,
  conversion_action_types,
  channel_config
)
VALUES (
  'Cliente Exemplo',
  '123456789012345',
  '987654321098765',
  'America/Sao_Paulo',
  'BRL',
  'whatsapp',
  '5547999999999',
  '08:00',
  ARRAY['lead','onsite_conversion.messaging_conversation_started_7d'],
  '{"instance":"R2R"}'::JSONB
)
ON CONFLICT DO NOTHING;