---
phase: 11
slug: venue-fuzzy-search-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 11-01-01 | 01 | 0 | VEN-01, VEN-02, VEN-03, VEN-04 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | VEN-01 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | VEN-02, VEN-03 | unit + manual | `npm test` | ❌ W0 | ⬜ pending |
| 11-01-04 | 01 | 1 | VEN-04 | unit | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/venues.test.ts` — add test stubs covering:
  - Two-pass guard: `summaries.length === 0 && queryNeedle && genreEventIds === null` — each condition individually
  - Genre-filter + query does NOT trigger fuzzy (genreEventIds !== null)
  - No-query path does NOT trigger fuzzy (queryNeedle is empty)
  - `fuzzyVenueIds` returns empty array for blank query
  - Fuzzy results preserve similarity-based ranking from RPC
  - City scoping — city_id passed correctly to RPC

*Existing test infrastructure and framework are in place — no new framework needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `search_venues query=celavi` returns CÉ LA VI | VEN-02 | Requires real DB with accent data | Call MCP tool against staging/production |
| `search_venues query=1oak` returns 1 OAK | VEN-02 | Requires real DB with venue data | Call MCP tool against staging/production |
| `search_venues query=zeuk` returns Zouk | VEN-02, VEN-03 | Requires real DB + fuzzy RPC | Call MCP tool against staging/production |
| No-query path unchanged | VEN-01 | Regression check against production | Compare `search_venues city=tokyo` results before/after |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
