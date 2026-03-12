---
phase: 12-events-and-performers-normalization
plan: 01
subsystem: api
tags: [typescript, search, normalization, accents, unicode]

# Dependency graph
requires:
  - phase: 10-normalize-utility
    provides: normalizeQuery() and stripAccents() from src/utils/normalize.ts
  - phase: 11-venue-fuzzy-search
    provides: pattern for queryNeedle vs queryText separation in service layer
provides:
  - Accent-stripped cross-variant query matching in searchEvents() via matchQuery()
  - Accent-stripped cross-variant query matching in searchPerformers() via matchPerformerQuery()
  - Unit tests proving cross-accent normalization in events.test.ts and performers.test.ts
affects: [v3.0-fuzzy-search-milestone, search, events, performers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Separate queryText (sanitizeIlike for DB ILIKE) from queryNeedle (normalizeQuery for client-side filter)"
    - "normalizeQuery output passed as needle, stripAccents applied to each haystack value in client-side filter"
    - "Extracted inline filter predicates to named functions (matchPerformerQuery) for testability"
    - "__testOnly_ exports for pure functions that are not exported by default"

key-files:
  created:
    - src/services/events.test.ts
  modified:
    - src/services/events.ts
    - src/services/performers.ts
    - src/services/performers.test.ts

key-decisions:
  - "queryText (sanitizeIlike) preserved for DB ILIKE — no space-collapsing in DB queries where word boundary matching matters"
  - "queryNeedle (normalizeQuery) used only for client-side filter — accent-stripped, space-collapsed, lowercased"
  - "matchQuery haystacks normalized with stripAccents().toLowerCase().replace(/\\s+/g, '') to match normalizeQuery output"
  - "matchPerformerQuery extracted from inline .filter() to named function for unit testability and clarity"

patterns-established:
  - "Two-needle pattern: queryText for DB, queryNeedle for client filter — avoids space-collapse breaking DB word matching"
  - "Haystack normalization must mirror needle normalization: same stripAccents + space-collapse + lowercase pipeline"

requirements-completed: [EP-01, EP-02]

# Metrics
duration: 5min
completed: 2026-03-12
---

# Phase 12 Plan 01: Events and Performers Normalization Summary

**Accent-stripped, space-collapsed query normalization wired into events and performers services, so "shinjuku" matches "Shinjūku" and "celavi" matches "CE LA VI" in both search paths**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-12T11:54:59Z
- **Completed:** 2026-03-12T11:59:52Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extracted `matchPerformerQuery()` from inline `.filter()` in performers.ts — enables unit testing and clarity
- Wired `normalizeQuery()` into `searchEvents()` (queryNeedle) and `searchPerformers()` (queryNeedle), replacing `sanitizeIlike().toLowerCase()` in the client-side filter path
- Applied `stripAccents().toLowerCase().replace(/\s+/g, "")` to haystack values in both `matchQuery()` and `matchPerformerQuery()`, matching the normalizeQuery pipeline
- Preserved `sanitizeIlike` for all DB ILIKE paths (queryText in events, genre resolution in both services)
- 106 tests total: 105 pass, 1 pre-existing vipBookings failure (unrelated)

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — add failing normalization tests + test exports** - `aa3f933` (test)
2. **Task 2: GREEN — wire normalizeQuery + stripAccents into both services** - `f61117b` (feat)

_Note: TDD tasks have two commits (test RED → feat GREEN)_

## Files Created/Modified
- `src/services/events.test.ts` - 9 tests for matchQuery: 4 regression (same-case, empty query), 5 cross-accent (macron, space-collapsed)
- `src/services/events.ts` - Added normalizeQuery+stripAccents import; queryNeedle derived via normalizeQuery; matchQuery updated to normalize haystacks
- `src/services/performers.ts` - Added normalizeQuery+stripAccents import; queryNeedle via normalizeQuery; matchPerformerQuery extracted and updated to normalize haystacks
- `src/services/performers.test.ts` - 6 new tests: 4 regression, 2 cross-accent (macron, accented characters)

## Decisions Made
- Kept `queryText` (via `sanitizeIlike`) for DB ILIKE queries to preserve word-boundary matching behavior — collapsing spaces in DB queries would change behavior (e.g., "CE LA VI" → "celavi" would miss DB rows)
- Used `normalizeQuery` only for the client-side filter needle so both paths get the right normalization for their context
- Normalized haystacks with the same pipeline as normalizeQuery so accent-variant queries round-trip correctly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- v3.0 Fuzzy Search milestone complete: venues (Phase 11), events and performers (this phase) all support accent-normalized query matching
- Requirements EP-01 and EP-02 satisfied
- No blockers for next work

---
*Phase: 12-events-and-performers-normalization*
*Completed: 2026-03-12*
