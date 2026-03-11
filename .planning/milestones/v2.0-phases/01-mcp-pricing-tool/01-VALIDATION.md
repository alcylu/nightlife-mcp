---
phase: 1
slug: mcp-pricing-tool
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) via `tsx --test` |
| **Config file** | None — invoked via `npm test` = `tsx --test src/**/*.test.ts` |
| **Quick run command** | `npm test -- --test-name-pattern "vipPricing"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --test-name-pattern "vipPricing"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | VPRC-01 | unit | `npm test -- --test-name-pattern "getVipPricing"` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | VPRC-02 | unit | `npm test -- --test-name-pattern "closed venue"` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | VPRC-03 | unit | `npm test -- --test-name-pattern "zone summary"` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | VPRC-04 | unit | `npm test -- --test-name-pattern "layout_image_url"` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 1 | VPRC-05 | unit | `npm test -- --test-name-pattern "pricing_configured"` | ❌ W0 | ⬜ pending |
| 1-01-06 | 01 | 1 | VPRC-06 | unit | `npm test -- --test-name-pattern "booking_supported"` | ❌ W0 | ⬜ pending |
| 1-01-07 | 01 | 1 | VPRC-09 | unit | `npm test -- --test-name-pattern "service.date"` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | LIFE-02 | unit | `npm test -- --test-name-pattern "tool description"` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | REST-01 | unit | `npm test -- --test-name-pattern "vipPricingOutputSchema"` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 2 | REST-02 | manual | Manual curl with/without API key | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/vipPricing.test.ts` — stubs for VPRC-01 through VPRC-06, VPRC-09
- [ ] `src/tools/vipTables.test.ts` — extend with `vipPricingOutputSchema` schema tests (REST-01, LIFE-02)
- [ ] No new framework install required — `node:test` + `tsx` already in place

*Existing infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auth middleware applies to `/venues/:id/vip-pricing` | REST-02 | Requires running HTTP server with real auth | 1. Start server with `npm run dev:http` 2. `curl localhost:3000/api/v1/venues/{id}/vip-pricing` without key → expect 401 3. `curl -H "x-api-key: {key}" localhost:3000/api/v1/venues/{id}/vip-pricing` → expect 200 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
