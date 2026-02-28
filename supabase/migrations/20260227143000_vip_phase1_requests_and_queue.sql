-- VIP booking phase 1: customer request/status flow plus agent work queue.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.mcp_api_keys
  DROP CONSTRAINT IF EXISTS mcp_api_keys_tier_check;
ALTER TABLE public.mcp_api_keys
  ADD CONSTRAINT mcp_api_keys_tier_check
  CHECK (tier IN ('free', 'starter', 'enterprise', 'ops'));
CREATE TABLE IF NOT EXISTS public.vip_booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  venue_id uuid NOT NULL REFERENCES public.venues(id),
  booking_date date NOT NULL,
  arrival_time time NOT NULL,
  party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 30),
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL,
  special_requests text,
  status text NOT NULL DEFAULT 'submitted' CHECK (
    status IN ('submitted', 'in_review', 'confirmed', 'rejected', 'cancelled')
  ),
  status_message text NOT NULL DEFAULT 'Request received. Concierge is reviewing your booking.',
  agent_internal_note text
);
CREATE INDEX IF NOT EXISTS idx_vip_booking_requests_created_at
  ON public.vip_booking_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vip_booking_requests_status
  ON public.vip_booking_requests(status);
CREATE INDEX IF NOT EXISTS idx_vip_booking_requests_booking_date
  ON public.vip_booking_requests(booking_date);
CREATE INDEX IF NOT EXISTS idx_vip_booking_requests_venue_id
  ON public.vip_booking_requests(venue_id);
CREATE INDEX IF NOT EXISTS idx_vip_booking_requests_customer_email
  ON public.vip_booking_requests(customer_email);
CREATE INDEX IF NOT EXISTS idx_vip_booking_requests_customer_phone
  ON public.vip_booking_requests(customer_phone);
CREATE TABLE IF NOT EXISTS public.vip_booking_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_request_id uuid NOT NULL REFERENCES public.vip_booking_requests(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL CHECK (
    to_status IN ('submitted', 'in_review', 'confirmed', 'rejected', 'cancelled')
  ),
  actor_type text NOT NULL CHECK (
    actor_type IN ('customer', 'agent', 'ops', 'system')
  ),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vip_booking_status_events_booking_request_id
  ON public.vip_booking_status_events(booking_request_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.vip_agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_request_id uuid NOT NULL REFERENCES public.vip_booking_requests(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('new_vip_request')),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'claimed', 'done', 'failed')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_by text,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vip_agent_tasks_claimable
  ON public.vip_agent_tasks(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_vip_agent_tasks_booking_request_id
  ON public.vip_agent_tasks(booking_request_id);
CREATE OR REPLACE FUNCTION public.set_vip_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_set_vip_booking_requests_updated_at ON public.vip_booking_requests;
CREATE TRIGGER trg_set_vip_booking_requests_updated_at
BEFORE UPDATE ON public.vip_booking_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_vip_updated_at();
DROP TRIGGER IF EXISTS trg_set_vip_agent_tasks_updated_at ON public.vip_agent_tasks;
CREATE TRIGGER trg_set_vip_agent_tasks_updated_at
BEFORE UPDATE ON public.vip_agent_tasks
FOR EACH ROW
EXECUTE FUNCTION public.set_vip_updated_at();
CREATE OR REPLACE FUNCTION public.claim_next_vip_agent_task(p_agent_id text)
RETURNS TABLE (
  task_id uuid,
  booking_request_id uuid,
  attempt_count integer,
  booking_date date,
  arrival_time time,
  party_size integer,
  customer_name text,
  customer_email text,
  customer_phone text,
  special_requests text,
  current_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_agent_id text := left(COALESCE(NULLIF(trim(p_agent_id), ''), 'agent'), 128);
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT t.id
    FROM public.vip_agent_tasks AS t
    WHERE t.status = 'pending'
      AND t.next_attempt_at <= v_now
      AND t.task_type = 'new_vip_request'
    ORDER BY t.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.vip_agent_tasks AS t
    SET
      status = 'claimed',
      attempt_count = t.attempt_count + 1,
      claimed_by = v_agent_id,
      claimed_at = v_now,
      updated_at = v_now
    FROM candidate AS c
    WHERE t.id = c.id
    RETURNING t.id, t.booking_request_id, t.attempt_count
  )
  SELECT
    c.id,
    c.booking_request_id,
    c.attempt_count,
    r.booking_date,
    r.arrival_time,
    r.party_size,
    r.customer_name,
    r.customer_email,
    r.customer_phone,
    r.special_requests,
    r.status
  FROM claimed AS c
  JOIN public.vip_booking_requests AS r
    ON r.id = c.booking_request_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.transition_vip_booking_request(
  p_booking_request_id uuid,
  p_to_status text,
  p_actor_type text DEFAULT 'system',
  p_note text DEFAULT NULL,
  p_status_message text DEFAULT NULL,
  p_agent_internal_note text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  status text,
  updated_at timestamptz,
  status_message text,
  agent_internal_note text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.vip_booking_requests%ROWTYPE;
  v_to_status text := trim(lower(COALESCE(p_to_status, '')));
  v_actor_type text := trim(lower(COALESCE(p_actor_type, 'system')));
  v_allowed boolean := false;
BEGIN
  IF v_to_status NOT IN ('submitted', 'in_review', 'confirmed', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid target status: %', p_to_status;
  END IF;

  IF v_actor_type NOT IN ('customer', 'agent', 'ops', 'system') THEN
    RAISE EXCEPTION 'Invalid actor type: %', p_actor_type;
  END IF;

  SELECT *
  INTO v_request
  FROM public.vip_booking_requests
  WHERE public.vip_booking_requests.id = p_booking_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VIP booking request not found: %', p_booking_request_id;
  END IF;

  IF v_request.status = 'submitted' AND v_to_status IN ('in_review', 'confirmed', 'rejected', 'cancelled') THEN
    v_allowed := true;
  ELSIF v_request.status = 'in_review' AND v_to_status IN ('confirmed', 'rejected', 'cancelled') THEN
    v_allowed := true;
  ELSIF v_request.status = 'confirmed' AND v_to_status = 'cancelled' THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid status transition: % -> %', v_request.status, v_to_status;
  END IF;

  UPDATE public.vip_booking_requests
  SET
    status = v_to_status,
    status_message = COALESCE(NULLIF(trim(p_status_message), ''), status_message),
    agent_internal_note = COALESCE(p_agent_internal_note, agent_internal_note),
    updated_at = now()
  WHERE public.vip_booking_requests.id = p_booking_request_id;

  INSERT INTO public.vip_booking_status_events (
    booking_request_id,
    from_status,
    to_status,
    actor_type,
    note
  )
  VALUES (
    p_booking_request_id,
    v_request.status,
    v_to_status,
    v_actor_type,
    p_note
  );

  RETURN QUERY
  SELECT
    r.id,
    r.status,
    r.updated_at,
    r.status_message,
    r.agent_internal_note
  FROM public.vip_booking_requests AS r
  WHERE r.id = p_booking_request_id;
END;
$$;
ALTER TABLE public.vip_booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_booking_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_agent_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_vip_booking_requests ON public.vip_booking_requests;
CREATE POLICY service_role_all_vip_booking_requests
  ON public.vip_booking_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_vip_booking_status_events ON public.vip_booking_status_events;
CREATE POLICY service_role_all_vip_booking_status_events
  ON public.vip_booking_status_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_vip_agent_tasks ON public.vip_agent_tasks;
CREATE POLICY service_role_all_vip_agent_tasks
  ON public.vip_agent_tasks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON TABLE public.vip_booking_requests FROM anon;
REVOKE ALL ON TABLE public.vip_booking_requests FROM authenticated;
REVOKE ALL ON TABLE public.vip_booking_status_events FROM anon;
REVOKE ALL ON TABLE public.vip_booking_status_events FROM authenticated;
REVOKE ALL ON TABLE public.vip_agent_tasks FROM anon;
REVOKE ALL ON TABLE public.vip_agent_tasks FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.vip_booking_requests
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.vip_booking_status_events
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.vip_agent_tasks
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_vip_agent_task(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_vip_booking_request(uuid, text, text, text, text, text)
  TO service_role;
