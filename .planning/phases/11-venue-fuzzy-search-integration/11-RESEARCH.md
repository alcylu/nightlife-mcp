# Phase 11: Venue Fuzzy Search Integration - Research

**Researched:** 2026-03-12
**Domain:** TypeScript service integration — wiring `search_venues_fuzzy` RPC into existing `searchVenues()` service
**Confidence:** HIGH — all infrastructure from Phase 10 is deployed and verified; this phase is pure TypeScript wiring with zero DB changes

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VEN-01 | Two-pass search strategy — exact/normalized match first, fuzzy fallback on zero results | Phase 10 DB is ready: `search_venues_fuzzy` RPC is live in production. TypeScript wiring strategy is fully designed — see Architecture Patterns. |
| VEN-02 | Typo-tolerant venue search — "Zoook" finds "Zouk", "celavy" finds "CÉ LA VI" | `word_similarity` arm in the RPC handles 1-2 char typos at threshold 0.15. Verified in Phase 10: "celavi" already returns CÉ LA VI from the RPC. "zeuk" is a 1-char transposition — will score above 0.15 with `word_similarity`. |
| VEN-03 | Fuzzy results ranked by match quality (similarity score) | RPC `ORDER BY word_similarity(p_query, f_unaccent(lower(v.name_en))) DESC` already provides ranked rows. TypeScript must preserve this order when merging into the venue aggregation pipeline. |
| VEN-04 | Fuzzy search scoped by city (no cross-city false positives) | RPC takes `p_city_id` parameter — city scoping is enforced at the DB level. No additional TypeScript scoping needed. |
</phase_requirements>

---

## Summary

Phase 11 is a pure TypeScript integration task. The database layer — `pg_trgm`, `unaccent`, `f_unaccent()` wrapper, GIN index on `venues.name_en`, and the `search_venues_fuzzy` RPC — is fully deployed and verified in Supabase production as of Phase 10. This phase wires the RPC into `src/services/venues.ts` using a **two-pass strategy**: the existing `hasNeedle()` filter runs first (pass one), and if it returns zero venues, `search_venues_fuzzy` is called as a fallback (pass two).

The key architectural constraint is that `searchVenues()` is event-occurrence-centric: it fetches `event_occurrences` joined to venues, groups by venue, and returns `VenueSummary` objects. The fuzzy RPC returns raw `VenueRow`s (venue table rows, no event data). The two-pass strategy must handle this impedance mismatch: on a fuzzy fallback, the service fetches event occurrences for the fuzzy-matched venue IDs, then runs the normal aggregation pipeline to build `VenueSummary` objects.

**Primary recommendation:** Implement the two-pass strategy as a targeted addition to `searchVenues()` — after the existing aggregation produces zero venues, call `search_venues_fuzzy`, fetch event occurrences for the returned venue IDs (filtered by date window and city), and run the same aggregation pipeline. The no-query and non-zero-result paths are completely unchanged.

No new npm packages are needed. `normalizeQuery()` from `src/utils/normalize.ts` is already written and tested.

---

## Standard Stack

### Core (No New npm Packages)

| Component | Version | Purpose | Why This |
|-----------|---------|---------|----------|
| `search_venues_fuzzy` RPC | Deployed (Phase 10) | Typo-tolerant venue name matching | Already live in production; handles accent, space, typo variants at DB level with GIN index for speed |
| `normalizeQuery()` | Phase 10 (normalize.ts) | Normalize user query before passing to RPC | Already written, tested, exported. Produces `p_query` input for the RPC. |
| `supabase.rpc()` | @supabase/supabase-js ^2.97.0 | Call the fuzzy search RPC from TypeScript | Already used in `src/auth/authorize.ts` — proven pattern in this codebase |

**Installation:**
```bash
# No new packages. All dependencies already installed.
```

---

## Architecture Patterns

### Recommended Change Surface (Phase 11 only)

```
src/
└── services/
    └── venues.ts          # MODIFY — add two-pass logic + RPC helper
    └── venues.test.ts     # MODIFY — add tests for two-pass behavior
```

No changes to: `src/tools/venues.ts`, `src/types.ts`, `src/rest.ts`, `src/openapi.ts`, or any other file. The output type `SearchVenuesOutput` is unchanged. The tool and REST interfaces are unchanged.

### Pattern 1: Two-Pass Strategy

**What:** Run the existing `hasNeedle()` filter first. If the result is zero venues, call `search_venues_fuzzy` to get candidate venue IDs, fetch their event occurrences within the same date window, and run the same aggregation pipeline.

**When to use:** Only when `input.query` is provided (non-empty). No query = no fuzzy fallback needed.

**Why two passes and not always-fuzzy:**
- The existing `hasNeedle()` filter matches on venue name, address, city, event name, description, and genre — broad text fields the RPC doesn't cover.
- The RPC is venue-name-only. Replacing the first pass with the RPC would drop event name, description, and genre matching.
- Two-pass preserves all existing match behavior; the RPC is additive only for the zero-result case.

**Execution path:**
```
searchVenues(input) called with input.query = "celavi"
  │
  ├─ Pass 1: normal event_occurrences fetch + hasNeedle() filter
  │    └─ occurrences filtered to those matching "celavi" → 0 venues
  │
  ├─ zero venues? AND input.query provided? → trigger Pass 2
  │
  └─ Pass 2: call search_venues_fuzzy(city.id, normalizeQuery(query))
       ├─ returns [{ id: "6f772e2f-...", name_en: "CÉ LA VI", ... }]
       ├─ fetch event_occurrences WHERE venue_id IN (fuzzy_ids) AND date window
       ├─ run same aggregation pipeline (aggregate → rankVenueSummaries → page)
       └─ return SearchVenuesOutput with fuzzy venues
```

**Implementation shape:**
```typescript
// Source: pattern derived from existing searchVenues() and authorize.ts rpc() usage

// Helper — calls the RPC, returns venue IDs in similarity order
async function fuzzyVenueIds(
  supabase: SupabaseClient,
  cityId: string,
  query: string,       // raw user query
  limit: number,       // how many fuzzy candidates to fetch (e.g. 20)
): Promise<string[]> {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const { data, error } = await supabase.rpc("search_venues_fuzzy", {
    p_city_id: cityId,
    p_query: normalized,
    p_threshold: 0.15,
    p_limit: 20,
  });

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Fuzzy venue search failed.", {
      cause: error.message,
    });
  }

  // RPC returns SETOF venues, supabase-js wraps as array
  return ((data || []) as Array<{ id: string }>).map((row) => row.id);
}
```

**Fetching occurrences for fuzzy venue IDs:**
```typescript
// After fuzzyVenueIds() returns a non-empty list:
const { data, error } = await supabase
  .from("event_occurrences")
  .select(OCCURRENCE_SELECT)
  .eq("published", true)
  .eq("city_id", city.id)
  .in("venue_id", fuzzyIds)          // <-- scope to fuzzy-matched venues
  .gte("start_at", window.startIso)
  .lt("start_at", window.endIso)
  .order("start_at", { ascending: true })
  .range(0, 1999);
```

**Preserving fuzzy rank order:**
The RPC returns venues ordered by `word_similarity DESC`. The aggregation pipeline calls `rankVenueSummaries()` which re-ranks by upcoming event count then next event date. This is fine — the final ranking is still by event activity, which is the right metric for `VenueSummary` results. The `word_similarity` order only matters for deciding *which* venues qualify; `rankVenueSummaries` decides their output order.

### Pattern 2: No-Query Path Unchanged

**What:** When `input.query` is absent or blank, skip fuzzy entirely. The existing logic is untouched.

**Why critical (success criterion 5):** "search_venues city=tokyo with no query returns the same venue set as before." Any code path that could trigger fuzzy logic without a query would break this.

**Implementation guard:**
```typescript
// Pass 2 is only entered when:
// 1. summaries.length === 0 (pass 1 returned nothing)
// 2. queryNeedle is non-empty (user provided a query)
if (summaries.length === 0 && queryNeedle) {
  // ... fuzzy fallback
}
```

### Pattern 3: Genre Filter + Fuzzy Interaction

**What:** When `input.genre` is provided alongside `input.query`, the existing behavior filters by genre-matched event IDs before aggregation. If pass 1 returns zero venues due to the genre filter (not the query), fuzzy should NOT fire — the user deliberately filtered by genre.

**Research finding:** Looking at the existing code, `genreEventIds` filters occurrences before the `hasNeedle()` step. If genre filtered all events out, `effectiveOccurrences.length === 0` is reached before aggregation. The two-pass guard should check `queryNeedle` is set AND `genreEventIds === null` (no genre filter) before triggering fuzzy. If a genre filter is active, fuzzy would be wrong (would return venues even though genre requirement wasn't met).

**Recommended guard:**
```typescript
if (summaries.length === 0 && queryNeedle && genreEventIds === null) {
  // fuzzy fallback — only when no genre filter active
}
```

### Anti-Patterns to Avoid

- **Replacing pass 1 with the RPC:** The RPC only matches venue names. Existing `hasNeedle()` also matches event names, descriptions, addresses, and genres — these must be preserved. Two-pass means the RPC is additive, not a replacement.
- **Running pass 2 when genre filter is active:** If the user asked for `genre=techno` and no venues matched, fuzzy should not return non-techno venues just because their name looks similar to the query.
- **Running pass 2 when there is no query:** Empty query with zero occurrences (e.g., city with no events today) should not trigger fuzzy — it would return all venues regardless of query intent.
- **Re-normalizing inside the service with a different function:** The venues service currently has its own `sanitizeIlike()`. Phase 11 must use `normalizeQuery()` from `src/utils/normalize.ts` for the RPC argument — not a local helper.
- **Mutating the `effectiveOccurrences` path:** The fuzzy fallback fetches *new* occurrences for fuzzy venues. It does not modify the existing `occurrences` or `vipHourOccurrences` variables. The two paths are independent.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Typo tolerance in TypeScript | Levenshtein distance impl, custom trigram scoring | `search_venues_fuzzy` RPC (already deployed) | DB-level GIN index makes this sub-millisecond; TypeScript Levenshtein needs all venues pre-fetched (N+1 problem) |
| Accent normalization for RPC input | Local replacement table in venues.ts | `normalizeQuery()` from `src/utils/normalize.ts` | Already written, tested, canonical. Duplicate logic in venues.ts would drift from the canonical form. |
| Post-hoc reranking by similarity score | Client-side similarity rescoring after aggregation | Trust RPC ORDER BY, use `rankVenueSummaries` for output order | RPC already returns venues in similarity order; `rankVenueSummaries` provides event-activity ranking which is the right product metric |

---

## Common Pitfalls

### Pitfall 1: Triggering Fuzzy on the Wrong Conditions

**What goes wrong:** Fuzzy fires when there is no user query, when a genre filter is active, or when a date filter produces legitimately empty results.

**Why it happens:** The condition `summaries.length === 0` is true in many situations. Checking only this condition without verifying `queryNeedle` and `genreEventIds === null` causes false positives.

**How to avoid:** Three-condition guard: `summaries.length === 0 && queryNeedle.length > 0 && genreEventIds === null`.

**Warning signs:** Test "no query returns same venue set" fails; or genre+query combination returns off-genre venues.

### Pitfall 2: RPC Returns Raw VenueRows — Not Aggregated Summaries

**What goes wrong:** Treating the RPC's `SETOF venues` response directly as `VenueSummary[]` objects without event aggregation.

**Why it happens:** The RPC conveniently returns venue rows, and it's tempting to map them directly to `VenueSummary` — but that omits `upcoming_event_count`, `next_event_date`, and `genres`, which all require the event occurrence join.

**How to avoid:** After fuzzy returns venue IDs, always fetch event occurrences for those venue IDs and run the full aggregation pipeline — same code path as pass 1.

**Exception:** If a fuzzy-matched venue has no events in the current window, it will not appear in the results (the aggregation produces no entry for it). This is acceptable — a venue without upcoming events is not useful to a concierge agent anyway.

### Pitfall 3: normalizeQuery vs sanitizeIlike — Using the Wrong Function

**What goes wrong:** Passing `sanitizeIlike(input.query)` to the RPC instead of `normalizeQuery(input.query)`. `sanitizeIlike` removes commas and parentheses and trims, but does NOT strip accents or collapse spaces. "CÉ LA VI" stays "CÉ LA VI" and the RPC gets an unstripped query.

**Why it happens:** `sanitizeIlike` is already in the file and is used for the `queryNeedle`. It's an easy mistake to reuse it for the RPC call.

**How to avoid:** The `queryNeedle` variable (for `hasNeedle()`) uses `sanitizeIlike`. The RPC argument uses `normalizeQuery()` imported from `src/utils/normalize.ts`. These serve different purposes.

### Pitfall 4: supabase.rpc() Returns SETOF — Use Array Access Correctly

**What goes wrong:** The RPC returns `SETOF public.venues`. The Supabase JS client returns this as an array. Code that expects a single row (`data.id`) instead of an array (`data[0].id`) will fail at runtime with a TypeScript type error or undefined.

**Why it happens:** Some RPCs return a single row; developers copy the single-row pattern. `search_venues_fuzzy` is `SETOF` — it always returns an array.

**How to avoid:** Type the response as `Array<{ id: string; name_en: string | null; ... }>`. Extract IDs with `.map(row => row.id)`. Reference the `authorize.ts` `.rpc()` pattern — it also handles the array case with `Array.isArray(data)`.

### Pitfall 5: VIP Hours Synthetic Occurrences in Fuzzy Path

**What goes wrong:** The fuzzy fallback fetches occurrences for fuzzy venue IDs but forgets to also generate VIP hours synthetic occurrences for those venues, leading to VIP venues being invisible in fuzzy results.

**Why it happens:** VIP hours synthesis is a separate step that builds synthetic `EventOccurrenceRow`s from `vip_booking_enabled` venues with `hours_weekly_json`. It's easy to skip in the fuzzy path.

**How to avoid:** After fetching fuzzy occurrences, check if any of the fuzzy venue IDs are VIP venues with hours — either by filtering from the existing `vipHourOccurrences` set (which was already built) or by re-running the synthesis for just the fuzzy venue IDs. The simplest approach: filter `vipHourOccurrences` (already computed) to only those whose `venue_id` is in `fuzzyIds`, then merge with the fuzzy event occurrences.

---

## Code Examples

Verified patterns from direct codebase analysis:

### Existing RPC Call Pattern (from src/auth/authorize.ts)

```typescript
// Source: src/auth/authorize.ts lines 136-139 — proven supabase.rpc() usage in this codebase
const { data, error } = await supabase.rpc("consume_mcp_api_request", {
  p_key_hash: keyHash,
  p_now: nowIso,
});
```

### normalizeQuery Import Pattern

```typescript
// Source: src/utils/normalize.ts — already exists, already tested
import { normalizeQuery } from "../utils/normalize.js";

// Use to produce the p_query argument for the RPC:
const rpcQuery = normalizeQuery(input.query || "");
// "CÉ LA VI" → "celavi"
// "1 OAK"    → "1oak"
// "zeuk"     → "zeuk"
```

### fuzzyVenueIds Helper (new, to add to venues.ts)

```typescript
// New private helper in src/services/venues.ts
async function fuzzyVenueIds(
  supabase: SupabaseClient,
  cityId: string,
  rawQuery: string,
): Promise<string[]> {
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) return [];

  const { data, error } = await supabase.rpc("search_venues_fuzzy", {
    p_city_id: cityId,
    p_query: normalized,
    p_threshold: 0.15,
    p_limit: 20,
  });

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", "Fuzzy venue search failed.", {
      cause: error.message,
    });
  }

  return ((data || []) as Array<{ id: string }>).map((row) => row.id);
}
```

### Two-Pass Guard in searchVenues (where to insert)

```typescript
// In searchVenues(), after: const summaries = [...aggregates.entries()].map(...)
// Before: const offset = coerceOffset(input.offset);

if (summaries.length === 0 && queryNeedle && genreEventIds === null) {
  const fuzzyIds = await fuzzyVenueIds(supabase, city.id, input.query || "");
  if (fuzzyIds.length > 0) {
    // Fetch occurrences for fuzzy-matched venues within the same date window
    const { data: fuzzyData, error: fuzzyError } = await supabase
      .from("event_occurrences")
      .select(OCCURRENCE_SELECT)
      .eq("published", true)
      .eq("city_id", city.id)
      .in("venue_id", fuzzyIds)
      .gte("start_at", window.startIso)
      .lt("start_at", window.endIso)
      .order("start_at", { ascending: true })
      .range(0, 1999);

    if (fuzzyError) {
      throw new NightlifeError("DB_QUERY_FAILED", "Failed to fetch fuzzy venue events.", {
        cause: fuzzyError.message,
      });
    }

    // Filter VIP hours occurrences to fuzzy venue IDs
    const fuzzyIdSet = new Set(fuzzyIds);
    const fuzzyVipHours = vipHourOccurrences.filter(
      (row) => row.venue_id && fuzzyIdSet.has(row.venue_id),
    );
    const fuzzyOccurrences = [
      ...((fuzzyData || []) as unknown as EventOccurrenceRow[]),
      ...fuzzyVipHours,
    ];

    // Run same aggregation pipeline on fuzzy occurrences (no query filter — we already know these match)
    const fuzzyGenresByEvent = await fetchGenresByEvent(
      supabase,
      fuzzyOccurrences.filter((r) => UUID_RE.test(r.id)).map((r) => r.id),
    );

    // Aggregate into summaries
    const fuzzyAggregates = new Map<string, { /* same shape as aggregates */ }>();
    // ... same aggregation loop as pass 1, but without the hasNeedle() filter
    // ... return rankVenueSummaries(fuzzyAggregates).slice(offset, offset + limit)
  }
}
```

### Supabase RPC SETOF Type Handling

```typescript
// SETOF functions return an array — not a single row
// Correct typing for search_venues_fuzzy response:
type FuzzyVenueRow = { id: string; name_en: string | null };
const rows = (data || []) as FuzzyVenueRow[];
const ids = rows.map((row) => row.id);
```

---

## State of the Art

| Old Behavior | New Behavior | When | Impact |
|---|---|---|---|
| `query=celavi` → 0 results (no ILIKE match) | `query=celavi` → CÉ LA VI via fuzzy RPC fallback | Phase 11 | Accent variants now find the right venue |
| `query=1oak` → 0 results | `query=1oak` → 1 OAK via fuzzy RPC fallback | Phase 11 | Space variants now find the right venue |
| `query=zeuk` → 0 results | `query=zeuk` → Zouk via fuzzy RPC fallback | Phase 11 | 1-char typos now find the right venue |
| No query → existing behavior | No query → unchanged existing behavior | Phase 11 | Zero regression on no-query path |

**Nothing deprecated in Phase 11.** The existing `hasNeedle()` pass-1 logic stays intact. The existing `queryNeedle` variable built with `sanitizeIlike` stays intact for pass 1. The fuzzy path is purely additive.

---

## Open Questions

1. **NORM-03: Number-word equivalence ("1oak" → "oneoak")**
   - What we know: Phase 10 flagged this as partially out of scope. `normalizeQuery("1oak")` returns `"1oak"` — no digit-to-word mapping.
   - What's unclear: Success criteria for Phase 11 requires `query=1oak` returns 1 OAK. This works via space stripping (ILIKE arm in RPC: `replace(name_en, ' ', '') ILIKE '%1oak%'`). The reverse ("oneoak" → "1 OAK") is NOT required by Phase 11 success criteria and is not in scope.
   - Recommendation: Verify that `search_venues_fuzzy(city_id, '1oak', 0.15, 10)` returns the 1 OAK row (Phase 10 verified this). No code change needed for NORM-03 in Phase 11.

2. **fuzzyVenueIds limit (20) — is it right?**
   - What we know: The RPC `p_limit DEFAULT 200` allows up to 200. Phase 11 only needs the top few matches to get the right venue.
   - Recommendation: 20 is a safe default. For Tokyo we have ~20-30 total venues. 20 candidates covers the full set without over-fetching.

3. **What if fuzzy matches but venue has no upcoming events?**
   - What we know: If `search_venues_fuzzy` returns a venue but that venue has no `event_occurrences` in the date window, the aggregation produces no summary for it.
   - Recommendation: This is acceptable behavior. A venue without upcoming events shouldn't appear in event-based search results. The success criteria tests ("celavi returns CÉ LA VI") assume CÉ LA VI has events in the near-future window.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) + `node:assert/strict` |
| Config file | None — run via `tsx --test` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VEN-01 | Pass 1 zero results → pass 2 fires; existing positive results → pass 2 skipped | unit | `npm test` | ❌ Wave 0: `src/services/venues.test.ts` (extend) |
| VEN-02 | Typo "zeuk" → fuzzy fallback → Zouk returned | manual + unit | Manual: call tool with `query=zeuk`; unit: mock RPC response | ❌ Wave 0: `src/services/venues.test.ts` |
| VEN-03 | Fuzzy results preserve similarity-based ranking from RPC | unit | `npm test` | ❌ Wave 0: `src/services/venues.test.ts` |
| VEN-04 | Fuzzy scope by city — city_id passed correctly to RPC | unit | `npm test` | ❌ Wave 0: `src/services/venues.test.ts` |

**Note on testing approach:** `searchVenues()` makes real DB calls. The existing `venues.test.ts` uses `__testOnly_*` exports to test pure functions without Supabase. Phase 11 should follow this pattern: export `__testOnly_fuzzyVenueIds` guard logic (the condition check) and add a unit test. The actual end-to-end success criteria (queries returning real venues) are verified manually against staging/production.

### Sampling Rate

- **Per task commit:** `npm test` (13 test files, runs in < 5 seconds)
- **Per wave merge:** `npm test` + manual smoke: `search_venues city=tokyo query=celavi` against production
- **Phase gate:** Full suite green + all 5 success criteria manually verified against production before proceeding to Phase 12

### Wave 0 Gaps

- [ ] `src/services/venues.test.ts` — add tests covering:
  - Two-pass guard: `summaries.length === 0 && queryNeedle && genreEventIds === null` — each condition individually
  - Genre-filter + query does NOT trigger fuzzy (genreEventIds !== null)
  - No-query path does NOT trigger fuzzy (queryNeedle is empty)
  - `fuzzyVenueIds` returns empty array for blank query (guards against RPC call with empty string)

*(Existing test infrastructure and framework are in place — no new framework needed)*

---

## Sources

### Primary (HIGH confidence)

- `src/services/venues.ts` (direct read, full file) — existing `searchVenues()` function, `hasNeedle()`, `sanitizeIlike()`, `queryNeedle` pattern, aggregation pipeline, `rankVenueSummaries`, `OCCURRENCE_SELECT`, `VenueRow` types
- `supabase/migrations/20260312_fuzzy_search.sql` (direct read) — exact RPC signature, parameter names (`p_city_id`, `p_query`, `p_threshold`, `p_limit`), ORDER BY behavior, three-arm WHERE clause
- `src/utils/normalize.ts` (direct read) — confirmed `normalizeQuery()` strips accents, collapses spaces, lowercases
- `src/auth/authorize.ts` (direct read) — confirmed `supabase.rpc()` call pattern, SETOF array handling
- `.planning/phases/10-db-infrastructure-and-normalization-utility/10-01-SUMMARY.md` — confirmed: DB-01 through DB-04 all verified in production; macrons strip correctly; "celavi" returns CÉ LA VI, "1oak" returns 1 OAK from the RPC
- `src/services/venues.test.ts` (direct read) — confirmed test pattern (`__testOnly_*` exports, node:test framework, no Supabase mock needed for pure function tests)
- `.planning/phases/10-db-infrastructure-and-normalization-utility/10-VERIFICATION.md` — confirmed Phase 10 DB infrastructure complete; NORM-03 scoping note (digit-to-word not implemented, acceptable for Phase 11)
- `.planning/REQUIREMENTS.md` — VEN-01 through VEN-04 requirements definitions
- `.planning/STATE.md` — Phase 10 complete, all decisions locked

### Secondary (MEDIUM confidence)

- `.planning/phases/10-db-infrastructure-and-normalization-utility/10-RESEARCH.md` — RPC design rationale, pitfall catalogue, `word_similarity` vs `similarity` analysis, threshold 0.15 recommendation

### Tertiary (LOW confidence)

None needed — all findings are grounded in the project's own deployed code and verified production state.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all components deployed and verified in production
- Architecture: HIGH — `searchVenues()` fully read; two-pass strategy derived directly from the existing code structure
- Pitfalls: HIGH — derived from direct reading of the existing service code; no speculation required
- RPC contract: HIGH — migration SQL read directly; Phase 10 summary confirms production verification

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (Supabase schema and TypeScript code are stable; RPC signature is locked by the deployed migration)

---

*Phase 11 research — grounded entirely in project's own deployed code, verified DB state, and direct codebase audit. No external research needed: the infrastructure is built, the design is decided, this phase is integration work.*
