-- MCP API key and rate-limit control plane
-- Run this migration in Supabase SQL editor (or your migration pipeline).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.mcp_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name text,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'enterprise')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  daily_quota integer DEFAULT 100 CHECK (daily_quota IS NULL OR daily_quota >= 0),
  per_minute_quota integer DEFAULT 20 CHECK (per_minute_quota IS NULL OR per_minute_quota >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_status ON public.mcp_api_keys(status);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_tier ON public.mcp_api_keys(tier);

CREATE TABLE IF NOT EXISTS public.mcp_api_usage_daily (
  api_key_id uuid NOT NULL REFERENCES public.mcp_api_keys(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, usage_date)
);

CREATE TABLE IF NOT EXISTS public.mcp_api_usage_minute (
  api_key_id uuid NOT NULL REFERENCES public.mcp_api_keys(id) ON DELETE CASCADE,
  minute_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, minute_start)
);

CREATE INDEX IF NOT EXISTS idx_mcp_api_usage_minute_window
  ON public.mcp_api_usage_minute(minute_start);

CREATE OR REPLACE FUNCTION public.set_mcp_api_keys_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_mcp_api_keys_updated_at ON public.mcp_api_keys;
CREATE TRIGGER trg_set_mcp_api_keys_updated_at
BEFORE UPDATE ON public.mcp_api_keys
FOR EACH ROW
EXECUTE FUNCTION public.set_mcp_api_keys_updated_at();

CREATE OR REPLACE FUNCTION public.consume_mcp_api_request(
  p_key_hash text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  allowed boolean,
  reason text,
  api_key_id uuid,
  key_name text,
  tier text,
  daily_quota integer,
  daily_count integer,
  per_minute_quota integer,
  minute_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key public.mcp_api_keys%ROWTYPE;
  v_day date;
  v_minute timestamptz;
  v_daily_count integer;
  v_minute_count integer;
BEGIN
  SELECT *
  INTO v_key
  FROM public.mcp_api_keys
  WHERE key_hash = p_key_hash
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'invalid_key',
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      NULL::integer;
    RETURN;
  END IF;

  IF v_key.status <> 'active' THEN
    RETURN QUERY SELECT
      false,
      'revoked_key',
      v_key.id,
      v_key.key_name,
      v_key.tier,
      v_key.daily_quota,
      NULL::integer,
      v_key.per_minute_quota,
      NULL::integer;
    RETURN;
  END IF;

  v_day := (p_now AT TIME ZONE 'UTC')::date;
  v_minute := date_trunc('minute', p_now);

  IF v_key.per_minute_quota IS NULL THEN
    INSERT INTO public.mcp_api_usage_minute (
      api_key_id,
      minute_start,
      request_count,
      updated_at
    )
    VALUES (v_key.id, v_minute, 1, p_now)
    ON CONFLICT ON CONSTRAINT mcp_api_usage_minute_pkey
    DO UPDATE SET
      request_count = public.mcp_api_usage_minute.request_count + 1,
      updated_at = EXCLUDED.updated_at
    RETURNING request_count
    INTO v_minute_count;
  ELSE
    INSERT INTO public.mcp_api_usage_minute (
      api_key_id,
      minute_start,
      request_count,
      updated_at
    )
    VALUES (v_key.id, v_minute, 1, p_now)
    ON CONFLICT ON CONSTRAINT mcp_api_usage_minute_pkey
    DO UPDATE SET
      request_count = public.mcp_api_usage_minute.request_count + 1,
      updated_at = EXCLUDED.updated_at
    WHERE public.mcp_api_usage_minute.request_count < v_key.per_minute_quota
    RETURNING request_count
    INTO v_minute_count;

    IF v_minute_count IS NULL THEN
      SELECT m.request_count
      INTO v_minute_count
      FROM public.mcp_api_usage_minute AS m
      WHERE m.api_key_id = v_key.id
        AND m.minute_start = v_minute;

      RETURN QUERY SELECT
        false,
        'minute_limit_exceeded',
        v_key.id,
        v_key.key_name,
        v_key.tier,
        v_key.daily_quota,
        NULL::integer,
        v_key.per_minute_quota,
        v_minute_count;
      RETURN;
    END IF;
  END IF;

  IF v_key.daily_quota IS NULL THEN
    INSERT INTO public.mcp_api_usage_daily (
      api_key_id,
      usage_date,
      request_count,
      updated_at
    )
    VALUES (v_key.id, v_day, 1, p_now)
    ON CONFLICT ON CONSTRAINT mcp_api_usage_daily_pkey
    DO UPDATE SET
      request_count = public.mcp_api_usage_daily.request_count + 1,
      updated_at = EXCLUDED.updated_at
    RETURNING request_count
    INTO v_daily_count;
  ELSE
    INSERT INTO public.mcp_api_usage_daily (
      api_key_id,
      usage_date,
      request_count,
      updated_at
    )
    VALUES (v_key.id, v_day, 1, p_now)
    ON CONFLICT ON CONSTRAINT mcp_api_usage_daily_pkey
    DO UPDATE SET
      request_count = public.mcp_api_usage_daily.request_count + 1,
      updated_at = EXCLUDED.updated_at
    WHERE public.mcp_api_usage_daily.request_count < v_key.daily_quota
    RETURNING request_count
    INTO v_daily_count;

    IF v_daily_count IS NULL THEN
      SELECT d.request_count
      INTO v_daily_count
      FROM public.mcp_api_usage_daily AS d
      WHERE d.api_key_id = v_key.id
        AND d.usage_date = v_day;

      RETURN QUERY SELECT
        false,
        'daily_limit_exceeded',
        v_key.id,
        v_key.key_name,
        v_key.tier,
        v_key.daily_quota,
        v_daily_count,
        v_key.per_minute_quota,
        v_minute_count;
      RETURN;
    END IF;
  END IF;

  UPDATE public.mcp_api_keys
  SET last_used_at = p_now
  WHERE id = v_key.id;

  RETURN QUERY SELECT
    true,
    'ok',
    v_key.id,
    v_key.key_name,
    v_key.tier,
    v_key.daily_quota,
    v_daily_count,
    v_key.per_minute_quota,
    v_minute_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_mcp_api_request(text, timestamptz) TO service_role;
