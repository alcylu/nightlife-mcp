BEGIN;
CREATE TABLE public.mcp_site_funnel_events (
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  visit_id uuid NOT NULL,
  event text NOT NULL CHECK(event IN ('page_view','plan_click','signup_attempt','signup_submitted','signup_error','email_confirmed','checkout_attempt','checkout_redirect','checkout_error')),
  page text NOT NULL CHECK(page IN ('home','checkout','signup','login','dashboard','request-usage','terms','privacy')),
  source text NOT NULL CHECK(source IN ('direct','search','github','agensi','nightlifetokyo','other')),
  plan text NOT NULL CHECK(plan IN ('none','starter','pro')),
  PRIMARY KEY(day,visit_id,event,page,source,plan)
);
ALTER TABLE public.mcp_site_funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_site_funnel_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_site_funnel_events TO service_role;
CREATE FUNCTION public.record_mcp_site_event(p_visit uuid,p_event text,p_page text,p_source text,p_plan text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- Cheap bounded analytics ingestion. Serialize briefly for the global daily
  -- ceiling so rotating anonymous visit IDs cannot grow storage without bound.
  PERFORM pg_advisory_xact_lock(20261022,90000);
  DELETE FROM mcp_site_funnel_events WHERE day < (now() AT TIME ZONE 'UTC')::date-30;
  IF (SELECT count(*) FROM mcp_site_funnel_events WHERE day=(now() AT TIME ZONE 'UTC')::date)>=20000 THEN RETURN; END IF;
  IF (SELECT count(*) FROM mcp_site_funnel_events WHERE day=(now() AT TIME ZONE 'UTC')::date AND visit_id=p_visit)>=50 THEN RETURN; END IF;
  INSERT INTO mcp_site_funnel_events(visit_id,event,page,source,plan) VALUES(p_visit,p_event,p_page,p_source,p_plan) ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.record_mcp_site_event(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_mcp_site_event(uuid,text,text,text,text) TO service_role;
-- Production already runs pg_cron. Keep local empty-Postgres regression tests
-- portable while scheduling retention independently of future visitor traffic.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('mcp-site-funnel-retention','15 3 * * *',
      $job$DELETE FROM public.mcp_site_funnel_events WHERE day < (now() AT TIME ZONE 'UTC')::date-30$job$);
  END IF;
END $$;
COMMIT;
