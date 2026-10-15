BEGIN;

CREATE TABLE public.mcp_api_usage_monthly (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY(user_id,period_start)
);
ALTER TABLE public.mcp_api_usage_monthly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_api_usage_monthly FROM anon, authenticated;
GRANT ALL ON public.mcp_api_usage_monthly TO service_role;

CREATE FUNCTION public.mcp_monthly_window(p_user_id uuid,p_now timestamptz)
RETURNS TABLE(quota integer,period_start timestamptz,period_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN paid.ok THEN 2000 ELSE 100 END,
    CASE WHEN paid.ok THEN a.current_period_start ELSE date_trunc('month',p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' END,
    CASE WHEN paid.ok THEN a.current_period_end ELSE (date_trunc('month',p_now AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC' END
  FROM (SELECT 1) dummy
  LEFT JOIN public.mcp_billing_accounts a ON a.user_id=p_user_id
  CROSS JOIN LATERAL (SELECT coalesce(a.subscription_status='active' AND a.current_period_start<=p_now AND a.current_period_end>p_now,false) AS ok) paid;
$$;
REVOKE ALL ON FUNCTION public.mcp_monthly_window(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_monthly_window(uuid,timestamptz) TO service_role;

-- Additive v2 RPC; existing consume_mcp_api_request clients retain their contract.
CREATE FUNCTION public.consume_mcp_api_request_v2(
  p_key_hash text,p_now timestamptz DEFAULT now(),p_billable boolean DEFAULT true
) RETURNS TABLE (
  allowed boolean,reason text,api_key_id uuid,key_name text,tier text,
  daily_quota integer,daily_count integer,per_minute_quota integer,minute_count integer,
  monthly_quota integer,monthly_count integer,monthly_reset_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k public.mcp_api_keys%ROWTYPE; w record; r record; used integer;
BEGIN
  SELECT * INTO k FROM public.mcp_api_keys WHERE key_hash=p_key_hash;
  IF NOT FOUND OR k.user_id IS NULL OR k.status<>'active' THEN
    RETURN QUERY SELECT legacy.*,NULL::integer,NULL::integer,NULL::timestamptz
      FROM public.consume_mcp_api_request(p_key_hash,p_now) legacy;
    RETURN;
  END IF;
  INSERT INTO public.mcp_billing_accounts(user_id) VALUES(k.user_id) ON CONFLICT DO NOTHING;
  -- One account lock serializes concurrent calls across every key and paid-state changes.
  PERFORM 1 FROM public.mcp_billing_accounts WHERE user_id=k.user_id FOR UPDATE;
  SELECT * INTO w FROM public.mcp_monthly_window(k.user_id,p_now);
  SELECT request_count INTO used FROM public.mcp_api_usage_monthly
    WHERE user_id=k.user_id AND period_start=w.period_start;
  used := coalesce(used,0);
  IF p_billable AND used>=w.quota THEN
    RETURN QUERY SELECT false,'monthly_limit_exceeded',k.id,k.key_name,k.tier,
      NULL::integer,NULL::integer,k.per_minute_quota,NULL::integer,w.quota,used,w.period_end;
    RETURN;
  END IF;
  -- Re-evaluate entitlements on every request, even if an expiry webhook is delayed.
  UPDATE public.mcp_api_keys target SET
    tier=CASE WHEN w.quota=2000 THEN 'starter' ELSE 'free' END,
    daily_quota=NULL,per_minute_quota=CASE WHEN w.quota=2000 THEN 30 ELSE 5 END
  WHERE target.id=k.id AND (target.daily_quota IS NOT NULL OR
    target.tier<>CASE WHEN w.quota=2000 THEN 'starter' ELSE 'free' END OR
    target.per_minute_quota IS DISTINCT FROM CASE WHEN w.quota=2000 THEN 30 ELSE 5 END);
  SELECT * INTO r FROM public.consume_mcp_api_request(p_key_hash,p_now);
  IF r.allowed AND p_billable THEN
    INSERT INTO public.mcp_api_usage_monthly(user_id,period_start,request_count)
      VALUES(k.user_id,w.period_start,1)
    ON CONFLICT(user_id,period_start) DO UPDATE SET request_count=mcp_api_usage_monthly.request_count+1
    RETURNING request_count INTO used;
  END IF;
  RETURN QUERY SELECT r.allowed,r.reason,r.api_key_id,r.key_name,r.tier,r.daily_quota,
    r.daily_count,r.per_minute_quota,r.minute_count,w.quota,used,w.period_end;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_mcp_api_request_v2(text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mcp_api_request_v2(text,timestamptz,boolean) TO service_role;

CREATE FUNCTION public.get_user_monthly_usage()
RETURNS TABLE(monthly_quota integer,monthly_count integer,monthly_reset_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY SELECT w.quota,coalesce(m.request_count,0),w.period_end
    FROM public.mcp_monthly_window(auth.uid(),now()) w
    LEFT JOIN public.mcp_api_usage_monthly m ON m.user_id=auth.uid() AND m.period_start=w.period_start;
END;
$$;
REVOKE ALL ON FUNCTION public.get_user_monthly_usage() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_user_monthly_usage() TO authenticated,service_role;

-- Only self-service users change; internal/browser/ops keys retain their quotas.
UPDATE public.mcp_api_keys SET daily_quota=NULL,per_minute_quota=5 WHERE user_id IS NOT NULL;

COMMIT;
