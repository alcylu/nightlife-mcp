---
phase: 07-create-booking-mutation
plan: "01"
subsystem: ui
tags: [react, next.js, supabase, react-hook-form, zod, tanstack-query, shadcn]

# Dependency graph
requires:
  - phase: 06-foundation-read-only-dashboard
    provides: vipAdminService.ts read functions, useVipBookings.ts hooks, VipBookingList.tsx component, shared types in vip.ts
provides:
  - POST /api/vip/bookings endpoint with auth/role guard and Zod validation
  - createVipAdminBooking() service function with full validation, 4-level pricing lookup, and ops status event
  - useCreateVipBooking() mutation hook with cache invalidation and toast notifications
  - VipCreateBookingDialog component with all booking fields plus internal note and change note
  - "New Booking" button wired into VipBookingList
affects: [08-booking-status-mutations, 09-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spread Zod parsed data by destructuring into explicit fields (not spread operator) to avoid TypeScript optional-field mismatch"
    - "Service input type uses editor_username for ops traceability, derived from caller.email in route handler"
    - "agent_internal_note saved via separate UPDATE after INSERT (not part of initial insert payload)"
    - "Status event uses actor_type 'ops' (not 'customer') for admin-created bookings"
    - "4-level pricing fallback: explicit date row -> day-of-week default -> venue default -> null"

key-files:
  created:
    - /Users/alcylu/Apps/nlt-admin/src/components/vip/VipCreateBookingDialog.tsx
  modified:
    - /Users/alcylu/Apps/nlt-admin/src/types/vip.ts
    - /Users/alcylu/Apps/nlt-admin/src/services/vipAdminService.ts
    - /Users/alcylu/Apps/nlt-admin/src/app/api/vip/bookings/route.ts
    - /Users/alcylu/Apps/nlt-admin/src/hooks/useVipBookings.ts
    - /Users/alcylu/Apps/nlt-admin/src/components/vip/VipBookingList.tsx

key-decisions:
  - "Zod schema spread causes TypeScript optional-field mismatch: fix by destructuring parsed.data into explicit named fields in route and dialog onSubmit"
  - "lookupAdminTablePricing ported as private helper in vipAdminService.ts (not imported from nightlife-mcp) to keep nlt-admin self-contained"
  - "agent_internal_note saved via UPDATE after INSERT — the base vip_booking_requests INSERT payload doesn't need it included; keeps INSERT minimal"
  - "Admin-created bookings skip resolveBookingWindow() date check and email sending — ops can create for any future date, no customer notification"
  - "Admin-created bookings skip vip_agent_tasks INSERT — ops already owns the booking, no agent alert needed"

patterns-established:
  - "AuditText union type pattern (typeof TEXT.en | typeof TEXT.ja) for i18n text props — established in Phase 06, continued here"
  - "Dialog form reset: call form.reset() in handleOpenChange when closing to prevent stale values on next open"
  - "useCreateVipBooking invalidates queryKey ['vip-bookings'] on success — triggers list refresh without full page reload"

requirements-completed: [MUTATE-04, MUTATE-06, MUTATE-07]

# Metrics
duration: 6min
completed: 2026-03-11
---

# Phase 07 Plan 01: Create Booking Mutation Summary

**Admin VIP booking creation via POST /api/vip/bookings with 4-level pricing lookup, ops status event, and full-featured dialog form with internal note and change note fields**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-11T09:24:27Z
- **Completed:** 2026-03-11T09:30:14Z
- **Tasks:** 2
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- POST `/api/vip/bookings` with auth guard (401/403), Zod body validation, 201 on success
- `createVipAdminBooking()` service with full field validation, 4-level pricing fallback (explicit date -> day-of-week -> venue default -> null), INSERT into vip_booking_requests, UPDATE for agent_internal_note, and status event with actor_type "ops"
- `useCreateVipBooking()` mutation hook that invalidates `['vip-bookings']` cache and shows toast on success/error
- `VipCreateBookingDialog` with all 10+ fields including ops-only internal note (MUTATE-06) and change note captured as status event note (MUTATE-07)
- "New Booking" button wired into VipBookingList that opens the dialog; form resets on close and submit

## Task Commits

Each task was committed atomically:

1. **Task 1: Types, service function, and POST API route for booking creation** - `ceac4c0` (feat)
2. **Task 2: Create booking dialog, mutation hook, and wire into booking list** - `6c6539c` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `/Users/alcylu/Apps/nlt-admin/src/types/vip.ts` - Added CreateVipAdminBookingInput and VipBookingCreateResult types
- `/Users/alcylu/Apps/nlt-admin/src/services/vipAdminService.ts` - Added createVipAdminBooking() with validation, pricing lookup, and status event
- `/Users/alcylu/Apps/nlt-admin/src/app/api/vip/bookings/route.ts` - Added POST handler with auth/role guard and Zod validation
- `/Users/alcylu/Apps/nlt-admin/src/hooks/useVipBookings.ts` - Added useCreateVipBooking() mutation hook
- `/Users/alcylu/Apps/nlt-admin/src/components/vip/VipCreateBookingDialog.tsx` - New: full form dialog component
- `/Users/alcylu/Apps/nlt-admin/src/components/vip/VipBookingList.tsx` - Added New Booking button and dialog

## Decisions Made
- **Zod parsed data spread:** TypeScript rejects spreading Zod's parsed.data into a type where fields are required, because Zod infers them as `string | undefined`. Fixed by destructuring each field explicitly in the route handler and in the dialog's onSubmit.
- **lookupAdminTablePricing as local helper:** Ported the 4-level pricing lookup from nightlife-mcp as a private helper in vipAdminService.ts rather than importing cross-repo. Keeps nlt-admin self-contained.
- **Skipped agent task insert:** Per plan research recommendation — ops-created bookings don't need a vip_agent_tasks row since ops already owns them and there's no alert needed.
- **Skipped date window validation:** Admin can create bookings for any future date (no 30-day window restriction like the customer flow).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod optional-field TypeScript mismatch in route handler**
- **Found during:** Task 1 (POST route implementation)
- **Issue:** Spreading `parsed.data` with `...parsed.data` into `CreateVipAdminBookingServiceInput` caused TypeScript to reject the assignment because Zod marks non-`.optional()` fields as `string | undefined` when inferred, making required fields appear optional.
- **Fix:** Replaced `...parsed.data` spread with explicit field-by-field destructuring in the route handler.
- **Files modified:** src/app/api/vip/bookings/route.ts
- **Verification:** Build passed cleanly after fix.
- **Committed in:** ceac4c0 (Task 1 commit)

**2. [Rule 1 - Bug] Same Zod optional-field TypeScript mismatch in dialog onSubmit**
- **Found during:** Task 2 (VipCreateBookingDialog)
- **Issue:** Same pattern — spreading `values` (Zod-inferred type) into `CreateVipAdminBookingInput` failed TypeScript check.
- **Fix:** Replaced spread with explicit field destructuring using `?? ''` fallbacks for required fields.
- **Files modified:** src/components/vip/VipCreateBookingDialog.tsx
- **Verification:** Build passed cleanly after fix.
- **Committed in:** 6c6539c (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs — same root cause: Zod type inference)
**Impact on plan:** Both fixes necessary for TypeScript build correctness. No scope creep. Pattern documented in key-decisions for future plans.

## Issues Encountered
None beyond the Zod TypeScript deviations documented above.

## User Setup Required
None - no external service configuration required. All changes operate against existing Supabase tables already seeded with data.

## Next Phase Readiness
- Admin can now create VIP bookings from the dashboard (MUTATE-04, MUTATE-06, MUTATE-07 complete)
- Ready for Phase 08: booking status mutations (approve, reject, cancel) via PATCH /api/vip/bookings/[id]
- Phase 09 cleanup blocked pending 48h production operation

---
*Phase: 07-create-booking-mutation*
*Completed: 2026-03-11*

## Self-Check: PASSED

All files verified:
- src/types/vip.ts: FOUND
- src/services/vipAdminService.ts: FOUND
- src/app/api/vip/bookings/route.ts: FOUND
- src/hooks/useVipBookings.ts: FOUND
- src/components/vip/VipCreateBookingDialog.tsx: FOUND
- src/components/vip/VipBookingList.tsx: FOUND
- .planning/phases/07-create-booking-mutation/07-01-SUMMARY.md: FOUND

Commits verified:
- ceac4c0: FOUND
- 6c6539c: FOUND
