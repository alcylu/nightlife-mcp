BEGIN;
CREATE TABLE public.mcp_usage_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  monthly_requests integer NOT NULL CHECK(monthly_requests BETWEEN 1 AND 100000000),
  website text NOT NULL DEFAULT '',
  use_case text NOT NULL CHECK(length(use_case) BETWEEN 10 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_usage_requests_user_created ON public.mcp_usage_requests(user_id,created_at);
CREATE TABLE public.mcp_usage_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.mcp_usage_requests(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK(channel IN ('email','line')),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,channel)
);
CREATE INDEX mcp_usage_notifications_pending ON public.mcp_usage_notifications(next_attempt_at) WHERE state='pending';
ALTER TABLE public.mcp_usage_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_usage_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_usage_requests,public.mcp_usage_notifications FROM anon,authenticated;
GRANT ALL ON public.mcp_usage_requests,public.mcp_usage_notifications TO service_role;

CREATE FUNCTION public.submit_mcp_usage_request(p_id uuid,p_user_id uuid,p_email text,p_monthly_requests integer,p_website text,p_use_case text,p_email_payload jsonb,p_line_payload jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old public.mcp_usage_requests%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,31));
  SELECT * INTO old FROM mcp_usage_requests WHERE id=p_id;
  IF FOUND THEN
    IF old.user_id<>p_user_id OR old.email<>p_email OR old.monthly_requests<>p_monthly_requests OR old.website<>p_website OR old.use_case<>p_use_case THEN RETURN 'conflict'; END IF;
    RETURN 'received';
  END IF;
  IF (SELECT count(*) FROM mcp_usage_requests WHERE user_id=p_user_id AND created_at>now()-interval '1 day')>=3 THEN RETURN 'rate_limited'; END IF;
  INSERT INTO mcp_usage_requests(id,user_id,email,monthly_requests,website,use_case) VALUES(p_id,p_user_id,p_email,p_monthly_requests,p_website,p_use_case);
  INSERT INTO mcp_usage_notifications(request_id,channel,payload) VALUES(p_id,'email',p_email_payload),(p_id,'line',p_line_payload);
  RETURN 'received';
END;
$$;
CREATE FUNCTION public.claim_mcp_usage_notifications()
RETURNS SETOF public.mcp_usage_notifications LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE mcp_usage_notifications n SET attempts=n.attempts+1,next_attempt_at=now()+interval '5 minutes'
  WHERE n.id IN (SELECT id FROM mcp_usage_notifications WHERE state='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 10)
  RETURNING n.*;
$$;
REVOKE ALL ON FUNCTION public.submit_mcp_usage_request(uuid,uuid,text,integer,text,text,jsonb,jsonb),public.claim_mcp_usage_notifications() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_mcp_usage_request(uuid,uuid,text,integer,text,text,jsonb,jsonb),public.claim_mcp_usage_notifications() TO service_role;
COMMIT;
