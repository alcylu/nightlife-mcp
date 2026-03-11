---
phase: 08-status-update-with-stripe-and-resend
plan: "02"
subsystem: ui
tags: [react, tanstack-query, shadcn, react-hook-form, zod, vip-bookings, next.js, status-update]

# Dependency graph
requires:
  - phase: 08-status-update-with-stripe-and-resend
    plan: "01"
    provides: PATCH /api/vip/bookings/[id], UpdateVipAdminBookingInput, VipAdminBookingUpdateResult, deposit_checkout_url on VipAdminBookingSummary
  - phase: 06-foundation-read-only-dashboard
    provides: VipBookingDetail component, useVipBookingDetail hook, i18n TEXT object pattern
provides:
  - useUpdateVipBookingStatus mutation hook in useVipBookingDetail.ts (PATCH + cache invalidation)
  - VipUpdateStatusDialog component with VALID_TRANSITIONS map, DEFAULT_STATUS_MESSAGES auto-fill
  - Update Status button in VipBookingDetail header (hidden for terminal statuses)
  - Deposit checkout URL amber info bar on booking detail for deposit_required bookings
affects: [phase-09-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - VALID_TRANSITIONS map at module level in dialog component — prevents invalid state machine transitions in UI
    - DEFAULT_STATUS_MESSAGES auto-fill via useEffect watching form status field — resets to new default when user changes status
    - isTerminal computed from status strings — controls Update Status button visibility
    - Conditional deposit link bar renders only when status=deposit_required AND deposit_checkout_url is truthy

key-files:
  created:
    - src/components/vip/VipUpdateStatusDialog.tsx
  modified:
    - src/hooks/useVipBookingDetail.ts
    - src/components/vip/VipBookingDetail.tsx

key-decisions:
  - "useUpdateVipBookingStatus lives in useVipBookingDetail.ts (not a new file) — both hooks share the same query key context and belong together"
  - "Dialog resets form on both close (handleOpenChange) and successful submit (onSuccess callback) — prevents stale state on reopen"
  - "Deposit link bar placed BETWEEN the header row and Separator — gives ops immediate visual prominence before the info cards"
  - "VipUpdateStatusDialog rendered inside the component return (after Separator) rather than conditionally — avoids hook ordering issues"

patterns-established:
  - "Status transition map: const VALID_TRANSITIONS at module level, keyed by current status — simple O(1) lookup for valid next states"
  - "Auto-fill pattern: useEffect watches form field, sets value only if empty or currently contains another default (preserves manual edits)"

requirements-completed: [MUTATE-01, MUTATE-02, MUTATE-05]

# Metrics
duration: 2min
completed: 2026-03-11
---

# Phase 08 Plan 02: Status Update UI Summary

**Status update dialog with VALID_TRANSITIONS map, DEFAULT_STATUS_MESSAGES auto-fill, and amber deposit link bar wired into the booking detail page header**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-11T10:31:49Z
- **Completed:** 2026-03-11T10:33:56Z
- **Tasks:** 2 of 3 complete (Task 3 is checkpoint:human-verify, awaiting browser verification)
- **Files modified:** 3 (nlt-admin repo)

## Accomplishments
- useUpdateVipBookingStatus mutation hook added to useVipBookingDetail.ts — PATCH request, invalidates both vip-bookings list and vip-booking-detail caches, shows toast on success/error
- VipUpdateStatusDialog component created with 6-status VALID_TRANSITIONS map (terminal statuses have empty arrays), DEFAULT_STATUS_MESSAGES auto-fill via useEffect, status/status_message/change_note form fields, form resets on close and successful submit
- VipBookingDetail updated with "Update Status" button (hidden for confirmed/rejected/cancelled), amber deposit link bar for deposit_required bookings with Stripe checkout URL as clickable external link and deposit status display

## Task Commits

Each task was committed atomically in the nlt-admin repository:

1. **Task 1: Add useUpdateVipBookingStatus hook and create VipUpdateStatusDialog component** - `aef82b4` (feat)
2. **Task 2: Wire VipUpdateStatusDialog into VipBookingDetail page and render deposit link** - `3ea87ae` (feat)

Task 3 (checkpoint:human-verify) — awaiting browser verification.

## Files Created/Modified

**Created:**
- `src/components/vip/VipUpdateStatusDialog.tsx` - Status update dialog with VALID_TRANSITIONS, DEFAULT_STATUS_MESSAGES, status/status_message/change_note form, en/ja i18n

**Modified:**
- `src/hooks/useVipBookingDetail.ts` - Added useUpdateVipBookingStatus mutation hook (useMutation + useQueryClient + toast)
- `src/components/vip/VipBookingDetail.tsx` - Update Status button in header, deposit link amber bar, VipUpdateStatusDialog integration

## Decisions Made

- useUpdateVipBookingStatus lives in useVipBookingDetail.ts rather than a new file — both hooks share the same query key context and naturally belong together
- Dialog form resets on both close (handleOpenChange) and successful submit to prevent stale state if admin reopens
- Deposit link bar placed between the header row and Separator for immediate visual prominence before info cards
- VipUpdateStatusDialog rendered unconditionally inside component return (with open controlled by state) rather than conditionally — avoids potential hook ordering issues

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None for this plan. See 08-01-SUMMARY.md for Stripe/Resend env var requirements still pending.

## Next Phase Readiness

- Status update UI complete and awaiting browser verification (Task 3 checkpoint)
- After Task 3 approved: Phase 08 is done, ready for Phase 09 (cleanup, gated on 48h production operation)

---
*Phase: 08-status-update-with-stripe-and-resend*
*Completed: 2026-03-11*
