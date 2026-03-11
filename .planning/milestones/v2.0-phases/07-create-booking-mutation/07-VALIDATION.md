---
phase: 7
slug: create-booking-mutation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) + manual browser testing |
| **Config file** | None — run via `tsx --test` |
| **Quick run command** | `cd /Users/alcylu/Apps/nlt-admin && npm run build` |
| **Full suite command** | Manual browser walkthrough per success criteria |
| **Estimated runtime** | ~15 seconds (build), ~5 min (manual) |

---

## Sampling Rate

- **After every task commit:** Run `cd /Users/alcylu/Apps/nlt-admin && npm run build`
- **After every plan wave:** Manual smoke test — create booking form submit + verify list shows new booking
- **Before `/gsd:verify-work`:** All 3 success criteria verified in browser
- **Max feedback latency:** 15 seconds (build check)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | MUTATE-04 | smoke | `curl -X POST /api/vip/bookings -d '{}'` → expect 401 | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | MUTATE-04 | smoke | `curl -X POST ... -H "auth: <eo-token>"` → expect 403 | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | MUTATE-04 | manual | Navigate to /vip, click "New Booking", fill form, submit | N/A | ⬜ pending |
| 07-01-04 | 01 | 1 | MUTATE-04 | manual | After submit, verify row appears in list with "submitted" status | N/A | ⬜ pending |
| 07-01-05 | 01 | 1 | MUTATE-06 | manual | Fill internal note, submit, verify in booking detail | N/A | ⬜ pending |
| 07-01-06 | 01 | 1 | MUTATE-07 | manual | Fill change note, submit, verify in status history timeline | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Add `CreateVipAdminBookingInput` and `VipBookingCreateResult` types to `src/types/vip.ts`
- [ ] Smoke test script for POST auth (manual curl instructions)

*Note: Phase 7 is mutation-only with no pure-logic functions suitable for unit testing. Validation is primarily manual browser testing + TypeScript build check.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin can submit create form with all required fields | MUTATE-04 | Full UI form interaction | Navigate to /vip → "New Booking" → fill all fields → submit |
| Submitted booking appears in list | MUTATE-04 | Requires DB round-trip + list refresh | After submit, verify new row in booking list |
| Internal note saves correctly | MUTATE-06 | No unit-testable logic, UI-to-DB flow | Fill internal note → submit → open detail → verify note present |
| Change note appears in Status History | MUTATE-07 | Requires status timeline UI verification | Fill change note → submit → open detail → check timeline |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
