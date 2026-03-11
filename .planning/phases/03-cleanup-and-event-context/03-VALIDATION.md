---
phase: 3
slug: cleanup-and-event-context
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) via `tsx --test` |
| **Config file** | None — invoked via `npm test` = `tsx --test src/**/*.test.ts` |
| **Quick run command** | `npm test -- --test-name-pattern "vipPricing"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --test-name-pattern "vipPricing"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | VPRC-07 | unit | `npm test -- --test-name-pattern "event_name"` | W0 | pending |
| 3-01-02 | 01 | 1 | VPRC-07 | unit | `npm test -- --test-name-pattern "busy_night"` | W0 | pending |
| 3-01-03 | 01 | 1 | VPRC-08 | unit | `npm test -- --test-name-pattern "pricing_approximate"` | W0 | pending |
| 3-01-02 | 01 | 1 | LIFE-01 | manual smoke | Deploy + MCP call attempt | yes | pending |
| 3-fix | 01 | 1 | (fix) | unit | `npm test -- --test-name-pattern "closed venue"` | yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `src/services/vipPricing.test.ts` — add VPRC-07 tests (event_name, busy_night); add VPRC-08 tests (pricing_approximate); fix existing failing test
- [ ] `src/tools/vipTables.test.ts` — update `vipPricingOutputSchema` validation tests to include new fields

*Existing infrastructure covers framework needs — no new installs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Old tools absent from MCP server | LIFE-01 | Requires deployed server + MCP client | Deploy, call `get_vip_table_availability` — expect tool-not-found |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
