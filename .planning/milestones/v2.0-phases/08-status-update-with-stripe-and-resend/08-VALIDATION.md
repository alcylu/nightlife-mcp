---
phase: 8
slug: status-update-with-stripe-and-resend
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner + manual browser testing |
| **Config file** | none |
| **Quick run command** | `cd /Users/alcylu/Apps/nlt-admin && npm run build` |
| **Full suite command** | Manual browser walkthrough per success criteria |
| **Estimated runtime** | ~30 seconds (build) + ~5 min (manual) |

---

## Sampling Rate

- **After every task commit:** Run `cd /Users/alcylu/Apps/nlt-admin && npm run build`
- **After every plan wave:** Manual smoke test — transition one booking through submitted → in_review → confirmed
- **Before `/gsd:verify-work`:** All 4 success criteria verified in browser
- **Max feedback latency:** 30 seconds (build check)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | MUTATE-01 | build | `npm run build` | ✅ | ⬜ pending |
| 08-01-02 | 01 | 1 | MUTATE-02 | build | `npm run build` | ✅ | ⬜ pending |
| 08-01-03 | 01 | 1 | MUTATE-03 | build | `npm run build` | ✅ | ⬜ pending |
| 08-02-01 | 02 | 1 | MUTATE-01 | manual | Browser: open detail, click Update Status | N/A | ⬜ pending |
| 08-02-02 | 02 | 1 | MUTATE-05 | manual | Browser: verify status_message field in form | N/A | ⬜ pending |
| 08-02-03 | 02 | 1 | MUTATE-02 | manual | Browser: transition to deposit_required, verify deposit link | N/A | ⬜ pending |
| 08-02-04 | 02 | 1 | MUTATE-03 | manual | Browser: verify email arrives after transition | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install stripe@^20.4.0 resend@^4.8.0` in nlt-admin
- [ ] Add `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `NIGHTLIFE_CONSUMER_URL` to `.env.example`
- [ ] Add `UpdateVipAdminBookingInput` and `VipAdminBookingUpdateResult` types to `src/types/vip.ts`
- [ ] Add `deposit_checkout_url: string | null` and `deposit_status: string | null` to `VipAdminBookingSummary`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin transitions booking through full pipeline | MUTATE-01 | Requires authenticated browser session + real Supabase | Open booking detail → Update Status → select each transition → verify |
| Stripe checkout session created on deposit_required | MUTATE-02 | Requires live Stripe API key | Transition to deposit_required → check Railway logs for Stripe session ID |
| Deposit link visible on detail page | MUTATE-02 | Visual UI verification | After deposit_required transition → verify link appears on detail page |
| Stripe failure non-blocking | MUTATE-02 | Requires invalid Stripe key scenario | Use invalid STRIPE_SECRET_KEY → verify status still updates |
| Email arrives on deposit_required/confirmed/rejected | MUTATE-03 | Requires live Resend API + real email | Transition with real email → verify email received |
| Resend failure non-blocking | MUTATE-03 | Requires invalid Resend key scenario | Use invalid RESEND_API_KEY → verify status still updates |
| status_message in rejection email | MUTATE-05 | Email content verification | Reject with custom message → verify message in email body |
| Terminal status disables Update Status button | MUTATE-01 | Visual UI verification | Open confirmed/rejected/cancelled booking → verify no Update Status button |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
