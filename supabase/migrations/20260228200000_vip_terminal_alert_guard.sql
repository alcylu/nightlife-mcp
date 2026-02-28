-- Stop alert retries once a booking reaches a terminal status.

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
    AND r.status IN ('submitted', 'in_review')
  ORDER BY
    COALESCE(t.first_alerted_at, t.created_at) ASC,
    t.created_at ASC
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_vip_agent_tasks_for_terminal_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('confirmed', 'rejected', 'cancelled')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.vip_agent_tasks
    SET
      status = 'done',
      last_error = NULL,
      updated_at = now()
    WHERE booking_request_id = NEW.id
      AND task_type = 'new_vip_request'
      AND status IN ('pending', 'claimed');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_vip_agent_tasks_on_terminal_status
  ON public.vip_booking_requests;
CREATE TRIGGER trg_settle_vip_agent_tasks_on_terminal_status
AFTER UPDATE OF status ON public.vip_booking_requests
FOR EACH ROW
EXECUTE FUNCTION public.settle_vip_agent_tasks_for_terminal_booking();

GRANT EXECUTE ON FUNCTION public.list_due_vip_alert_tasks(integer, timestamptz)
  TO service_role;
