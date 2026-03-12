---
phase: 10-db-infrastructure-and-normalization-utility
plan: 02
subsystem: api
tags: [typescript, unicode, normalization, search, tdd]

# Dependency graph
requires: []
provides:
  - "src/utils/normalize.ts with normalizeQuery() and stripAccents() exports"
  - "Unit tests covering NORM-01 through NORM-04 (11 test cases)"
affects:
  - phase-11-venues-fuzzy-search
  - phase-12-events-performers-fuzzy-search

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NFD + diacritic strip + whitespace collapse + lowercase pipeline for search normalization"
    - "TDD with node:test and node:assert/strict (RED → GREEN commit pattern)"

key-files:
  created:
    - src/utils/normalize.ts
    - src/utils/normalize.test.ts
  modified: []

key-decisions:
  - "No npm packages — use String.prototype.normalize('NFD') + regex U+0300-U+036F for zero-dependency accent stripping"
  - "stripAccents exported separately so venues service can use accent-only normalization without collapsing spaces"

patterns-established:
  - "Normalization pipeline: stripAccents(raw).replace(/\\s+/g, '').toLowerCase() — single source of truth for all three fuzzy search phases"

requirements-completed: [NORM-01, NORM-02, NORM-03, NORM-04]

# Metrics
duration: 2min
completed: 2026-03-12
---

# Phase 10 Plan 02: Search Query Normalization Utility Summary

**Zero-dependency TypeScript normalization utility using NFD Unicode decomposition — strips accents, collapses spaces, lowercases — shared by all three fuzzy search phases**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-12T07:02:24Z
- **Completed:** 2026-03-12T07:04:44Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2 created

## Accomplishments

- Created `normalizeQuery()` — full pipeline for consistent search term matching (accent strip + space collapse + lowercase)
- Created `stripAccents()` — accent-only variant that preserves spaces and casing for DB-level matching in venues service
- 11 purpose-built test cases covering all 4 requirements (NORM-01 through NORM-04) plus edge cases
- 86/86 total project tests pass — zero regressions

## Task Commits

1. **TDD RED: Failing tests** - `9a48ea9` (test)
2. **TDD GREEN: Implementation** - `768eb82` (feat)

## Files Created/Modified

- `src/utils/normalize.ts` — `normalizeQuery()` and `stripAccents()` exports, 32 lines
- `src/utils/normalize.test.ts` — 11 test cases covering NORM-01 through NORM-04 plus edge cases, 53 lines

## Decisions Made

- No npm packages: `String.prototype.normalize('NFD')` + regex `/[\u0300-\u036f]/g` is the canonical Unicode solution. Zero runtime dependencies added.
- Exported `stripAccents` separately from `normalizeQuery` so venues service (Phase 11) can apply accent-only normalization without collapsing spaces when building DB ILIKE patterns.

## Deviations from Plan

Two migration files from Plan 01 (`20260312_fuzzy_search.sql`, `20260312_fuzzy_search_index.sql`) were staged but uncommitted from Plan 01's execution, and were inadvertently swept into the Plan 02 GREEN commit. The files themselves are correct Plan 01 artifacts — this is a commit hygiene issue only, not a functional problem. Both files contain the correct DB migration content for Phase 10 Plan 01.

**Total deviations:** 1 (minor — pre-existing unstaged files from Plan 01 included in Plan 02 feat commit)
**Impact on plan:** No functional impact. Migration files are correct. Commit message is Plan 02 scoped.

## Issues Encountered

None — plan executed cleanly. NFD normalization handles macrons (ō, ū, ā) natively, so the STATE.md concern about Japanese romanization was a non-issue.

## User Setup Required

None — no external service configuration required. This is a pure TypeScript utility.

## Next Phase Readiness

- `normalizeQuery` and `stripAccents` are ready to import in Phase 11 (venues fuzzy search) and Phase 12 (events/performers fuzzy search)
- Import path: `import { normalizeQuery, stripAccents } from "../utils/normalize.js"`
- No blockers

## Self-Check: PASSED

- src/utils/normalize.ts: FOUND
- src/utils/normalize.test.ts: FOUND
- 10-02-SUMMARY.md: FOUND
- Commit 9a48ea9 (test RED): FOUND
- Commit 768eb82 (feat GREEN): FOUND

---
*Phase: 10-db-infrastructure-and-normalization-utility*
*Completed: 2026-03-12*
