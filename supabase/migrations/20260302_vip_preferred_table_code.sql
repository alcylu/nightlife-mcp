-- Add preferred_table_code and min_spend to vip_booking_requests
-- preferred_table_code: customer picks a table (optional)
-- min_spend / min_spend_currency: auto-populated from pricing data, venue can override
ALTER TABLE public.vip_booking_requests
  ADD COLUMN IF NOT EXISTS preferred_table_code text,
  ADD COLUMN IF NOT EXISTS min_spend integer,
  ADD COLUMN IF NOT EXISTS min_spend_currency text DEFAULT 'JPY';
