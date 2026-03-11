---
phase: 08-status-update-with-stripe-and-resend
plan: "01"
subsystem: payments
tags: [stripe, resend, email, vip-bookings, next.js, api-routes, supabase]

# Dependency graph
requires:
  - phase: 07-create-booking-mutation
    provides: createVipAdminBooking, PATCH route pattern, Zod explicit-destructure convention
  - phase: 06-foundation-read-only-dashboard
    provides: vipAdminService.ts, getVipAdminBookingDetail, buildBookingSummaries, admin role guard pattern
provides:
  - PATCH /api/vip/bookings/[id] with admin role guard and Zod body validation
  - updateVipAdminBooking service function with non-blocking Stripe/Resend side effects
  - createDepositForBooking and getDepositForBooking in vipDeposits.ts
  - Email dispatch functions (sendDepositRequiredEmail, sendBookingConfirmedEmail, sendBookingRejectedEmail)
  - deposit_checkout_url and deposit_status on VipAdminBookingSummary (via vip_booking_deposits join)
  - Stripe singleton helper (src/lib/stripe.ts) and Resend singleton helper (src/lib/resend.ts)
affects: [09-phase-9-cleanup, phase-08-plan-02-status-update-ui]

# Tech tracking
tech-stack:
  added: [stripe@^20.4.0, resend@^4.8.0]
  patterns:
    - Non-blocking side effect pattern: Stripe and Resend calls wrapped in individual try/catch, logged to console.error, never throw
    - Module-level singleton pattern for Stripe and Resend instances
    - Deposit join via separate batch query in buildBookingSummaries (non-fatal, supplementary data)
    - Explicit Zod destructuring per Phase 7 convention (no spread of parsed.data)

key-files:
  created:
    - src/lib/stripe.ts
    - src/lib/resend.ts
    - src/services/vipDeposits.ts
    - src/services/vipEmail.ts
  modified:
    - src/types/vip.ts
    - src/services/vipAdminService.ts
    - src/app/api/vip/bookings/[id]/route.ts
    - package.json
    - package-lock.json

key-decisions:
  - "normalizeActor and normalizeOptionalText added as private helpers in vipAdminService.ts — not pre-existing, added inline for updateVipAdminBooking"
  - "Deposit join in buildBookingSummaries is non-fatal: depositError logged and empty map used, preserving existing booking data on partial DB failure"
  - "createDepositForBooking uses CORRECT parameter order from deposits.ts definition (supabase, stripeSecretKey, bookingRequestId, nightlifeBaseUrl) — NOT the incorrect call-site order in vipAdmin.ts"
  - "Email send on deposit_required fetches fresh deposit record after Stripe checkout creation to get checkout URL and expires_at"
  - "PATCH error mapping uses message.toLowerCase() checks matching RPC error vocabulary: not found -> 404, invalid/must/cannot/patch -> 400"

patterns-established:
  - "Non-blocking side effects: wrap in try/catch, log with console.error, never rethrow"
  - "Deposit join: batch query by booking_request_id array, first-match wins in Map"
  - "Service function returns refreshed booking via getVipAdminBookingDetail — always reflects post-side-effect state"

requirements-completed: [MUTATE-01, MUTATE-02, MUTATE-03, MUTATE-05]

# Metrics
duration: 5min
completed: 2026-03-11
---

# Phase 08 Plan 01: Status Update Backend Summary

**PATCH /api/vip/bookings/[id] with Stripe deposit creation and Resend email dispatch as non-blocking side effects, deposit link visible in booking detail response**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-11T10:23:59Z
- **Completed:** 2026-03-11T10:29:03Z
- **Tasks:** 2
- **Files modified:** 9 (nlt-admin repo)

## Accomplishments
- PATCH /api/vip/bookings/[id] endpoint with admin role guard, Zod validation, and proper error mapping (401/403/400/404/500)
- updateVipAdminBooking service: calls admin_update_vip_booking_request RPC, then fires non-blocking Stripe and Resend side effects
- After deposit_required transition, vip_booking_deposits is queried and deposit_checkout_url included in the booking detail response
- Ported createDepositForBooking (4-param correct order) and email templates from nightlife-mcp with nlt-admin adaptations (plain Error, console.error)

## Task Commits

Each task was committed atomically in the nlt-admin repository:

1. **Task 1: Install deps, add types, create Stripe/Resend lib helpers and deposit/email service files** - `3ca3e3f` (feat)
2. **Task 2: Add updateVipAdminBooking service function, deposit join in buildBookingSummaries, and PATCH API route** - `f48e0ca` (feat)

## Files Created/Modified

**Created:**
- `src/lib/stripe.ts` - Stripe singleton + createDepositCheckoutSession (ported from nightlife-mcp, no refund/webhook functions)
- `src/lib/resend.ts` - Resend singleton + sendVipEmail with non-blocking error swallowing
- `src/services/vipDeposits.ts` - createDepositForBooking + getDepositForBooking (ported, plain Error, console.error)
- `src/services/vipEmail.ts` - email templates (emailLayout, depositRequiredContent, bookingConfirmedContent, bookingRejectedContent) + dispatch functions

**Modified:**
- `src/types/vip.ts` - Added deposit_checkout_url/deposit_status to VipAdminBookingSummary; added UpdateVipAdminBookingInput, VipAdminBookingUpdateResult, VipDepositRecord, VipVenueDepositConfig, BookingEmailData types
- `src/services/vipAdminService.ts` - Deposit join in buildBookingSummaries; updateVipAdminBooking exported function with non-blocking side effects; normalizeActor/normalizeOptionalText helpers added
- `src/app/api/vip/bookings/[id]/route.ts` - Added PATCH handler with Zod schema, auth guard, service call, and error mapping
- `package.json` / `package-lock.json` - stripe@^20.4.0 and resend@^4.8.0 added

## Decisions Made

- normalizeActor and normalizeOptionalText did not pre-exist in vipAdminService.ts — added as private helpers in the same file
- Deposit join uses a non-fatal pattern: if depositError occurs, logs and proceeds with empty Map (booking data unaffected)
- createDepositForBooking parameter order follows the deposits.ts DEFINITION, not the incorrect vipAdmin.ts call site
- Email send on deposit_required re-fetches deposit after Stripe creation to get the fresh checkout URL and expires_at
- PATCH error mapping uses lowercase substring matching on the message to categorize 400 vs 404 vs 500

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Initial build after Task 1 failed as expected because `buildBookingSummaries` returned objects missing the new `deposit_checkout_url` and `deposit_status` fields (TypeScript strict check). Task 2 was required to complete the interface — this was the planned flow, not a deviation.

## User Setup Required

**External services require manual configuration before these features work in production.**

The nlt-admin Railway service needs the following environment variables added:

| Variable | Source | Required For |
|----------|--------|-------------|
| `STRIPE_SECRET_KEY` | Stripe dashboard (same key as nightlife-mcp) | Deposit checkout session creation |
| `RESEND_API_KEY` | Resend dashboard (same key as nightlife-mcp) | Transactional email dispatch |
| `NIGHTLIFE_CONSUMER_URL` | Set to `https://nightlifetokyo.com` | Stripe success/cancel redirect URLs |

Note: These are non-blocking — if the env vars are missing, the PATCH route will still update booking status. Stripe/Resend calls will simply be skipped (keys are checked before use in the helpers).

## Next Phase Readiness
- PATCH endpoint ready for Plan 02's UI status update dialog to call
- Deposit checkout URL flows through to booking detail response — UI can render payment link directly
- All success criteria met: MUTATE-01 (admin route), MUTATE-02 (deposit creation), MUTATE-03 (email dispatch), MUTATE-05 (status_message in emails)

---
*Phase: 08-status-update-with-stripe-and-resend*
*Completed: 2026-03-11*
