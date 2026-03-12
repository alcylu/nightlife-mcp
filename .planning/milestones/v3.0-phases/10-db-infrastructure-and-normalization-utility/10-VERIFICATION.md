---
phase: 10-db-infrastructure-and-normalization-utility
verified: 2026-03-12T09:00:00Z
status: human_needed
score: 7/8 must-haves verified
re_verification: false
human_verification:
  - test: "DB-01: Verify pg_trgm and unaccent extensions are enabled in production"
    expected: "SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm') returns 2 rows"
    why_human: "DB-level state cannot be queried from application code. Requires Supabase SQL editor access."
  - test: "DB-02: Verify f_unaccent strips accents in production"
    expected: "SELECT f_unaccent('CE LA VI') returns 'CE LA VI' and SELECT f_unaccent('CÉ LA VI') returns lowercase 'ce la vi'"
    why_human: "DB function behavior cannot be tested from application code."
  - test: "DB-03: Verify GIN index is active and used by query planner"
    expected: "EXPLAIN ANALYZE SELECT * FROM venues WHERE f_unaccent(lower(name_en)) ILIKE '%celavi%' LIMIT 1 shows Bitmap Index Scan on venues_name_en_fuzzy, NOT Seq Scan"
    why_human: "Index usage requires EXPLAIN ANALYZE in the database."
  - test: "DB-04: Verify search_venues_fuzzy RPC returns correct rows"
    expected: "SELECT id, name_en FROM search_venues_fuzzy('<tokyo_city_id>', 'celavi', 0.15, 10) returns CE LA VI row; same RPC with '1oak' returns 1 OAK row"
    why_human: "RPC callability and result correctness can only be verified directly in Supabase SQL editor."
gaps:
  - truth: "NORM-03 as written in REQUIREMENTS.md requires number-word equivalence ('1oak' matches 'oneoak')"
    status: partial
    reason: "REQUIREMENTS.md states NORM-03 as 'Number-word equivalence — 1oak matches oneoak, 1 OAK matches one oak'. The plan deliberately narrowed this to 'digits preserved' (normalizeQuery('1oak') -> '1oak'), with no digit-to-word mapping implemented. The normalize.ts utility has no number-word conversion. The RESEARCH doc explicitly flagged this as potentially over-specified and recommended deferring to Phase 11 testing."
    artifacts:
      - path: "src/utils/normalize.ts"
        issue: "No digit-to-word mapping (1 -> one, 2 -> two, etc.). normalizeQuery('1oak') returns '1oak', not 'oneoak' and vice versa."
    missing:
      - "Clarification: Accept narrowed interpretation (digits preserved = satisfied) OR add digit-to-word mapping to normalizeQuery(). This is a scoping decision, not a code defect — the plan's intent was documented in RESEARCH.md."
---

# Phase 10: DB Infrastructure and Normalization Utility Verification Report

**Phase Goal:** The database extensions, immutable wrapper function, GIN trigram index, and fuzzy search RPC are deployed to production, and the shared TypeScript normalization utility is written and tested — giving the venues service (Phase 11) everything it needs to call the RPC and giving events/performers (Phase 12) the utility to import.
**Verified:** 2026-03-12
**Status:** human_needed (DB state requires human verification; NORM-03 scoping gap flagged)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | pg_trgm and unaccent extensions are enabled in Supabase production | ? HUMAN | Cannot verify DB state programmatically. SUMMARY claims all 4 DB checks passed — requires human confirmation in Supabase SQL editor. |
| 2 | f_unaccent('CE LA VI') returns 'CE LA VI' with accents stripped | ? HUMAN | DB function. SUMMARY claims verified 2026-03-12. Requires human re-confirmation or trust in SUMMARY. |
| 3 | GIN trigram index exists on venues.name_en and uses Index Scan (not Seq Scan) | ? HUMAN | DB state. SUMMARY claims Bitmap Index Scan confirmed at 1.6ms. Requires human verification. |
| 4 | search_venues_fuzzy RPC returns correct venue for 'celavi' and '1oak' | ? HUMAN | DB RPC. SUMMARY claims both queries passed. Requires human confirmation. |
| 5 | normalizeQuery strips accents: 'e' becomes 'e', 'o' becomes 'o' | VERIFIED | npm test: 3 accent tests pass (é, o, ü). All 86 tests green. |
| 6 | normalizeQuery collapses spaces: 'CE LA VI' becomes 'celavi' | VERIFIED | npm test: space collapse tests pass ('CÉ LA VI' -> 'celavi', '1 OAK' -> '1oak'). |
| 7 | normalizeQuery lowercases: 'CeLaVi' becomes 'celavi' | VERIFIED | npm test: NORM-04 test passes. |
| 8 | normalizeQuery preserves digits: '1oak' stays '1oak' | VERIFIED | npm test: NORM-03 digit preservation test passes. normalizeQuery('1oak') -> '1oak'. |
| 9 | stripAccents removes accents but preserves spaces: 'CE LA VI' becomes 'CE LA VI' | VERIFIED | npm test: stripAccents test passes ('CÉ LA VI' -> 'CE LA VI', 'Shinjuku' -> 'Shinjuku'). |

**Automated Score:** 5/5 TypeScript truths VERIFIED. 4/4 DB truths require human confirmation.
**Overall Score:** 7/8 plan-defined must-haves verified (normalize.ts fully verified; DB state verified per SUMMARY but cannot be confirmed programmatically).

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260312_fuzzy_search.sql` | Extensions + f_unaccent wrapper + search_venues_fuzzy RPC | VERIFIED | Exists, 51 lines. Contains `CREATE OR REPLACE FUNCTION public.f_unaccent`, `CREATE EXTENSION IF NOT EXISTS unaccent`, `CREATE EXTENSION IF NOT EXISTS pg_trgm`, and full `search_venues_fuzzy` RPC with three-arm WHERE clause. |
| `supabase/migrations/20260312_fuzzy_search_index.sql` | GIN trigram index on normalized venue name_en | VERIFIED | Exists, 19 lines. Contains `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_name_en_fuzzy`. Non-transactional with explicit warning comment. |
| `src/utils/normalize.ts` | normalizeQuery() and stripAccents() exports | VERIFIED | Exists, 32 lines (min_lines: 15 satisfied). Both functions exported. Uses NFD + diacritic strip pipeline. No dependencies. |
| `src/utils/normalize.test.ts` | Unit tests covering NORM-01 through NORM-04 | VERIFIED | Exists, 53 lines (min_lines: 20 satisfied). 11 test cases covering NORM-01 (3 tests), NORM-02 (2 tests), NORM-03 (1 test), NORM-04 (1 test), edge cases (2 tests), stripAccents (2 tests). All 86 project tests pass. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `20260312_fuzzy_search.sql` | `20260312_fuzzy_search_index.sql` | `f_unaccent(lower(name_en))` expression must be identical | VERIFIED | Both files use exactly `f_unaccent(lower(name_en))` — verified by grep. File 1 comment explicitly states "f_unaccent must exist before the GIN index references it." |
| `search_venues_fuzzy RPC` WHERE clause | GIN index expression | Expression must match exactly for planner to use index | VERIFIED | RPC uses `f_unaccent(lower(v.name_en))` in WHERE and ORDER BY (lines 45-49 of migration). Index uses `f_unaccent(lower(name_en))` (line 19 of index migration). Column reference differs only by table alias `v.` which is correct — both resolve to the same expression. |
| `src/utils/normalize.test.ts` | `src/utils/normalize.ts` | imports normalizeQuery, stripAccents | VERIFIED | Line 3: `import { normalizeQuery, stripAccents } from "./normalize.js"` — matches plan key_link pattern exactly. |
| `src/utils/normalize.ts` | Phase 11 / Phase 12 services | Will be imported by venues.ts, events.ts, performers.ts | ORPHANED (expected) | No current consumers outside the test file — Phase 11 and 12 are not yet built. This is by design: Phase 10 creates the shared utility for downstream phases. Not a defect. |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DB-01 | 10-01-PLAN.md | pg_trgm and unaccent extensions enabled | ? HUMAN | Migration SQL exists and is correct. Production deployment verified per SUMMARY (2 rows returned). Requires human confirmation. |
| DB-02 | 10-01-PLAN.md | IMMUTABLE f_unaccent wrapper created | ? HUMAN | `CREATE OR REPLACE FUNCTION public.f_unaccent` with schema-qualified dictionary form exists in migration. DB function behavior requires human confirmation. |
| DB-03 | 10-01-PLAN.md | GIN trigram index on normalized venue names (CONCURRENTLY) | ? HUMAN | `CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_name_en_fuzzy` in correct file. Index active per SUMMARY (Bitmap Index Scan at 1.6ms). Requires human confirmation. |
| DB-04 | 10-01-PLAN.md | search_venues_fuzzy RPC with word_similarity and configurable threshold | ? HUMAN | Full RPC exists in migration with correct signature and three-arm WHERE clause. Callability confirmed per SUMMARY. Requires human confirmation. |
| NORM-01 | 10-02-PLAN.md | Accent-insensitive: é->e, o->o | SATISFIED | Tests pass: `normalizeQuery('é') -> 'e'`, `normalizeQuery('o') -> 'o'`, `normalizeQuery('ü') -> 'u'`. |
| NORM-02 | 10-02-PLAN.md | Space/punctuation normalization — celavi matches CE LA VI, 1oak matches 1 OAK | SATISFIED | Tests pass: `normalizeQuery('CÉ LA VI') -> 'celavi'`, `normalizeQuery('1 OAK') -> '1oak'`. |
| NORM-03 | 10-02-PLAN.md | Number-word equivalence | PARTIAL | Plan narrowed NORM-03 to "digits preserved" (`normalizeQuery('1oak') -> '1oak'`). REQUIREMENTS.md definition includes "1oak matches oneoak" which is NOT implemented. RESEARCH.md explicitly deferred this as potentially over-specified. See Gaps section. |
| NORM-04 | 10-02-PLAN.md | Case-insensitive matching | SATISFIED | Test passes: `normalizeQuery('CeLaVi') -> 'celavi'`. |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns found in any phase artifact. No TODO/FIXME/placeholder comments. No stub implementations. No empty handlers. |

---

## Human Verification Required

### 1. DB-01: Extensions Enabled

**Test:** Run in Supabase SQL editor (project nqwyhdfwcaedtycojslb):
```sql
SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm');
```
**Expected:** 2 rows returned (one for 'unaccent', one for 'pg_trgm')
**Why human:** Database extension state cannot be queried from application code or git history.

### 2. DB-02: f_unaccent Works Correctly

**Test:** Run in Supabase SQL editor:
```sql
SELECT f_unaccent('CÉ LA VI');
SELECT f_unaccent('ō'), f_unaccent('ü'), f_unaccent('ā');
```
**Expected:** First query returns `'ce la vi'` (lowercase + accents stripped). Second query returns `'o'`, `'u'`, `'a'` (macrons/umlauts stripped).
**Why human:** DB function behavior, not testable from app code.

### 3. DB-03: GIN Index Active and Used

**Test:** Run in Supabase SQL editor:
```sql
SELECT indexname FROM pg_stat_user_indexes WHERE tablename = 'venues' AND indexname = 'venues_name_en_fuzzy';
EXPLAIN ANALYZE SELECT * FROM venues WHERE f_unaccent(lower(name_en)) ILIKE '%celavi%' LIMIT 1;
```
**Expected:** First query returns 1 row. Second query shows "Bitmap Index Scan on venues_name_en_fuzzy" or "Index Scan" — NOT "Seq Scan on venues".
**Why human:** Index existence and query planner behavior require direct DB access.

### 4. DB-04: search_venues_fuzzy RPC Callable

**Test:** Run in Supabase SQL editor:
```sql
-- First get the Tokyo city_id:
SELECT id FROM public.cities WHERE slug = 'tokyo';
-- Then use the returned UUID:
SELECT id, name_en FROM search_venues_fuzzy('<tokyo_city_id>', 'celavi', 0.15, 10);
SELECT id, name_en FROM search_venues_fuzzy('<tokyo_city_id>', '1oak', 0.15, 10);
```
**Expected:** First fuzzy query returns a row with name_en = 'CÉ LA VI'. Second returns a row with name_en containing '1 OAK' or '1 Oak'.
**Why human:** RPC callability and result correctness require direct database access.

---

## Gaps Summary

### Gap 1: NORM-03 Scope Narrowing (Scoping Decision Needed)

**REQUIREMENTS.md** defines NORM-03 as: "Number-word equivalence — '1oak' matches 'oneoak', '1 OAK' matches 'one oak'."

**What was implemented:** The plan re-interpreted NORM-03 as "digits preserved" — `normalizeQuery('1oak')` returns `'1oak'` (correct). No number-to-word conversion (1 -> one) was added to `normalizeQuery()`.

**What this means:** A user query of "oneoak" will NOT match the venue "1 OAK" via the TypeScript utility. The DB RPC's trigram arm may catch some of these fuzzy misses since "oneoak" and "1oak" are similar strings, but it is not guaranteed.

**RESEARCH.md comment (Open Question 1):** "Implement space/accent normalization for Phase 10. Add a digit-to-word mapping step in normalizeQuery() as an optional enhancement. Document as a gap and test with 'oneoak' after Phase 11 — if it's a real-world miss, add the mapping."

**Recommended resolution:** Two options:
1. Accept narrowed interpretation — REQUIREMENTS.md was over-specified for v3.0, and the plan's intent is documented. Mark NORM-03 as satisfied with the narrower definition. The trigram similarity in the DB RPC provides a partial safety net.
2. Add digit-to-word mapping — add a 5-line conversion step to `normalizeQuery()` in `normalize.ts` and a corresponding test case. No DB changes needed.

This is a product/scoping decision for Allen, not a code defect. The existing implementation is correct for what was planned.

---

## Code Quality Notes

- **Build:** `npm run build` (TypeScript compilation) passes with zero errors.
- **Tests:** 86/86 pass. All 11 normalize tests pass. Zero regressions in existing test suite.
- **Commits documented:** TDD pattern confirmed — commit `9a48ea9` (failing tests RED) precedes commit `768eb82` (implementation GREEN). Both commits exist and contain the documented files.
- **Architecture:** No new npm dependencies added. Zero-dependency approach confirmed. NFD + regex is the canonical Unicode solution.
- **Key link integrity:** `f_unaccent(lower(...))` expression is identical in both migration files — critical for query planner to use the GIN index.

---

_Verified: 2026-03-12_
_Verifier: Claude (gsd-verifier)_
