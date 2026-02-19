-- Self-service API key management for authenticated users.
-- Adds user_id to mcp_api_keys, enables RLS, creates RPCs for key CRUD + usage.

--------------------------------------------------------------------------------
-- 1. Add user_id column
--------------------------------------------------------------------------------

ALTER TABLE public.mcp_api_keys
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_user_id
  ON public.mcp_api_keys(user_id);

--------------------------------------------------------------------------------
-- 2. Enable RLS on all three tables
--------------------------------------------------------------------------------

ALTER TABLE public.mcp_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_api_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_api_usage_minute ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 3. RLS policies for mcp_api_keys
--    (SECURITY DEFINER functions like consume_mcp_api_request bypass RLS)
--------------------------------------------------------------------------------

CREATE POLICY users_select_own_keys ON public.mcp_api_keys
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY users_update_own_keys ON public.mcp_api_keys
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- service_role bypasses RLS by default in Supabase, but be explicit
CREATE POLICY service_role_all_keys ON public.mcp_api_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

--------------------------------------------------------------------------------
-- 4. RLS policies for usage tables (users see their own usage via join)
--------------------------------------------------------------------------------

CREATE POLICY users_select_own_daily_usage ON public.mcp_api_usage_daily
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mcp_api_keys k
      WHERE k.id = api_key_id AND k.user_id = auth.uid()
    )
  );

CREATE POLICY service_role_all_daily_usage ON public.mcp_api_usage_daily
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY users_select_own_minute_usage ON public.mcp_api_usage_minute
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mcp_api_keys k
      WHERE k.id = api_key_id AND k.user_id = auth.uid()
    )
  );

CREATE POLICY service_role_all_minute_usage ON public.mcp_api_usage_minute
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

--------------------------------------------------------------------------------
-- 5. RPC: create_user_api_key
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_user_api_key(p_key_name text)
RETURNS TABLE (
  key_id uuid,
  raw_key text,
  key_name text,
  key_prefix text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_active_count integer;
  v_raw_key text;
  v_key_hash text;
  v_key_prefix text;
  v_key_id uuid;
  v_key_name text;
BEGIN
  -- Get the authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Enforce max 3 active keys per user
  SELECT count(*)
  INTO v_active_count
  FROM public.mcp_api_keys
  WHERE user_id = v_user_id AND status = 'active';

  IF v_active_count >= 3 THEN
    RAISE EXCEPTION 'Maximum of 3 active API keys allowed. Revoke an existing key first.';
  END IF;

  -- Generate key: nlt_ + 24 random bytes in base64url encoding
  -- base64url: replace + with -, / with _, remove = padding
  v_raw_key := 'nlt_' || translate(
    replace(encode(gen_random_bytes(24), 'base64'), '=', ''),
    '+/',
    '-_'
  );

  -- Hash must match Node.js: createHash('sha256').update(key).digest('hex')
  v_key_hash := encode(digest(v_raw_key, 'sha256'), 'hex');

  -- First 8 chars as prefix
  v_key_prefix := left(v_raw_key, 8);

  -- Default name if not provided
  v_key_name := COALESCE(NULLIF(trim(p_key_name), ''), 'My API Key');

  -- Insert the key
  INSERT INTO public.mcp_api_keys (
    key_name,
    key_prefix,
    key_hash,
    tier,
    status,
    daily_quota,
    per_minute_quota,
    user_id
  )
  VALUES (
    v_key_name,
    v_key_prefix,
    v_key_hash,
    'free',
    'active',
    100,
    20,
    v_user_id
  )
  RETURNING id INTO v_key_id;

  -- Return the raw key (shown once) plus metadata
  RETURN QUERY SELECT v_key_id, v_raw_key, v_key_name, v_key_prefix;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_user_api_key(text) TO authenticated;

--------------------------------------------------------------------------------
-- 6. RPC: revoke_user_api_key
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_user_api_key(p_key_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_updated boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.mcp_api_keys
  SET status = 'revoked'
  WHERE id = p_key_id
    AND user_id = v_user_id
    AND status = 'active';

  v_updated := FOUND;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_user_api_key(uuid) TO authenticated;

--------------------------------------------------------------------------------
-- 7. RPC: get_user_usage_summary
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_usage_summary()
RETURNS TABLE (
  key_id uuid,
  key_name text,
  key_prefix text,
  status text,
  tier text,
  daily_quota integer,
  per_minute_quota integer,
  created_at timestamptz,
  today_usage bigint,
  last_30_days_usage bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_today date;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_today := (now() AT TIME ZONE 'UTC')::date;

  RETURN QUERY
  SELECT
    k.id AS key_id,
    k.key_name,
    k.key_prefix,
    k.status,
    k.tier,
    k.daily_quota,
    k.per_minute_quota,
    k.created_at,
    COALESCE(today.request_count, 0)::bigint AS today_usage,
    COALESCE(month.total, 0)::bigint AS last_30_days_usage
  FROM public.mcp_api_keys k
  LEFT JOIN public.mcp_api_usage_daily today
    ON today.api_key_id = k.id AND today.usage_date = v_today
  LEFT JOIN LATERAL (
    SELECT sum(d.request_count)::bigint AS total
    FROM public.mcp_api_usage_daily d
    WHERE d.api_key_id = k.id
      AND d.usage_date >= v_today - 29
  ) month ON true
  WHERE k.user_id = v_user_id
  ORDER BY k.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_usage_summary() TO authenticated;
