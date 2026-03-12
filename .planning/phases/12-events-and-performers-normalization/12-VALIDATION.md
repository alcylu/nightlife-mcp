---
phase: 12
slug: events-and-performers-normalization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test` + `node:assert/strict`) via `tsx` |
| **Config file** | none — configured via package.json script |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | EP-01 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | EP-01 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | EP-02 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | EP-02 | unit | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/__tests__/events-normalization.test.ts` — tests for EP-01: normalized needle + cross-accent matchQuery behavior
- [ ] `src/services/__tests__/performers-normalization.test.ts` — tests for EP-02: normalized needle + cross-accent filter behavior

*Note: performers.test.ts exists but lacks query normalization tests. events has no test file for this path.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end MCP tool call with accent query | EP-01, EP-02 | Requires running MCP server + Supabase | Call `search_events query="dua lipa"` and `search_performers query="shinjuku"` via MCP client |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
