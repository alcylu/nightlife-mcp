BEGIN;
ALTER TABLE public.mcp_billing_accounts ADD COLUMN billing_plan text NOT NULL DEFAULT 'none' CHECK(billing_plan IN ('none','starter','pro'));
ALTER TABLE public.mcp_billing_accounts ADD COLUMN checkout_lock_id uuid,ADD COLUMN checkout_locked_until timestamptz;
UPDATE public.mcp_billing_accounts SET billing_plan='pro' WHERE stripe_subscription_id IS NOT NULL;
ALTER TABLE public.mcp_api_keys ADD COLUMN internal_access boolean NOT NULL DEFAULT false;
-- Explicitly inventoried private first-party runtimes and ops. Never infer
-- internal access merely from NULL ownership: deleted users leave orphan keys.
UPDATE public.mcp_api_keys SET internal_access=true WHERE tier='ops' OR id IN ('095314e3-94ca-40d6-9290-d4a005a7d6a5','2e297de9-dc5d-4beb-ad3d-532c5cf14461');
UPDATE public.mcp_api_keys SET status='revoked' WHERE id='4fbac1c0-d51a-4a60-92e5-2b79cca32897';

CREATE OR REPLACE FUNCTION public.mcp_monthly_window(p_user_id uuid,p_now timestamptz)
RETURNS TABLE(quota integer,period_start timestamptz,period_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN paid.ok THEN CASE a.billing_plan WHEN 'starter' THEN 500 ELSE 5000 END ELSE 0 END,
    CASE WHEN paid.ok THEN a.current_period_start ELSE date_trunc('month',p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' END,
    CASE WHEN paid.ok THEN a.current_period_end ELSE (date_trunc('month',p_now AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC' END
  FROM (SELECT 1) dummy LEFT JOIN mcp_billing_accounts a ON a.user_id=p_user_id
  CROSS JOIN LATERAL (SELECT coalesce(a.billing_plan IN ('starter','pro') AND a.subscription_status='active' AND a.current_period_start<=p_now AND a.current_period_end>p_now,false) AS ok) paid;
$$;

CREATE OR REPLACE FUNCTION public.consume_mcp_api_request_v2(p_key_hash text,p_now timestamptz DEFAULT now(),p_billable boolean DEFAULT true)
RETURNS TABLE(allowed boolean,reason text,api_key_id uuid,key_name text,tier text,daily_quota integer,daily_count integer,per_minute_quota integer,minute_count integer,monthly_quota integer,monthly_count integer,monthly_reset_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k mcp_api_keys%ROWTYPE; w record; r record; used integer;
BEGIN
  SELECT * INTO k FROM mcp_api_keys WHERE key_hash=p_key_hash;
  IF NOT FOUND OR k.status<>'active' OR k.internal_access THEN
    RETURN QUERY SELECT legacy.*,NULL::integer,NULL::integer,NULL::timestamptz FROM consume_mcp_api_request(p_key_hash,p_now) legacy;
    RETURN;
  END IF;
  IF k.user_id IS NULL THEN
    RETURN QUERY SELECT false,'subscription_required',k.id,k.key_name,k.tier,NULL::integer,NULL::integer,NULL::integer,NULL::integer,0,0,NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO mcp_billing_accounts(user_id) VALUES(k.user_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM mcp_billing_accounts WHERE user_id=k.user_id FOR UPDATE;
  SELECT * INTO w FROM mcp_monthly_window(k.user_id,p_now);
  SELECT request_count INTO used FROM mcp_api_usage_monthly WHERE user_id=k.user_id AND period_start=w.period_start;
  used:=coalesce(used,0);
  IF w.quota=0 OR (p_billable AND used>=w.quota) THEN
    RETURN QUERY SELECT false,CASE WHEN w.quota=0 THEN 'subscription_required' ELSE 'monthly_limit_exceeded' END,k.id,k.key_name,k.tier,NULL::integer,NULL::integer,k.per_minute_quota,NULL::integer,w.quota,used,w.period_end;
    RETURN;
  END IF;
  -- Keep the historic key tier enum unchanged. Paid plan lives on the account,
  -- never in client-editable labels. Both paid plans use the existing key tier.
  UPDATE mcp_api_keys SET tier='starter',daily_quota=NULL,per_minute_quota=CASE WHEN w.quota=5000 THEN 30 ELSE 10 END WHERE id=k.id;
  SELECT * INTO r FROM consume_mcp_api_request(p_key_hash,p_now);
  IF r.allowed AND p_billable THEN
    INSERT INTO mcp_api_usage_monthly(user_id,period_start,request_count) VALUES(k.user_id,w.period_start,1)
    ON CONFLICT(user_id,period_start) DO UPDATE SET request_count=mcp_api_usage_monthly.request_count+1 RETURNING request_count INTO used;
  END IF;
  RETURN QUERY SELECT r.allowed,r.reason,r.api_key_id,r.key_name,r.tier,r.daily_quota,r.daily_count,r.per_minute_quota,r.minute_count,w.quota,used,w.period_end;
END;
$$;

CREATE FUNCTION public.sync_mcp_subscription_v2(p_user_id uuid,p_customer_id text,p_subscription_id text,p_status text,p_period_end timestamptz,p_cancel_at_period_end boolean,p_synced_at timestamptz,p_subscription_created_at bigint,p_period_start timestamptz,p_plan text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_plan NOT IN ('none','starter','pro') THEN RAISE EXCEPTION 'Invalid billing plan'; END IF;
  PERFORM 1 FROM mcp_billing_accounts WHERE user_id=p_user_id FOR UPDATE;
  UPDATE mcp_billing_accounts SET stripe_subscription_id=p_subscription_id,subscription_status=p_status,subscription_created_at=p_subscription_created_at,current_period_end=p_period_end,current_period_start=p_period_start,cancel_at_period_end=p_cancel_at_period_end,synced_at=p_synced_at,billing_plan=p_plan
    WHERE user_id=p_user_id AND stripe_customer_id=p_customer_id AND synced_at<=p_synced_at AND subscription_created_at<=p_subscription_created_at;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE mcp_api_keys SET tier=CASE WHEN p_status='active' AND p_period_start<=now() AND p_period_end>now() AND p_plan<>'none' THEN 'starter' ELSE 'free' END,daily_quota=NULL,per_minute_quota=CASE WHEN p_plan='pro' THEN 30 ELSE 10 END WHERE user_id=p_user_id AND NOT internal_access;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_mcp_subscription_v2(uuid,text,text,text,timestamptz,boolean,timestamptz,bigint,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_mcp_subscription_v2(uuid,text,text,text,timestamptz,boolean,timestamptz,bigint,timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_mcp_subscription_to_new_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q integer;
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT NEW.internal_access THEN
    SELECT quota INTO q FROM mcp_monthly_window(NEW.user_id,now());
    IF q=0 THEN RAISE EXCEPTION 'An active Starter or Pro subscription is required to create API keys'; END IF;
    NEW.tier:='starter'; NEW.daily_quota:=NULL; NEW.per_minute_quota:=CASE WHEN q=5000 THEN 30 ELSE 10 END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.claim_mcp_checkout(p_user_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE token uuid:=gen_random_uuid();
BEGIN
  INSERT INTO mcp_billing_accounts(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  UPDATE mcp_billing_accounts SET checkout_lock_id=token,checkout_locked_until=now()+interval '5 minutes' WHERE user_id=p_user_id AND (checkout_locked_until IS NULL OR checkout_locked_until<now());
  IF NOT FOUND THEN RETURN NULL; END IF; RETURN token;
END;
$$;
CREATE FUNCTION public.release_mcp_checkout(p_user_id uuid,p_lock_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE mcp_billing_accounts SET checkout_lock_id=NULL,checkout_locked_until=NULL WHERE user_id=p_user_id AND checkout_lock_id=p_lock_id;
$$;
REVOKE ALL ON FUNCTION public.claim_mcp_checkout(uuid),public.release_mcp_checkout(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mcp_checkout(uuid),public.release_mcp_checkout(uuid,uuid) TO service_role;
COMMIT;
