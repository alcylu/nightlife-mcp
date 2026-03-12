---
phase: 10-db-infrastructure-and-normalization-utility
plan: 01
subsystem: database
tags: [postgres, pg_trgm, unaccent, gin-index, supabase, fuzzy-search, rpc]

# Dependency graph
requires: []
provides:
  - "supabase/migrations/20260312_fuzzy_search.sql: pg_trgm + unaccent extensions, f_unaccent() IMMUTABLE wrapper, search_venues_fuzzy RPC"
  - "supabase/migrations/20260312_fuzzy_search_index.sql: GIN trigram index on venues.name_en (CONCURRENTLY, non-transactional)"
affects:
  - "11-fuzzy-venue-search"
  - "12-events-performers-normalization"

# Tech tracking
tech-stack:
  added: ["pg_trgm (PostgreSQL extension)", "unaccent (PostgreSQL extension)"]
  patterns:
    - "Two-file migration split for CONCURRENTLY indexes (transactional + non-transactional)"
    - "IMMUTABLE f_unaccent() wrapper using schema-qualified dictionary form: SELECT public.unaccent('public.unaccent', $1)"
    - "Three-arm RPC WHERE clause: word_similarity + ILIKE + space-stripped ILIKE"

key-files:
  created:
    - "supabase/migrations/20260312_fuzzy_search.sql"
    - "supabase/migrations/20260312_fuzzy_search_index.sql"
  modified: []

key-decisions:
  - "Split migration into two files: transactional (extensions + functions) and non-transactional (CONCURRENTLY index) — required by PostgreSQL constraint that CONCURRENTLY cannot run inside a transaction block"
  - "f_unaccent body uses schema-qualified dictionary form (public.unaccent('public.unaccent', $1)) not simple unaccent($1) — satisfies IMMUTABLE contract required for index expressions"
  - "word_similarity chosen over similarity — short queries like 'celavi' score higher against 'ce la vi' with word_similarity (partial subset scoring)"
  - "Expression f_unaccent(lower(name_en)) identical in both index and RPC WHERE/ORDER BY — different order breaks index usage by query planner"

patterns-established:
  - "Pattern: CONCURRENTLY indexes always go in separate non-transactional migration file"
  - "Pattern: f_unaccent(lower(column)) — always unaccent after lower, never lower(f_unaccent(column)) — index and query must use identical expression"

requirements-completed: [DB-01, DB-02, DB-03, DB-04]

# Metrics
duration: 15min
completed: 2026-03-12
---

# Phase 10 Plan 01: Fuzzy Search DB Infrastructure Summary

**pg_trgm + unaccent extensions, IMMUTABLE f_unaccent() wrapper, GIN trigram index on venues.name_en, and search_venues_fuzzy RPC — deployed and verified in Supabase production (all 4 DB checks passed, macrons strip correctly)**

## Performance

- **Duration:** ~15 min (code) + production deployment
- **Started:** 2026-03-12T07:02:25Z
- **Completed:** 2026-03-12
- **Tasks:** 2 of 2 complete
- **Files created:** 2 SQL migration files

## Accomplishments

- Two SQL migration files written with exact verified patterns from research doc and deployed to production
- File 1 (transactional): enables `pg_trgm` + `unaccent` extensions, creates `f_unaccent()` IMMUTABLE wrapper using schema-qualified dictionary form, creates `search_venues_fuzzy` RPC with three-arm WHERE clause
- File 2 (non-transactional): creates `venues_name_en_fuzzy` GIN trigram index using `CONCURRENTLY` — safe on shared DB with nightlife-tokyo-next (no table lock)
- Expression `f_unaccent(lower(name_en))` is identical in both files — ensures query planner uses the index
- All 4 DB verification checks passed: extensions enabled, f_unaccent strips accents, GIN index uses Bitmap Index Scan (not Seq Scan, 1.6ms), fuzzy RPC returns correct venue for 'celavi' and '1oak'
- Macron stripping confirmed: ō→o, ü→u, ā→a all normalize correctly — no custom unaccent rules needed

## Task Commits

1. **Task 1: Write SQL migration files for fuzzy search infrastructure** - `768eb82` (feat)
2. **Task 2: Apply migrations to Supabase production and verify** - human-action (no code commit — production DB deployment, all 4 verification queries passed)

Note: Migration files were committed in prior session alongside `normalize.ts` (10-02 work that was pre-staged). Both files match the plan exactly.

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `supabase/migrations/20260312_fuzzy_search.sql` — Extensions (pg_trgm, unaccent), IMMUTABLE f_unaccent() wrapper, search_venues_fuzzy RPC
- `supabase/migrations/20260312_fuzzy_search_index.sql` — GIN trigram index on venues.name_en using CONCURRENTLY (non-transactional)

## Decisions Made

- Split migration into two files because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block (PostgreSQL hard constraint). File 1 runs normally; File 2 must be run via Supabase SQL editor or psql with autocommit.
- Used `word_similarity()` not `similarity()` — short queries like "celavi" score poorly against "ce la vi" with `similarity` (full set comparison), but score well with `word_similarity` (subset comparison). Threshold 0.15 with ILIKE fallback arms.
- Canonical expression order `f_unaccent(lower(column))` — strip accents after lowercasing. Must be identical in index definition and RPC WHERE/ORDER BY or the planner ignores the index.

## Deviations from Plan

None — plan executed exactly as written. Migration files match the verified code examples from the research document verbatim.

## Issues Encountered

Migration files were already committed in a prior session (commit `768eb82`) bundled with `normalize.ts`. Files matched the plan exactly — no rework needed.

## User Setup Required

None — production deployment complete. All migrations applied and verified 2026-03-12.

## Next Phase Readiness

- All 4 DB requirements verified in production — Phase 11 can begin immediately
- Phase 11 (venue fuzzy search wiring): `search_venues_fuzzy` RPC is live and callable; GIN index active; venues service can use two-pass strategy
- Phase 12 (events/performers normalization): pg_trgm and unaccent extensions are enabled; TypeScript normalize utility is ready (10-02)
- No blockers — macron handling confirmed working (ō→o, ü→u, ā→a)

## Production Verification Results (Task 2)

All 4 DB requirements verified 2026-03-12 in Supabase SQL editor (project nqwyhdfwcaedtycojslb):

- **DB-01:** `SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm')` → 2 rows (both extensions enabled)
- **DB-02:** `SELECT f_unaccent('CÉ LA VI')` → `CE LA VI` (accent stripping works)
- **DB-03:** EXPLAIN ANALYZE shows Bitmap Index Scan on venues_name_en_fuzzy (1.6ms — not Seq Scan)
- **DB-04:** `search_venues_fuzzy(..., 'celavi', 0.15, 10)` → CÉ LA VI row; `search_venues_fuzzy(..., '1oak', 0.15, 10)` → 1 Oak row
- **Macron test:** ō→o, ü→u, ā→a all strip correctly — no custom unaccent rules needed

## Self-Check: PASSED

- supabase/migrations/20260312_fuzzy_search.sql: FOUND
- supabase/migrations/20260312_fuzzy_search_index.sql: FOUND
- .planning/phases/10-db-infrastructure-and-normalization-utility/10-01-SUMMARY.md: FOUND
- Commit 768eb82 (migration files): FOUND
- Commit b61de30 (docs metadata): FOUND

---
*Phase: 10-db-infrastructure-and-normalization-utility*
*Completed: 2026-03-12*
