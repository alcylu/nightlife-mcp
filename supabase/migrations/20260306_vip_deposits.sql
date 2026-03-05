-- VIP Booking Deposit System
-- Adds per-venue deposit configuration and per-booking deposit tracking with Stripe

-- ============================================================
-- Table: vip_venue_deposit_config
-- Per-venue deposit settings. No row = no deposit required.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vip_venue_deposit_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  deposit_enabled boolean NOT NULL DEFAULT true,
  deposit_percentage integer NOT NULL DEFAULT 50
    CHECK (deposit_percentage >= 1 AND deposit_percentage <= 100),
  refund_cutoff_hours integer NOT NULL DEFAULT 24
    CHECK (refund_cutoff_hours >= 0),
  partial_refund_percentage integer NOT NULL DEFAULT 0
    CHECK (partial_refund_percentage >= 0 AND partial_refund_percentage <= 100),
  checkout_expiry_minutes integer NOT NULL DEFAULT 30
    CHECK (checkout_expiry_minutes >= 5 AND checkout_expiry_minutes <= 1440),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id)
);

ALTER TABLE public.vip_venue_deposit_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vip_venue_deposit_config FROM anon, authenticated;

-- ============================================================
-- Table: vip_booking_deposits
-- One deposit per booking. Stores Stripe state.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vip_booking_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_request_id uuid NOT NULL REFERENCES public.vip_booking_requests(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'refunded', 'partially_refunded', 'forfeited')),
  amount_jpy integer NOT NULL CHECK (amount_jpy >= 0),
  deposit_percentage integer NOT NULL,
  min_spend_jpy integer NOT NULL,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_checkout_url text,
  checkout_expires_at timestamptz,
  paid_at timestamptz,
  refund_cutoff_hours integer NOT NULL,
  partial_refund_percentage integer NOT NULL DEFAULT 0,
  refund_amount_jpy integer,
  stripe_refund_id text,
  refunded_at timestamptz,
  forfeited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_request_id)
);

ALTER TABLE public.vip_booking_deposits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vip_booking_deposits FROM anon, authenticated;

-- ============================================================
-- Column: vip_booking_requests.deposit_status
-- Denormalized for quick reads. Nullable for backwards compat.
-- ============================================================
ALTER TABLE public.vip_booking_requests
  ADD COLUMN IF NOT EXISTS deposit_status text
    CHECK (deposit_status IS NULL OR deposit_status IN (
      'pending', 'paid', 'expired', 'refunded', 'partially_refunded', 'forfeited', 'not_required'
    ));

-- Index for webhook lookups by Stripe session ID
CREATE INDEX IF NOT EXISTS idx_vip_booking_deposits_stripe_session
  ON public.vip_booking_deposits (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Index for booking deposit lookups
CREATE INDEX IF NOT EXISTS idx_vip_booking_deposits_booking
  ON public.vip_booking_deposits (booking_request_id);
