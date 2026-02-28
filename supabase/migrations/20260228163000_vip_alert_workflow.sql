-- VIP alert-first workflow for workspace-allen notifier + acknowledge claim.

ALTER TABLE public.vip_agent_tasks
  ADD COLUMN IF NOT EXISTS first_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_count integer NOT NULL DEFAULT 0 CHECK (alert_count >= 0),
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by text,
  ADD COLUMN IF NOT EXISTS acknowledged_channel text,
  ADD COLUMN IF NOT EXISTS acknowledged_session text,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_vip_agent_tasks_due_alert
  ON public.vip_agent_tasks(status, next_attempt_at, created_at DESC);
CREATE OR REPLACE FUNCTION public.list_due_vip_alert_tasks(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  task_id uuid,
  booking_request_id uuid,
  booking_date date,
  arrival_time time,
  party_size integer,
  customer_name text,
  customer_email text,
  customer_phone text,
  special_requests text,
  venue_id uuid,
  venue_name text,
  current_status text,
  request_created_at timestamptz,
  first_alerted_at timestamptz,
  last_alerted_at timestamptz,
  alert_count integer,
  escalated_at timestamptz,
  should_escalate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.booking_request_id,
    r.booking_date,
    r.arrival_time,
    r.party_size,
    r.customer_name,
    r.customer_email,
    r.customer_phone,
    r.special_requests,
    r.venue_id,
    v.name,
    r.status,
    r.created_at,
    t.first_alerted_at,
    t.last_alerted_at,
    t.alert_count,
    t.escalated_at,
    (
      COALESCE(t.first_alerted_at, t.created_at) <= (p_now - interval '30 minutes')
      AND t.escalated_at IS NULL
    ) AS should_escalate
  FROM public.vip_agent_tasks AS t
  JOIN public.vip_booking_requests AS r
    ON r.id = t.booking_request_id
  LEFT JOIN public.venues AS v
    ON v.id = r.venue_id
  WHERE t.status = 'pending'
    AND t.task_type = 'new_vip_request'
    AND t.next_attempt_at <= p_now
  ORDER BY
    COALESCE(t.first_alerted_at, t.created_at) ASC,
    t.created_at ASC
  LIMIT v_limit;
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_vip_request_alert_sent(
  p_task_id uuid,
  p_broadcast_count integer,
  p_escalation boolean DEFAULT false,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  task_id uuid,
  status text,
  first_alerted_at timestamptz,
  last_alerted_at timestamptz,
  alert_count integer,
  escalated_at timestamptz,
  next_attempt_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_increment integer := GREATEST(COALESCE(p_broadcast_count, 0), 0);
BEGIN
  RETURN QUERY
  UPDATE public.vip_agent_tasks AS t
  SET
    first_alerted_at = COALESCE(t.first_alerted_at, p_now),
    last_alerted_at = p_now,
    alert_count = t.alert_count + v_increment,
    escalated_at = CASE
      WHEN COALESCE(p_escalation, false) AND t.escalated_at IS NULL THEN p_now
      ELSE t.escalated_at
    END,
    next_attempt_at = p_now + interval '5 minutes',
    last_error = NULL,
    updated_at = p_now
  WHERE t.id = p_task_id
    AND t.status = 'pending'
    AND t.task_type = 'new_vip_request'
  RETURNING
    t.id,
    t.status,
    t.first_alerted_at,
    t.last_alerted_at,
    t.alert_count,
    t.escalated_at,
    t.next_attempt_at;
END;
$$;
CREATE OR REPLACE FUNCTION public.acknowledge_vip_agent_task(
  p_task_id uuid,
  p_agent_id text,
  p_claimed_by_session text DEFAULT NULL,
  p_claimed_by_channel text DEFAULT NULL,
  p_claimed_by_actor text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  task_id uuid,
  task_status text,
  booking_request_id uuid,
  booking_status text,
  booking_status_message text,
  booking_updated_at timestamptz,
  acknowledged_by text,
  acknowledged_channel text,
  acknowledged_session text,
  acknowledged_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.vip_agent_tasks%ROWTYPE;
  v_request public.vip_booking_requests%ROWTYPE;
  v_agent_id text := left(COALESCE(NULLIF(trim(p_agent_id), ''), 'agent'), 128);
  v_actor text := left(COALESCE(NULLIF(trim(p_claimed_by_actor), ''), v_agent_id), 128);
  v_session text := NULLIF(left(COALESCE(p_claimed_by_session, ''), 255), '');
  v_channel text := NULLIF(left(COALESCE(p_claimed_by_channel, ''), 64), '');
  v_note text;
BEGIN
  SELECT *
  INTO v_task
  FROM public.vip_agent_tasks
  WHERE public.vip_agent_tasks.id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VIP agent task not found: %', p_task_id;
  END IF;

  IF v_task.status <> 'pending' THEN
    RAISE EXCEPTION 'VIP task not available for acknowledgement: %', p_task_id;
  END IF;

  SELECT *
  INTO v_request
  FROM public.vip_booking_requests
  WHERE public.vip_booking_requests.id = v_task.booking_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VIP booking request not found: %', v_task.booking_request_id;
  END IF;

  UPDATE public.vip_agent_tasks
  SET
    status = 'claimed',
    attempt_count = public.vip_agent_tasks.attempt_count + 1,
    claimed_by = v_agent_id,
    claimed_at = p_now,
    acknowledged_by = v_actor,
    acknowledged_channel = v_channel,
    acknowledged_session = v_session,
    acknowledged_at = p_now,
    updated_at = p_now
  WHERE public.vip_agent_tasks.id = p_task_id
    AND public.vip_agent_tasks.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VIP task not available for acknowledgement: %', p_task_id;
  END IF;

  IF v_request.status = 'submitted' THEN
    UPDATE public.vip_booking_requests
    SET
      status = 'in_review',
      status_message = 'Your VIP request is now in review with the venue booking team.',
      updated_at = p_now
    WHERE public.vip_booking_requests.id = v_request.id;

    v_note := 'Request acknowledged and moved to in_review.';

    INSERT INTO public.vip_booking_status_events (
      booking_request_id,
      from_status,
      to_status,
      actor_type,
      note,
      created_at
    )
    VALUES (
      v_request.id,
      v_request.status,
      'in_review',
      'agent',
      v_note,
      p_now
    );
  ELSIF v_request.status = 'in_review' THEN
    v_note := 'Request acknowledged by booking operator.';
    INSERT INTO public.vip_booking_status_events (
      booking_request_id,
      from_status,
      to_status,
      actor_type,
      note,
      created_at
    )
    VALUES (
      v_request.id,
      'in_review',
      'in_review',
      'agent',
      v_note,
      p_now
    );
  ELSE
    v_note := 'Request acknowledged after final status was already set.';
    INSERT INTO public.vip_booking_status_events (
      booking_request_id,
      from_status,
      to_status,
      actor_type,
      note,
      created_at
    )
    VALUES (
      v_request.id,
      v_request.status,
      v_request.status,
      'agent',
      v_note,
      p_now
    );
  END IF;

  UPDATE public.vip_agent_tasks
  SET
    status = 'done',
    updated_at = p_now
  WHERE public.vip_agent_tasks.id = p_task_id;

  RETURN QUERY
  SELECT
    t.id,
    t.status,
    r.id,
    r.status,
    r.status_message,
    r.updated_at,
    t.acknowledged_by,
    t.acknowledged_channel,
    t.acknowledged_session,
    t.acknowledged_at
  FROM public.vip_agent_tasks AS t
  JOIN public.vip_booking_requests AS r
    ON r.id = t.booking_request_id
  WHERE t.id = p_task_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_due_vip_alert_tasks(integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_vip_request_alert_sent(uuid, integer, boolean, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_vip_agent_task(uuid, text, text, text, text, timestamptz)
  TO service_role;
