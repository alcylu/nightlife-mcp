-- Allow ops dashboard to override VIP booking status across any valid status value.
-- Keep all existing audit/status-event behavior, terminal task settlement, and validations.

CREATE OR REPLACE FUNCTION public.admin_update_vip_booking_request(
  p_booking_request_id uuid,
  p_editor_username text,
  p_patch jsonb,
  p_note text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  booking_request_id uuid,
  changed_fields text[],
  audit_id uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.vip_booking_requests%ROWTYPE;
  v_editor text := left(COALESCE(NULLIF(trim(p_editor_username), ''), ''), 128);
  v_note text := NULLIF(left(COALESCE(trim(p_note), ''), 400), '');

  v_new_status text;
  v_new_status_message text;
  v_new_agent_internal_note text;
  v_new_booking_date date;
  v_new_arrival_time time;
  v_new_party_size integer;
  v_new_special_requests text;

  v_changed text[] := ARRAY[]::text[];
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;

  v_status text;
  v_status_message text;
  v_agent_internal_note text;
  v_booking_date_text text;
  v_arrival_time_text text;
  v_party_size integer;
  v_special_requests text;

  v_audit_id uuid;
BEGIN
  IF v_editor = '' THEN
    RAISE EXCEPTION 'editor_username cannot be blank';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'patch must contain at least one field';
  END IF;

  SELECT *
  INTO v_request
  FROM public.vip_booking_requests
  WHERE id = p_booking_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VIP booking request not found: %', p_booking_request_id;
  END IF;

  v_new_status := v_request.status;
  v_new_status_message := v_request.status_message;
  v_new_agent_internal_note := v_request.agent_internal_note;
  v_new_booking_date := v_request.booking_date;
  v_new_arrival_time := v_request.arrival_time;
  v_new_party_size := v_request.party_size;
  v_new_special_requests := v_request.special_requests;

  IF p_patch ? 'status' THEN
    v_status := lower(trim(COALESCE(p_patch ->> 'status', '')));
    IF v_status NOT IN ('submitted', 'in_review', 'confirmed', 'rejected', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid target status: %', v_status;
    END IF;

    IF v_status <> v_request.status THEN
      v_new_status := v_status;
      v_changed := array_append(v_changed, 'status');
      v_before := v_before || jsonb_build_object('status', to_jsonb(v_request.status));
      v_after := v_after || jsonb_build_object('status', to_jsonb(v_new_status));
    END IF;
  END IF;

  IF p_patch ? 'status_message' THEN
    v_status_message := NULLIF(trim(COALESCE(p_patch ->> 'status_message', '')), '');
    IF v_status_message IS NULL THEN
      RAISE EXCEPTION 'status_message cannot be blank';
    END IF;
    IF length(v_status_message) > 400 THEN
      RAISE EXCEPTION 'status_message exceeds 400 characters';
    END IF;

    IF v_status_message IS DISTINCT FROM v_request.status_message THEN
      v_new_status_message := v_status_message;
      v_changed := array_append(v_changed, 'status_message');
      v_before := v_before || jsonb_build_object('status_message', to_jsonb(v_request.status_message));
      v_after := v_after || jsonb_build_object('status_message', to_jsonb(v_new_status_message));
    END IF;
  END IF;

  IF p_patch ? 'agent_internal_note' THEN
    IF jsonb_typeof(p_patch -> 'agent_internal_note') = 'null' THEN
      v_agent_internal_note := NULL;
    ELSE
      v_agent_internal_note := NULLIF(trim(COALESCE(p_patch ->> 'agent_internal_note', '')), '');
      IF v_agent_internal_note IS NOT NULL AND length(v_agent_internal_note) > 2000 THEN
        RAISE EXCEPTION 'agent_internal_note exceeds 2000 characters';
      END IF;
    END IF;

    IF v_agent_internal_note IS DISTINCT FROM v_request.agent_internal_note THEN
      v_new_agent_internal_note := v_agent_internal_note;
      v_changed := array_append(v_changed, 'agent_internal_note');
      v_before := v_before || jsonb_build_object('agent_internal_note', to_jsonb(v_request.agent_internal_note));
      v_after := v_after || jsonb_build_object('agent_internal_note', to_jsonb(v_new_agent_internal_note));
    END IF;
  END IF;

  IF p_patch ? 'booking_date' THEN
    v_booking_date_text := NULLIF(trim(COALESCE(p_patch ->> 'booking_date', '')), '');
    IF v_booking_date_text IS NULL THEN
      RAISE EXCEPTION 'booking_date cannot be blank';
    END IF;

    BEGIN
      v_new_booking_date := v_booking_date_text::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'booking_date must be a valid YYYY-MM-DD date';
    END;

    IF v_new_booking_date::text IS DISTINCT FROM v_request.booking_date::text THEN
      v_changed := array_append(v_changed, 'booking_date');
      v_before := v_before || jsonb_build_object('booking_date', to_jsonb(v_request.booking_date::text));
      v_after := v_after || jsonb_build_object('booking_date', to_jsonb(v_new_booking_date::text));
    END IF;
  END IF;

  IF p_patch ? 'arrival_time' THEN
    v_arrival_time_text := NULLIF(trim(COALESCE(p_patch ->> 'arrival_time', '')), '');
    IF v_arrival_time_text IS NULL THEN
      RAISE EXCEPTION 'arrival_time cannot be blank';
    END IF;

    IF v_arrival_time_text !~ '^([01][0-9]|2[0-3]):([0-5][0-9])$' THEN
      RAISE EXCEPTION 'arrival_time must use HH:MM 24-hour format';
    END IF;

    BEGIN
      v_new_arrival_time := v_arrival_time_text::time;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'arrival_time must be a valid time value';
    END;

    IF v_new_arrival_time::text IS DISTINCT FROM v_request.arrival_time::text THEN
      v_changed := array_append(v_changed, 'arrival_time');
      v_before := v_before || jsonb_build_object('arrival_time', to_jsonb(v_request.arrival_time::text));
      v_after := v_after || jsonb_build_object('arrival_time', to_jsonb(v_new_arrival_time::text));
    END IF;
  END IF;

  IF p_patch ? 'party_size' THEN
    BEGIN
      v_party_size := (p_patch ->> 'party_size')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'party_size must be an integer';
    END;

    IF v_party_size < 1 OR v_party_size > 30 THEN
      RAISE EXCEPTION 'party_size must be between 1 and 30';
    END IF;

    IF v_party_size IS DISTINCT FROM v_request.party_size THEN
      v_new_party_size := v_party_size;
      v_changed := array_append(v_changed, 'party_size');
      v_before := v_before || jsonb_build_object('party_size', to_jsonb(v_request.party_size));
      v_after := v_after || jsonb_build_object('party_size', to_jsonb(v_new_party_size));
    END IF;
  END IF;

  IF p_patch ? 'special_requests' THEN
    IF jsonb_typeof(p_patch -> 'special_requests') = 'null' THEN
      v_special_requests := NULL;
    ELSE
      v_special_requests := NULLIF(trim(COALESCE(p_patch ->> 'special_requests', '')), '');
      IF v_special_requests IS NOT NULL AND length(v_special_requests) > 2000 THEN
        RAISE EXCEPTION 'special_requests exceeds 2000 characters';
      END IF;
    END IF;

    IF v_special_requests IS DISTINCT FROM v_request.special_requests THEN
      v_new_special_requests := v_special_requests;
      v_changed := array_append(v_changed, 'special_requests');
      v_before := v_before || jsonb_build_object('special_requests', to_jsonb(v_request.special_requests));
      v_after := v_after || jsonb_build_object('special_requests', to_jsonb(v_new_special_requests));
    END IF;
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RAISE EXCEPTION 'Patch does not modify any editable field';
  END IF;

  UPDATE public.vip_booking_requests
  SET
    status = v_new_status,
    status_message = v_new_status_message,
    agent_internal_note = v_new_agent_internal_note,
    booking_date = v_new_booking_date,
    arrival_time = v_new_arrival_time,
    party_size = v_new_party_size,
    special_requests = v_new_special_requests,
    updated_at = p_now
  WHERE id = p_booking_request_id;

  IF v_new_status IS DISTINCT FROM v_request.status THEN
    INSERT INTO public.vip_booking_status_events (
      booking_request_id,
      from_status,
      to_status,
      actor_type,
      note,
      created_at
    )
    VALUES (
      p_booking_request_id,
      v_request.status,
      v_new_status,
      'ops',
      v_note,
      p_now
    );
  END IF;

  IF v_new_status IS DISTINCT FROM v_request.status
     AND v_new_status IN ('confirmed', 'rejected', 'cancelled') THEN
    UPDATE public.vip_agent_tasks
    SET
      status = 'done',
      last_error = NULL,
      updated_at = p_now
    WHERE public.vip_agent_tasks.booking_request_id = p_booking_request_id
      AND status IN ('pending', 'claimed');
  END IF;

  INSERT INTO public.vip_booking_edit_audits (
    booking_request_id,
    editor_username,
    change_note,
    changed_fields,
    before_values,
    after_values,
    created_at
  )
  VALUES (
    p_booking_request_id,
    v_editor,
    v_note,
    v_changed,
    v_before,
    v_after,
    p_now
  )
  RETURNING id INTO v_audit_id;

  RETURN QUERY
  SELECT
    r.id,
    v_changed,
    v_audit_id,
    r.updated_at
  FROM public.vip_booking_requests AS r
  WHERE r.id = p_booking_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_vip_booking_request(
  uuid,
  text,
  jsonb,
  text,
  timestamptz
) TO service_role;
