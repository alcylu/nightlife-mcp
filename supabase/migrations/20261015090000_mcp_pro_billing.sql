BEGIN;

CREATE TABLE public.mcp_billing_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  subscription_created_at bigint NOT NULL DEFAULT 0,
  subscription_status text NOT NULL DEFAULT 'none',
  current_period_end timestamptz,
  current_period_start timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  checkout_attempt uuid NOT NULL DEFAULT gen_random_uuid(),
  checkout_session_id text UNIQUE,
  synced_at timestamptz NOT NULL DEFAULT '-infinity',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_billing_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_billing_accounts FROM anon, authenticated;
GRANT ALL ON public.mcp_billing_accounts TO service_role;

-- Distinct Checkout Sessions are the funnel denominator. Payment is confirmed
-- server-side by Stripe, never by a browser redirect or client-supplied flag.
CREATE TABLE public.mcp_checkout_funnel (
  checkout_session_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'direct',
  started_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  amount_total integer,
  currency text
);
ALTER TABLE public.mcp_checkout_funnel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_checkout_funnel FROM anon, authenticated;
GRANT ALL ON public.mcp_checkout_funnel TO service_role;

-- Existing authenticated UPDATE permission allowed callers to edit their own
-- tier/quota. Revocation continues through revoke_user_api_key(), unchanged.
REVOKE INSERT, UPDATE, DELETE ON public.mcp_api_keys FROM anon, authenticated;
DROP POLICY IF EXISTS users_update_own_keys ON public.mcp_api_keys;

CREATE FUNCTION public.sync_mcp_subscription(
  p_user_id uuid, p_customer_id text, p_subscription_id text,
  p_status text, p_period_end timestamptz, p_cancel_at_period_end boolean,
  p_synced_at timestamptz, p_subscription_created_at bigint, p_period_start timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pro boolean;
BEGIN
  -- Serialize account entitlement changes and ignore older reconciliation reads.
  PERFORM 1 FROM public.mcp_billing_accounts WHERE user_id = p_user_id FOR UPDATE;
  UPDATE public.mcp_billing_accounts SET
    stripe_subscription_id = p_subscription_id, subscription_status = p_status,
    subscription_created_at = p_subscription_created_at,
    current_period_end = p_period_end, cancel_at_period_end = p_cancel_at_period_end,
    current_period_start = p_period_start,
    synced_at = p_synced_at
  WHERE user_id = p_user_id AND stripe_customer_id = p_customer_id
    AND synced_at <= p_synced_at
    AND subscription_created_at <= p_subscription_created_at;
  IF NOT FOUND THEN RETURN; END IF;
  v_pro := p_status = 'active' AND p_period_end > now();
  UPDATE public.mcp_api_keys SET
    tier = CASE WHEN v_pro THEN 'starter' ELSE 'free' END,
    daily_quota = NULL,
    per_minute_quota = CASE WHEN v_pro THEN 30 ELSE 5 END
  WHERE user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_mcp_subscription(uuid,text,text,text,timestamptz,boolean,timestamptz,bigint,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_mcp_subscription(uuid,text,text,text,timestamptz,boolean,timestamptz,bigint,timestamptz) TO service_role;

-- Keep the existing key-creation RPC contract; new keys inherit paid access.
CREATE FUNCTION public.apply_mcp_subscription_to_new_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    NEW.tier := 'free'; NEW.daily_quota := NULL; NEW.per_minute_quota := 5;
  END IF;
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.mcp_billing_accounts WHERE user_id = NEW.user_id
      AND subscription_status = 'active' AND current_period_end > now()
  ) THEN
    NEW.tier := 'starter'; NEW.daily_quota := NULL; NEW.per_minute_quota := 30;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_mcp_subscription_to_new_key() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER apply_mcp_subscription_to_new_key BEFORE INSERT ON public.mcp_api_keys
FOR EACH ROW EXECUTE FUNCTION public.apply_mcp_subscription_to_new_key();

COMMIT;
