-- Venue-level VIP minimum table price (broad floor price)
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS vip_default_min_spend numeric(12,2),
  ADD COLUMN IF NOT EXISTS vip_default_currency text DEFAULT 'JPY';

-- Per-table day-of-week pricing templates
CREATE TABLE IF NOT EXISTS vip_table_day_defaults (
  vip_venue_table_id uuid NOT NULL REFERENCES vip_venue_tables(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  default_status text NOT NULL DEFAULT 'available',
  min_spend numeric(12,2),
  currency text NOT NULL DEFAULT 'JPY',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vip_venue_table_id, day_of_week)
);

-- Index for fast venue-wide lookups (fetch all table templates for a venue)
CREATE INDEX IF NOT EXISTS idx_vip_table_day_defaults_venue
  ON vip_table_day_defaults(venue_id);

-- RLS: service role only (ops tools use service role key)
ALTER TABLE vip_table_day_defaults ENABLE ROW LEVEL SECURITY;
