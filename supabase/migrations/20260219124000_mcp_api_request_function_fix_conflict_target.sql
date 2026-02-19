-- Fix consume_mcp_api_request() ambiguity with output parameter names by
-- using explicit PK constraint targets in ON CONFLICT clauses.
-- This is safe to run repeatedly.

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
