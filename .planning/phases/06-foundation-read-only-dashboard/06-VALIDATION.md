---
phase: 6
slug: foundation-read-only-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) + manual browser testing |
| **Config file** | none — run via `tsx --test` |
| **Quick run command** | `cd /Users/alcylu/Apps/nlt-admin && npm run build` |
| **Full suite command** | `cd /Users/alcylu/Apps/nlt-admin && npm run build && npm run test:regressions` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd /Users/alcylu/Apps/nlt-admin && npm run build`
- **After every plan wave:** Run `cd /Users/alcylu/Apps/nlt-admin && npm run build && npm run test:regressions`
- **Before `/gsd:verify-work`:** Full suite must be green + manual browser walkthrough
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | AUTH-01, AUTH-02, AUTH-03 | smoke + manual | `curl -H "Auth..." /api/vip/bookings` | ❌ W0 | ⬜ pending |
| 6-02-01 | 02 | 1 | DASH-01, DASH-05 | manual | Visit /vip as admin | N/A | ⬜ pending |
| 6-02-02 | 02 | 1 | DASH-02, DASH-03, DASH-04 | manual | Use filters on /vip | N/A | ⬜ pending |
| 6-02-03 | 02 | 1 | DASH-06 | manual | Verify agent task badges | N/A | ⬜ pending |
| 6-02-04 | 02 | 1 | DASH-07 | manual | Set impossible filters | N/A | ⬜ pending |
| 6-02-05 | 02 | 1 | DASH-08 | manual | Wait 60s, observe refresh | N/A | ⬜ pending |
| 6-03-01 | 03 | 2 | DETAIL-01 | manual | Click booking row | N/A | ⬜ pending |
| 6-03-02 | 03 | 2 | DETAIL-02 | manual | Verify timeline | N/A | ⬜ pending |
| 6-03-03 | 03 | 2 | DETAIL-03 | manual | Verify audit log | N/A | ⬜ pending |
| 6-03-04 | 03 | 2 | DETAIL-04 | manual | Verify task badge on detail | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/types/vip.ts` — VIP type definitions ported from nightlife-mcp
- [ ] Smoke test script for API auth (manual curl instructions)

*Note: nlt-admin uses Node.js built-in test runner for unit tests, but this phase is UI-heavy. Validation is primarily manual browser testing + TypeScript build checks.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| VIP pages redirect non-admins | AUTH-01 | UI routing behavior | Log in as event_organizer, navigate to /vip, verify redirect |
| VIP nav hidden for non-admins | AUTH-03 | Visual check | Log in as event_organizer, verify no VIP nav item |
| Booking list with status badges | DASH-01 | Visual rendering | Visit /vip as admin, verify table + badges |
| Status multi-select filter | DASH-02 | Interactive filter | Select "confirmed", verify list narrows |
| Date range filter | DASH-03 | Interactive filter | Set date range, verify list narrows |
| Search by name/email/phone | DASH-04 | Interactive search | Type customer name, verify results |
| Venue filter | DASH-05 | Interactive filter | Select venue from dropdown, verify results |
| Agent task badges on rows | DASH-06 | Visual check | Verify badge on rows with agent tasks |
| Empty state with clear-filters CTA | DASH-07 | Visual + interactive | Set impossible filters, verify empty state + CTA |
| Auto-refresh every 60s | DASH-08 | Timing-dependent | Wait 60s, verify data refreshes without reload |
| Full booking detail | DETAIL-01 | Visual rendering | Click row, verify all customer/venue/table info |
| Status history timeline | DETAIL-02 | Visual rendering | Verify timeline entries with actor, timestamp, notes |
| Edit audit log | DETAIL-03 | Visual rendering | Verify field-level before/after values |
| Agent task on detail | DETAIL-04 | Visual check | Verify task status on detail page |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
