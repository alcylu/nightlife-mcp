-- Add dedicated VIP-booking support flag on venues.
-- This is intentionally separate from guest_list_enabled.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS vip_booking_enabled boolean;
UPDATE public.venues
SET vip_booking_enabled = false
WHERE vip_booking_enabled IS NULL;
ALTER TABLE public.venues
  ALTER COLUMN vip_booking_enabled SET DEFAULT false;
ALTER TABLE public.venues
  ALTER COLUMN vip_booking_enabled SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_venues_vip_booking_enabled
  ON public.venues(vip_booking_enabled);
