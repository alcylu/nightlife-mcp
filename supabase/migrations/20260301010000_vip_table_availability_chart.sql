-- VIP table inventory + per-date availability + chart coordinates.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_vip_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.vip_venue_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  table_code text NOT NULL,
  table_name text NOT NULL,
  zone text,
  capacity_min integer NOT NULL DEFAULT 1 CHECK (capacity_min >= 1),
  capacity_max integer NOT NULL DEFAULT 12 CHECK (capacity_max >= capacity_min),
  is_active boolean NOT NULL DEFAULT true,
  default_status text NOT NULL DEFAULT 'unknown' CHECK (
    default_status IN ('available', 'held', 'booked', 'blocked', 'unknown')
  ),
  chart_shape text NOT NULL DEFAULT 'rectangle' CHECK (
    chart_shape IN ('rectangle', 'circle', 'booth', 'standing')
  ),
  chart_x numeric(10,2),
  chart_y numeric(10,2),
  chart_width numeric(10,2),
  chart_height numeric(10,2),
  chart_rotation numeric(8,2),
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (venue_id, table_code)
);

CREATE INDEX IF NOT EXISTS idx_vip_venue_tables_venue_id
  ON public.vip_venue_tables(venue_id);
CREATE INDEX IF NOT EXISTS idx_vip_venue_tables_active
  ON public.vip_venue_tables(venue_id, is_active, sort_order, table_code);

DROP TRIGGER IF EXISTS trg_set_vip_venue_tables_updated_at ON public.vip_venue_tables;
CREATE TRIGGER trg_set_vip_venue_tables_updated_at
BEFORE UPDATE ON public.vip_venue_tables
FOR EACH ROW
EXECUTE FUNCTION public.set_vip_updated_at();

CREATE TABLE IF NOT EXISTS public.vip_table_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  vip_venue_table_id uuid NOT NULL REFERENCES public.vip_venue_tables(id) ON DELETE CASCADE,
  booking_date date NOT NULL,
  status text NOT NULL DEFAULT 'unknown' CHECK (
    status IN ('available', 'held', 'booked', 'blocked', 'unknown')
  ),
  min_spend numeric(12,2) CHECK (min_spend IS NULL OR min_spend >= 0),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (vip_venue_table_id, booking_date)
);

CREATE INDEX IF NOT EXISTS idx_vip_table_availability_lookup
  ON public.vip_table_availability(venue_id, booking_date, status);
CREATE INDEX IF NOT EXISTS idx_vip_table_availability_table_date
  ON public.vip_table_availability(vip_venue_table_id, booking_date);

CREATE OR REPLACE FUNCTION public.enforce_vip_table_availability_venue_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_table_venue_id uuid;
BEGIN
  SELECT venue_id
  INTO v_table_venue_id
  FROM public.vip_venue_tables
  WHERE id = NEW.vip_venue_table_id;

  IF v_table_venue_id IS NULL THEN
    RAISE EXCEPTION 'VIP venue table not found: %', NEW.vip_venue_table_id;
  END IF;

  IF NEW.venue_id <> v_table_venue_id THEN
    RAISE EXCEPTION 'vip_table_availability venue mismatch (venue_id %, table venue_id %)',
      NEW.venue_id,
      v_table_venue_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_vip_table_availability_venue_match ON public.vip_table_availability;
CREATE TRIGGER trg_enforce_vip_table_availability_venue_match
BEFORE INSERT OR UPDATE ON public.vip_table_availability
FOR EACH ROW
EXECUTE FUNCTION public.enforce_vip_table_availability_venue_match();

DROP TRIGGER IF EXISTS trg_set_vip_table_availability_updated_at ON public.vip_table_availability;
CREATE TRIGGER trg_set_vip_table_availability_updated_at
BEFORE UPDATE ON public.vip_table_availability
FOR EACH ROW
EXECUTE FUNCTION public.set_vip_updated_at();

ALTER TABLE public.vip_venue_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_table_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_vip_venue_tables ON public.vip_venue_tables;
CREATE POLICY service_role_all_vip_venue_tables
  ON public.vip_venue_tables
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_vip_table_availability ON public.vip_table_availability;
CREATE POLICY service_role_all_vip_table_availability
  ON public.vip_table_availability
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.vip_venue_tables FROM anon;
REVOKE ALL ON TABLE public.vip_venue_tables FROM authenticated;
REVOKE ALL ON TABLE public.vip_table_availability FROM anon;
REVOKE ALL ON TABLE public.vip_table_availability FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.vip_venue_tables
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.vip_table_availability
  TO service_role;
