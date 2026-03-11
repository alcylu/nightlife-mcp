---
phase: 9
slug: cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (no jest/vitest) |
| **Config file** | none — invoked directly via tsx |
| **Quick run command** | `npm run check && npm test` |
| **Full suite command** | `npm run check && npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run check && npm test`
- **After every plan wave:** Run `npm run check && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | CLEAN-01 | typecheck | `npm run check` | n/a — deletion | ⬜ pending |
| 09-01-02 | 01 | 1 | CLEAN-01 | unit | `npm test` | ✅ (deleted tests no longer run) | ⬜ pending |
| 09-01-03 | 01 | 1 | CLEAN-02 | smoke | Manual curl or Playwright | n/a — route removal | ⬜ pending |
| 09-01-04 | 01 | 1 | CLEAN-03 | typecheck + unit | `npm run check && npm test` | ✅ venues.test.ts, performers.test.ts | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* No new test files needed for a deletion phase. The surviving tests in `venues.test.ts` and `performers.test.ts` automatically validate that config cleanup did not break the config shape.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/ops/*` routes return 404 | CLEAN-02 | Routes are being removed, not testable via unit test | Start local server, `curl localhost:3000/ops/login` — expect 404 or connection refused |
| `/api/v1/admin` routes return 404 | CLEAN-02 | Same as above | `curl localhost:3000/api/v1/admin/bookings` — expect 404 |
| Preserved routes still work | CLEAN-02 | Need running server | `curl localhost:3000/health` — expect 200; `curl localhost:3000/deposit/success` — expect page |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
