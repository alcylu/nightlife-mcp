---
phase: 11
slug: venue-fuzzy-search-integration
status: draft
nyquist_compliant: true
wave_0_complete: true
wave_0_note: "Wave 0 tests are handled by Task 1's TDD behavior spec (tdd=true) — guard logic tests written before implementation"
created: 2026-03-12
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) + `node:assert/strict` |
| **Config file** | None — run via `tsx --test` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test` + manual smoke: `search_venues city=tokyo query=celavi`
- **Before `/gsd:verify-work`:** Full suite must be green + all 5 success criteria verified against production
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | VEN-01, VEN-02, VEN-03, VEN-04 | unit | `npm test` | Created by Task 1 (TDD) | pending |
| 11-01-02 | 01 | 1 | VEN-01, VEN-03 | unit | `npm run build && npm test` | Uses Task 1 tests | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

Wave 0 is handled by Task 1's TDD mode (`tdd="true"`). Task 1 writes the guard logic tests (RED) before implementing the guard function (GREEN). No separate Wave 0 step is needed.

Tests covering:
- Two-pass guard: `summaries.length === 0 && queryNeedle && genreEventIds === null` — each condition individually
- Genre-filter + query does NOT trigger fuzzy (genreEventIds !== null)
- No-query path does NOT trigger fuzzy (queryNeedle is empty)
- Whitespace-only query does NOT trigger fuzzy

*Existing test infrastructure and framework are in place — no new framework needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `search_venues query=celavi` returns CÉ LA VI | VEN-02 | Requires real DB with accent data | Call MCP tool against staging/production |
| `search_venues query=1oak` returns 1 OAK | VEN-02 | Requires real DB with venue data | Call MCP tool against staging/production |
| `search_venues query=zeuk` returns Zouk | VEN-02, VEN-03 | Requires real DB + fuzzy RPC | Call MCP tool against staging/production |
| Fuzzy results ordered by similarity (best match first) | VEN-03 | Requires real DB + multiple fuzzy matches | Call with ambiguous query, verify ordering |
| No-query path unchanged | VEN-01 | Regression check against production | Compare `search_venues city=tokyo` results before/after |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (handled by Task 1 TDD)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
