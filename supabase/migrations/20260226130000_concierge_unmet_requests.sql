-- Concierge unmet-request backlog for public nightlife assistant.
-- Captures requests that could not be satisfied from current data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS public.concierge_unmet_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT 'other',
  language text NOT NULL DEFAULT 'unknown',
  city text,
  raw_query text NOT NULL,
  normalized_intent text,
  suggested_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_hash text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'resolved', 'rejected')),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text
);
CREATE INDEX IF NOT EXISTS idx_concierge_unmet_requests_created_at
  ON public.concierge_unmet_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_concierge_unmet_requests_status
  ON public.concierge_unmet_requests(status);
CREATE INDEX IF NOT EXISTS idx_concierge_unmet_requests_city
  ON public.concierge_unmet_requests(city);
ALTER TABLE public.concierge_unmet_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_concierge_unmet_requests ON public.concierge_unmet_requests;
CREATE POLICY service_role_all_concierge_unmet_requests
  ON public.concierge_unmet_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON TABLE public.concierge_unmet_requests FROM anon;
REVOKE ALL ON TABLE public.concierge_unmet_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.concierge_unmet_requests
  TO service_role;
