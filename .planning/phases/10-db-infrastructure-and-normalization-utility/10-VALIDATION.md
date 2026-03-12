---
phase: 10
slug: db-infrastructure-and-normalization-utility
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 10 — Validation Strategy

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
- **After every plan wave:** Run `npm test` + manual SQL verification of DB-01 through DB-04
- **Before `/gsd:verify-work`:** Full suite must be green + all DB verification SQL statements pass
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | DB-01 | manual | SQL: `SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm')` | N/A (DB-only) | ⬜ pending |
| 10-01-02 | 01 | 1 | DB-02 | manual | SQL: `SELECT f_unaccent('CÉ LA VI')` | N/A (DB-only) | ⬜ pending |
| 10-01-03 | 01 | 1 | DB-03 | manual | SQL: `EXPLAIN ANALYZE SELECT ...` | N/A (DB-only) | ⬜ pending |
| 10-01-04 | 01 | 1 | DB-04 | manual | SQL: `SELECT * FROM search_venues_fuzzy('<tokyo_id>', 'celavi', 0.15, 10)` | N/A (DB-only) | ⬜ pending |
| 10-02-01 | 02 | 1 | NORM-01 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | NORM-02 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 10-02-03 | 02 | 1 | NORM-03 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 10-02-04 | 02 | 1 | NORM-04 | unit | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/utils/normalize.test.ts` — stubs for NORM-01 through NORM-04 with exact test cases:
  - `normalizeQuery('CeLaVi')` → `'celavi'`
  - `normalizeQuery('1oak')` → `'1oak'`
  - `normalizeQuery('é')` → `'e'`
  - `normalizeQuery('CÉ LA VI')` → `'celavi'` (accent + space)
  - `stripAccents('CÉ LA VI')` → `'CE LA VI'` (spaces preserved)

*No framework install needed — `node:test` is built-in and already used in `src/utils/recommendationFeatures.test.ts`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Extensions enabled | DB-01 | DB-level check, not callable from app code | Run `SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm')` in Supabase SQL editor |
| f_unaccent works | DB-02 | DB function, tested via SQL | Run `SELECT f_unaccent('CÉ LA VI')` — expect `'ce la vi'` |
| GIN index active | DB-03 | Requires `EXPLAIN ANALYZE` in DB | Run explain on venue name query, confirm Index Scan not Seq Scan |
| Fuzzy RPC callable | DB-04 | DB RPC, tested via SQL | Run `SELECT * FROM search_venues_fuzzy('<tokyo_id>', 'celavi', 0.15, 10)` — expect CÉ LA VI row |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
