-- R2R Marketing Digital
-- Projeto Supabase: CRM R2 MARKETING DIGITAL (iqrnytsgwaiegddfxfjs)
-- Estrutura exclusiva do N8N para relatórios diários do Meta ads.
-- Esta migration NÃO altera tabelas dos schemas public ou gestao_ads.

CREATE SCHEMA IF NOT EXISTS n8n_meta_reports;

COMMENT ON SCHEMA n8n_meta_reports IS
  'Estrutura isolada do N8N para relatórios automatizados do Meta ads.';

REVOKE ALL ON SCHEMA n8n_meta_reports FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA n8n_meta_reports TO service_role;

CREATE TABLE IF NOT EXISTS n8n_meta_reports.reporting_clients (
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
    'spend','reach','impressions','frequency','clicks','ctr','cpc','cpm',
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
  CONSTRAINT reporting_clients_send_days_valid CHECK (
    CARDINALITY(send_days) > 0
    AND send_days <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]
  ),
  CONSTRAINT reporting_clients_destination_not_blank CHECK (BTRIM(destination) <> ''),
  CONSTRAINT reporting_clients_ad_account_not_blank CHECK (BTRIM(ad_account_id) <> ''),
  UNIQUE (ad_account_id, channel, destination)
);

CREATE INDEX IF NOT EXISTS idx_n8n_reporting_clients_due
  ON n8n_meta_reports.reporting_clients (active, send_time, last_sent_report_date);

CREATE INDEX IF NOT EXISTS idx_n8n_reporting_clients_lock
  ON n8n_meta_reports.reporting_clients (locked_until)
  WHERE locked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS n8n_meta_reports.reporting_runs (
  id UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
  client_id UUID NOT NULL
    REFERENCES n8n_meta_reports.reporting_clients(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  execution_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('processing', 'sent', 'no_activity', 'failed')),
  channel TEXT,
  destination TEXT,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  metrics_today JSONB,
  metrics_yesterday JSONB,
  message TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_n8n_reporting_runs_status_date
  ON n8n_meta_reports.reporting_runs (status, report_date DESC);

ALTER TABLE n8n_meta_reports.reporting_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE n8n_meta_reports.reporting_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA n8n_meta_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA n8n_meta_reports TO service_role;

CREATE OR REPLACE FUNCTION public.n8n_meta_claim_due_clients(
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, n8n_meta_reports
AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH due AS (
    SELECT c.id
    FROM n8n_meta_reports.reporting_clients c
    WHERE c.active = TRUE
      AND EXTRACT(ISODOW FROM (NOW() AT TIME ZONE c.timezone))::SMALLINT = ANY(c.send_days)
      AND NOW() >= (
        (((NOW() AT TIME ZONE c.timezone)::DATE + c.send_time) AT TIME ZONE c.timezone)
      )
      AND c.last_sent_report_date IS DISTINCT FROM (NOW() AT TIME ZONE c.timezone)::DATE
      AND (c.locked_until IS NULL OR c.locked_until < NOW())
    ORDER BY c.send_time, c.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  ), claimed AS (
    UPDATE n8n_meta_reports.reporting_clients c
    SET locked_until = NOW() + INTERVAL '30 minutes',
        lock_token = GEN_RANDOM_UUID(),
        updated_at = NOW()
    FROM due
    WHERE c.id = due.id
    RETURNING c.*
  )
  SELECT COALESCE(
    JSONB_AGG(TO_JSONB(claimed) ORDER BY claimed.send_time, claimed.created_at),
    '[]'::JSONB
  )
  INTO v_result
  FROM claimed;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.n8n_meta_record_delivery(
  p_client_id UUID,
  p_lock_token UUID,
  p_report_date DATE,
  p_execution_id TEXT,
  p_status TEXT,
  p_channel TEXT,
  p_destination TEXT,
  p_metrics_today JSONB,
  p_metrics_yesterday JSONB,
  p_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, n8n_meta_reports
AS $$
DECLARE
  v_updated INTEGER;
  v_run_id UUID;
BEGIN
  IF p_status NOT IN ('sent', 'no_activity') THEN
    RAISE EXCEPTION 'Status de entrega inválido: %', p_status;
  END IF;

  UPDATE n8n_meta_reports.reporting_clients
  SET last_sent_report_date = p_report_date,
      last_sent_at = NOW(),
      locked_until = NULL,
      lock_token = NULL,
      updated_at = NOW()
  WHERE id = p_client_id
    AND lock_token = p_lock_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN JSONB_BUILD_OBJECT(
      'ok', FALSE,
      'reason', 'lock_not_owned',
      'client_id', p_client_id
    );
  END IF;

  INSERT INTO n8n_meta_reports.reporting_runs (
    client_id,
    report_date,
    execution_id,
    status,
    channel,
    destination,
    metrics_today,
    metrics_yesterday,
    message,
    sent_at,
    created_at,
    updated_at
  )
  VALUES (
    p_client_id,
    p_report_date,
    p_execution_id,
    p_status,
    p_channel,
    p_destination,
    COALESCE(p_metrics_today, '{}'::JSONB),
    COALESCE(p_metrics_yesterday, '{}'::JSONB),
    p_message,
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (client_id, report_date)
  DO UPDATE SET
    execution_id = EXCLUDED.execution_id,
    status = EXCLUDED.status,
    channel = EXCLUDED.channel,
    destination = EXCLUDED.destination,
    metrics_today = EXCLUDED.metrics_today,
    metrics_yesterday = EXCLUDED.metrics_yesterday,
    message = EXCLUDED.message,
    error_message = NULL,
    sent_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO v_run_id;

  RETURN JSONB_BUILD_OBJECT(
    'ok', TRUE,
    'run_id', v_run_id,
    'client_id', p_client_id,
    'status', p_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.n8n_meta_record_failure(
  p_client_id UUID,
  p_lock_token UUID,
  p_report_date DATE,
  p_execution_id TEXT,
  p_channel TEXT,
  p_destination TEXT,
  p_error_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, n8n_meta_reports
AS $$
DECLARE
  v_updated INTEGER;
  v_run_id UUID;
BEGIN
  UPDATE n8n_meta_reports.reporting_clients
  SET locked_until = NULL,
      lock_token = NULL,
      updated_at = NOW()
  WHERE id = p_client_id
    AND lock_token = p_lock_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN JSONB_BUILD_OBJECT(
      'ok', FALSE,
      'reason', 'lock_not_owned',
      'client_id', p_client_id
    );
  END IF;

  INSERT INTO n8n_meta_reports.reporting_runs (
    client_id,
    report_date,
    execution_id,
    status,
    channel,
    destination,
    error_message,
    created_at,
    updated_at
  )
  VALUES (
    p_client_id,
    p_report_date,
    p_execution_id,
    'failed',
    p_channel,
    p_destination,
    LEFT(COALESCE(p_error_message, 'Erro não informado'), 5000),
    NOW(),
    NOW()
  )
  ON CONFLICT (client_id, report_date)
  DO UPDATE SET
    execution_id = EXCLUDED.execution_id,
    status = 'failed',
    channel = EXCLUDED.channel,
    destination = EXCLUDED.destination,
    error_message = EXCLUDED.error_message,
    attempts = n8n_meta_reports.reporting_runs.attempts + 1,
    updated_at = NOW()
  RETURNING id INTO v_run_id;

  RETURN JSONB_BUILD_OBJECT(
    'ok', TRUE,
    'run_id', v_run_id,
    'client_id', p_client_id,
    'status', 'failed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.n8n_meta_upsert_client(
  p_client_name TEXT,
  p_business_id TEXT,
  p_ad_account_id TEXT,
  p_channel TEXT,
  p_destination TEXT,
  p_send_time TIME DEFAULT '08:00',
  p_timezone TEXT DEFAULT 'America/Sao_Paulo',
  p_currency TEXT DEFAULT 'BRL',
  p_send_days SMALLINT[] DEFAULT ARRAY[1,2,3,4,5,6,7]::SMALLINT[],
  p_conversion_action_types TEXT[] DEFAULT ARRAY['lead','onsite_conversion.messaging_conversation_started_7d']::TEXT[],
  p_attribution_windows TEXT[] DEFAULT ARRAY['7d_click','1d_view']::TEXT[],
  p_channel_config JSONB DEFAULT '{}'::JSONB,
  p_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, n8n_meta_reports
AS $$
DECLARE
  v_client n8n_meta_reports.reporting_clients%ROWTYPE;
  v_ad_account_id TEXT;
BEGIN
  v_ad_account_id := REGEXP_REPLACE(BTRIM(p_ad_account_id), '^act_', '', 'i');

  IF p_channel NOT IN ('whatsapp', 'email') THEN
    RAISE EXCEPTION 'Canal inválido: %', p_channel;
  END IF;

  INSERT INTO n8n_meta_reports.reporting_clients (
    client_name,
    business_id,
    ad_account_id,
    timezone,
    currency,
    channel,
    destination,
    send_time,
    send_days,
    conversion_action_types,
    attribution_windows,
    channel_config,
    active,
    updated_at
  )
  VALUES (
    BTRIM(p_client_name),
    BTRIM(p_business_id),
    v_ad_account_id,
    p_timezone,
    UPPER(p_currency),
    p_channel,
    BTRIM(p_destination),
    p_send_time,
    p_send_days,
    p_conversion_action_types,
    p_attribution_windows,
    COALESCE(p_channel_config, '{}'::JSONB),
    p_active,
    NOW()
  )
  ON CONFLICT (ad_account_id, channel, destination)
  DO UPDATE SET
    client_name = EXCLUDED.client_name,
    business_id = EXCLUDED.business_id,
    timezone = EXCLUDED.timezone,
    currency = EXCLUDED.currency,
    send_time = EXCLUDED.send_time,
    send_days = EXCLUDED.send_days,
    conversion_action_types = EXCLUDED.conversion_action_types,
    attribution_windows = EXCLUDED.attribution_windows,
    channel_config = EXCLUDED.channel_config,
    active = EXCLUDED.active,
    updated_at = NOW()
  RETURNING * INTO v_client;

  RETURN TO_JSONB(v_client);
END;
$$;

CREATE OR REPLACE FUNCTION public.n8n_meta_health()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, n8n_meta_reports
AS $$
  SELECT JSONB_BUILD_OBJECT(
    'ok', TRUE,
    'project_ref', 'iqrnytsgwaiegddfxfjs',
    'schema', 'n8n_meta_reports',
    'active_clients', (
      SELECT COUNT(*) FROM n8n_meta_reports.reporting_clients WHERE active = TRUE
    ),
    'last_24h_runs', (
      SELECT COUNT(*) FROM n8n_meta_reports.reporting_runs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    ),
    'checked_at', NOW()
  );
$$;

REVOKE ALL ON FUNCTION public.n8n_meta_claim_due_clients(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.n8n_meta_record_delivery(UUID, UUID, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.n8n_meta_record_failure(UUID, UUID, DATE, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.n8n_meta_upsert_client(TEXT, TEXT, TEXT, TEXT, TEXT, TIME, TEXT, TEXT, SMALLINT[], TEXT[], TEXT[], JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.n8n_meta_health()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.n8n_meta_claim_due_clients(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_meta_record_delivery(UUID, UUID, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_meta_record_failure(UUID, UUID, DATE, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_meta_upsert_client(TEXT, TEXT, TEXT, TEXT, TEXT, TIME, TEXT, TEXT, SMALLINT[], TEXT[], TEXT[], JSONB, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_meta_health() TO service_role;

NOTIFY pgrst, 'reload schema';
