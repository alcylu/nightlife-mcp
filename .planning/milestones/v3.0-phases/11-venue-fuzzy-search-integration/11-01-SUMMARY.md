---
phase: 11-venue-fuzzy-search-integration
plan: 01
subsystem: api
tags: [supabase-rpc, fuzzy-search, trigram, postgres, typescript, tdd]

# Dependency graph
requires:
  - phase: 10-db-infrastructure-and-normalization-utility
    provides: search_venues_fuzzy RPC deployed to production + normalizeQuery utility in src/utils/normalize.ts
provides:
  - Two-pass venue search with fuzzy fallback: exact/ilike pass first, RPC fallback when zero results
  - shouldAttemptFuzzy guard function (pure, fully tested, 5 unit tests)
  - fuzzyVenueIds helper wrapping search_venues_fuzzy RPC with normalizeQuery normalization
  - Fuzzy results preserve RPC word_similarity ordering (not re-ranked by event activity)
  - VIP hours synthetic occurrences merged into fuzzy path
affects: [12-event-performer-fuzzy-normalization, search_venues tool, REST /api/v1/venues]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Two-pass search: exact/ilike runs first, fuzzy RPC fires only on zero-result + query + no genre filter
    - Fuzzy ordering preserved via fuzzyIdOrder map (sorted by RPC position index, not re-ranked)
    - Early return from fuzzy path bypasses shared rankVenueSummaries() call
    - VIP hours synthetic rows filtered by fuzzyIdSet and merged before aggregation

key-files:
  created: []
  modified:
    - src/services/venues.ts
    - src/services/venues.test.ts

key-decisions:
  - "Early return from fuzzy path: fuzzy block returns its own paged response, never falls through to rankVenueSummaries() which would destroy similarity ordering"
  - "Fuzzy guard checks queryNeedle.trim().length (not queryNeedle.length) so whitespace-only queries are correctly blocked"
  - "normalizeQuery used (not sanitizeIlike) for RPC argument: collapses spaces + strips accents + lowercases for consistent DB matching"
  - "VIP hours synthetic occurrences included in fuzzy path to avoid showing zero upcoming_event_count for VIP venues that have no real events in window"

patterns-established:
  - "Two-pass guard pattern: shouldAttemptFuzzy(count, needle, genreIds) encapsulates all three conditions as pure function"
  - "Fuzzy aggregation loop omits queryNeedle filter (RPC already guarantees match) but preserves areaNeedle and vipBookingSupportedOnly filters"

requirements-completed: [VEN-01, VEN-02, VEN-03, VEN-04]

# Metrics
duration: 3min
completed: 2026-03-12
---

# Phase 11 Plan 01: Venue Fuzzy Search Integration Summary

**Two-pass fuzzy venue search: exact/ilike pass first, search_venues_fuzzy RPC fallback on zero results, with similarity-order-preserving aggregation and VIP hours integration**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-12T11:07:44Z
- **Completed:** 2026-03-12T11:10:59Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `shouldAttemptFuzzy` pure guard function with 5 unit tests covering all condition permutations (zero results, non-zero results, empty query, whitespace query, genre filter active)
- Wired `search_venues_fuzzy` RPC as a two-pass fallback in `searchVenues()` — fires only when pass 1 returns zero results AND a text query is present AND no genre filter is active
- Fuzzy results preserve the RPC's `word_similarity DESC` ordering via explicit `fuzzyIdOrder` map sort, bypassing `rankVenueSummaries()` which would re-rank by event activity
- VIP hours synthetic occurrences merged into fuzzy path so VIP venues show correct `upcoming_event_count` and `next_event_date`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add fuzzy fallback guard logic with tests** - `3405169` (test — TDD RED+GREEN)
2. **Task 2: Wire fuzzy RPC fallback into searchVenues()** - `902d3b8` (feat)

**Plan metadata:** *(to be committed)*

_Note: Task 1 is a TDD task — RED (failing import) confirmed before GREEN (function added)._

## Files Created/Modified
- `src/services/venues.ts` - Added `normalizeQuery` import, `fuzzyVenueIds()` helper, `shouldAttemptFuzzy()` function, fuzzy fallback block in `searchVenues()`, and `__testOnly_shouldAttemptFuzzy` export
- `src/services/venues.test.ts` - Added 5 unit tests for `shouldAttemptFuzzy` guard conditions

## Decisions Made
- **Early return on fuzzy path**: The fuzzy block computes its own `offset`/`limit`/`paged` and returns directly, bypassing the shared `rankVenueSummaries(summaries)` call. This is essential — `rankVenueSummaries` sorts by event activity count, which would destroy the RPC's `word_similarity DESC` ordering that makes "zeuk" → Zouk rank highest.
- **Whitespace guard via `.trim().length`**: The guard uses `queryNeedle.trim().length > 0` rather than `queryNeedle.length > 0` to catch whitespace-only strings like `"  "` before they reach the RPC.
- **`normalizeQuery` not `sanitizeIlike` for RPC input**: The RPC expects accent-stripped, space-collapsed, lowercased input. `sanitizeIlike` only removes commas/parens — the wrong normalization for trigram matching.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. The `search_venues_fuzzy` RPC was already deployed to production in Phase 10.

## Next Phase Readiness
- Phase 11 plan 01 complete. `search_venues` now handles accent variants, spacing differences, and 1-2 char typos via fuzzy fallback.
- Phase 12 (event/performer fuzzy normalization) can begin. That phase applies TypeScript-only `normalizeQuery` normalization to events and performers (no RPC needed — city+date already scopes those result sets).
- No blockers.

## Self-Check: PASSED
- FOUND: src/services/venues.ts
- FOUND: src/services/venues.test.ts
- FOUND: .planning/phases/11-venue-fuzzy-search-integration/11-01-SUMMARY.md
- FOUND commit: 3405169 (test — shouldAttemptFuzzy guard + 5 unit tests)
- FOUND commit: 902d3b8 (feat — fuzzy RPC fallback wired into searchVenues)

---
*Phase: 11-venue-fuzzy-search-integration*
*Completed: 2026-03-12*
