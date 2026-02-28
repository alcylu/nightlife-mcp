-- Align VIP customer-facing wording to venue-direct booking language.

ALTER TABLE public.vip_booking_requests
  ALTER COLUMN status_message
  SET DEFAULT 'Your VIP booking request has been sent to the venue booking desk.';
UPDATE public.vip_booking_requests
SET status_message = 'Your VIP booking request has been sent to the venue booking desk.'
WHERE status_message = 'Request received. Concierge is reviewing your booking.';
