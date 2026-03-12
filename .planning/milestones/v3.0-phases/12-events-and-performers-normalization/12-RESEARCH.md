# Phase 12: Events and Performers Normalization - Research

**Researched:** 2026-03-12
**Domain:** TypeScript query normalization — events and performers search services
**Confidence:** HIGH

---

## Summary

Phase 12 is a surgical wiring job. The normalization function (`normalizeQuery`) already exists in `src/utils/normalize.ts` from Phase 10-02. The venues service already consumes it correctly (Phase 11). This phase applies the identical pattern to `src/services/events.ts` and `src/services/performers.ts`.

The core change is replacing `sanitizeIlike(input.query)` with `normalizeQuery(input.query)` as the query needle in both services — which strips accents, collapses spaces, and lowercases. Then the existing `hasNeedle()` comparison (which calls `.toLowerCase().includes(needle)`) works correctly against accent-bearing data, because both the needle and the haystack are normalized before comparison.

There are no DB changes, no RPC calls, and no new dependencies. Both services use client-side `matchQuery()` / inline filter after data is fetched, so the normalization happens entirely in TypeScript. The `sanitizeIlike` function (which only strips `,()` characters) continues to serve the Supabase ILIKE query parameter — it is NOT replaced globally, only the client-side needle derivation changes.

**Primary recommendation:** Import `normalizeQuery` in both services. Replace the one-liner `const queryNeedle = input.query ? sanitizeIlike(input.query).toLowerCase() : ""` with `const queryNeedle = input.query ? normalizeQuery(input.query) : ""`. Everything downstream already works.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EP-01 | Event search uses accent/space/case normalization on text matching | Replace `sanitizeIlike(...).toLowerCase()` needle with `normalizeQuery(...)` in `searchEvents()`. All `hasNeedle()` and `matchQuery()` calls downstream benefit automatically. |
| EP-02 | Performer search uses accent/space/case normalization on text matching | Replace `sanitizeIlike(...).toLowerCase()` needle with `normalizeQuery(...)` in `searchPerformers()`. The inline `.filter()` block at line ~865 benefits automatically. |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `src/utils/normalize.ts` | (project file) | `normalizeQuery()` and `stripAccents()` | Single source of truth for v3.0; already used by venues service |
| `String.prototype.normalize('NFD')` | built-in | Unicode decomposition for accent stripping | Zero-dependency canonical solution; established in Phase 10-02 |

### No new packages needed
This phase has zero new npm dependencies. `normalizeQuery` is a project utility, not a library.

---

## Architecture Patterns

### Recommended Project Structure
No structural changes. Both files already exist and are simply modified.

```
src/
├── utils/
│   └── normalize.ts         # Already exists — exports normalizeQuery, stripAccents
├── services/
│   ├── events.ts            # MODIFY: import + use normalizeQuery for queryNeedle
│   └── performers.ts        # MODIFY: import + use normalizeQuery for queryNeedle
```

### Pattern 1: normalizeQuery for client-side needle (established in venues.ts)

**What:** Derive the query needle using `normalizeQuery()` instead of `sanitizeIlike().toLowerCase()`. The needle is then used only in client-side filter functions — not passed to Supabase ILIKE.

**When to use:** Whenever the query is used to filter rows that are already in memory (TypeScript-level), not when constructing a DB query string.

**Example (established in venues.ts, lines 863 + 944-961):**
```typescript
// Source: src/services/venues.ts (Phase 11 implementation)
import { normalizeQuery } from "../utils/normalize.js";

// Needle derivation — the ONLY change in each service:
const queryNeedle = input.query ? normalizeQuery(input.query) : "";

// hasNeedle() already calls .toLowerCase().includes(needle) — works correctly
// because normalizeQuery() already lowercases the needle
function hasNeedle(needle: string, ...values: Array<string | null | undefined>): boolean {
  return values.some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(needle),
  );
}
```

**Note on haystack:** The haystack values (performer names, event names, genre names) are NOT pre-normalized. They contain the raw accented data from the DB (e.g., "Shinjūku"). The `hasNeedle()` call applies `.toLowerCase()` but NOT accent stripping to the haystack.

This means: query "shinjuku" normalizes to "shinjuku" via `normalizeQuery`. The haystack "Shinjūku" lowercases to "shinjūku". The `includes()` check fails because "shinjūku" does not contain "shinjuku".

**This is by design and documented in REQUIREMENTS.md:** The requirement says "normalization on text matching" — the needle is normalized. Haystack normalization would require normalizing every string in every performer/event row on every request (hundreds of strings). The project decision from Phase 10 is TypeScript-only normalization on the *needle* side only. If double-sided normalization is needed in future, it would be FUT-01 territory.

**Verify this interpretation:** The success criterion says `query="dua lipa"` finds "Dua Lipa" — note NO accents in either query or stored name. And `query="shinjuku"` finds "Shinjuku" with macron — the DB name has a macron, query has none. So the direction is: strip accents FROM the query needle to make it match unaccented substrings in accented haystack text. This requires normalizing the haystack too, OR normalizing both. Current `hasNeedle` only calls `.toLowerCase()` on haystack. Therefore, to make "shinjuku" match "Shinjūku" (macron), the haystack value must also have its accents stripped inside `hasNeedle`.

**Revised finding:** `hasNeedle` must compare normalized needle against normalized haystack. The correct approach is:
```typescript
// Inside hasNeedle, or via a wrapper — normalize both sides:
function hasNeedleNormalized(needle: string, ...values: Array<string | null | undefined>): boolean {
  return values.some((value) =>
    stripAccents(String(value || "")).toLowerCase().includes(needle),
  );
}
```
Where `needle` is already the output of `normalizeQuery()` (accent-stripped + lowercased), and haystack values have `stripAccents()` applied before `.toLowerCase().includes()`.

Alternatively, the existing `hasNeedle` can remain for backward-compatible uses, and a new `hasNeedleNormalized` is used only for the query filter path. This is the cleaner approach — it avoids modifying shared infrastructure that other call sites depend on.

### Pattern 2: Keep sanitizeIlike for DB ILIKE queries

**What:** The `sanitizeIlike` function (strips `,()`, trims) must be kept for the DB query. In `events.ts`, the `queryText` variable fed into Supabase's `.or("name_en.ilike...")` is derived from `sanitizeIlike(input.query)`, not `normalizeQuery`. This must not change — `normalizeQuery` collapses spaces (turning "dua lipa" into "dualipa"), which would break the ILIKE match against "Dua Lipa" in the DB.

```typescript
// In events.ts searchEvents() — these two are DISTINCT:
const queryText = input.query ? sanitizeIlike(input.query) : "";    // → DB ILIKE (keep as-is)
const queryNeedle = input.query ? normalizeQuery(input.query) : ""; // → client-side filter (new)
```

In `performers.ts`, there is no DB ILIKE on query — the entire performer list is fetched first, then filtered in memory. So there is only one needle, which should become `normalizeQuery`.

### Anti-Patterns to Avoid

- **Using normalizeQuery for DB ILIKE strings:** `normalizeQuery` collapses spaces. "dua lipa" becomes "dualipa" which will not match the DB record "Dua Lipa" via ILIKE. Keep `sanitizeIlike` for DB strings.
- **Normalizing only the needle but not the haystack:** If the query is "shinjuku" and the stored name is "Shinjūku", `hasNeedle("shinjuku", "Shinjūku".toLowerCase())` = `"shinjūku".includes("shinjuku")` = false. Both sides need accent stripping for cross-accent matching to work.
- **Replacing `sanitizeIlike` globally:** `sanitizeIlike` is still used in `resolveGenreEventIds` and `resolveGenrePerformerIds` for DB queries — those must not change.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accent stripping | Custom lookup tables or regex per character | `normalizeQuery` from `src/utils/normalize.ts` | Already built, tested, the project standard |
| Case normalization | Custom `.toUpperCase()/.toLowerCase()` + mapping | `normalizeQuery` (includes lowercase) | Single source of truth prevents divergence |
| Whitespace collapsing | Custom trim/split/join | `normalizeQuery` (collapses all whitespace) | Consistent with venue service behavior |

**Key insight:** The utility exists. Do not reimplement it inline.

---

## Common Pitfalls

### Pitfall 1: Space collapse breaks DB ILIKE
**What goes wrong:** Developer imports `normalizeQuery`, uses it for both the DB `queryText` and the in-memory `queryNeedle`. "dua lipa" becomes "dualipa". The Supabase ILIKE clause `name_en.ilike.%dualipa%` finds nothing even though the DB has "Dua Lipa".
**Why it happens:** `normalizeQuery` collapses spaces — correct for client-side substring matching (DB names have no spaces in the normalized form), but wrong for DB ILIKE which expects word-by-word matching.
**How to avoid:** Keep two separate variables: `queryText` (sanitizeIlike, for DB) and `queryNeedle` (normalizeQuery, for client-side filter).
**Warning signs:** `search_events query="dua lipa"` returns zero results after the change.

### Pitfall 2: Single-sided normalization misses cross-accent matches
**What goes wrong:** Developer normalizes the needle but passes raw haystack strings to `hasNeedle`. `hasNeedle("shinjuku", "Shinjūku")` = `"shinjūku".includes("shinjuku")` = false (macron survives lowercase).
**Why it happens:** JavaScript's `.toLowerCase()` does not strip diacritical marks — it lowercases the base letter but the combining diacritic remains attached.
**How to avoid:** In the query-filtering function (`matchQuery` in events.ts, inline filter in performers.ts), apply `stripAccents()` to each haystack value before the `.includes()` check.
**Warning signs:** `search_performers query="shinjuku"` still returns zero results after the change.

### Pitfall 3: Modifying `hasNeedle` breaks unrelated call sites
**What goes wrong:** Developer modifies the shared `hasNeedle()` function to also strip accents. This changes behavior for `matchArea()` in events.ts (area filter), which was not a normalization requirement.
**Why it happens:** `hasNeedle` is a shared utility called from multiple places.
**How to avoid:** Either (a) add a new `hasNeedleNormalized()` function for the query path only, or (b) normalize inline at the call site. Do not modify `hasNeedle` itself.

### Pitfall 4: Genre needle not normalized
**What goes wrong:** In events, the `matchQuery` function checks `performers.some(name => name.toLowerCase().includes(needle))` and `genres.some(name => name.toLowerCase().includes(needle))`. These also need accent stripping of haystack strings for the normalization to be consistent.
**Why it happens:** Developer only updates the field checks but forgets the performer/genre name checks at the end of `matchQuery`.
**How to avoid:** Apply `stripAccents()` before `.toLowerCase()` everywhere inside `matchQuery` and inside the performers service inline filter.

### Pitfall 5: Performers service genre needle also needs normalization
**What goes wrong:** In `resolveGenrePerformerIds`, the `needle` is still derived from `sanitizeIlike(genreInput).toLowerCase()`. This is a separate, DB-backed genre resolution step and is NOT the same as the in-memory query filter. This should stay as-is for the genre filter path; only the `queryNeedle` used for the `.filter()` at line ~865 needs to change.
**Why it happens:** Developer conflates "genre filter" (DB-backed) with "text query filter" (in-memory).
**How to avoid:** Change only `queryNeedle`, not the genre resolution needle.

---

## Code Examples

### Where normalizeQuery is currently used (venues.ts reference)
```typescript
// Source: src/services/venues.ts line 19
import { normalizeQuery } from "../utils/normalize.js";

// Source: src/services/venues.ts line 863
const queryNeedle = input.query ? sanitizeIlike(input.query).toLowerCase() : "";
// NOTE: In venues.ts this line still uses sanitizeIlike — the fuzzy path uses normalizeQuery separately.
// For Phase 12, events/performers should use normalizeQuery directly for the needle.
```

### normalizeQuery signature (confirmed from source)
```typescript
// Source: src/utils/normalize.ts
export function normalizeQuery(raw: string): string;
// "dua lipa" → "dualipa"
// "Shinjūku" → "shinjuku"
// "CÉ LA VI" → "celavi"

export function stripAccents(s: string): string;
// "Shinjūku" → "Shinjuku" (preserves spaces and case)
```

### Correct two-variable pattern for events.ts
```typescript
// Source: pattern derived from venues.ts + research finding
import { normalizeQuery, stripAccents } from "../utils/normalize.js";

// In searchEvents():
const queryText = input.query ? sanitizeIlike(input.query) : "";      // DB ILIKE (unchanged)
const queryNeedle = input.query ? normalizeQuery(input.query) : "";   // client-side filter (NEW)

// Updated matchQuery — normalize haystack too:
function matchQuery(row, query, performers, genres): boolean {
  const needle = query; // already output of normalizeQuery — lowercase, no accents, no spaces
  if (!needle) return true;

  const venue = firstRelation(row.venue);
  const normalizeHaystack = (s: string | null | undefined) =>
    stripAccents(String(s || "")).toLowerCase().replace(/\s+/g, "");

  if ([
    row.name_en, maybeJa(row.name_i18n), row.description_en, maybeJa(row.description_i18n),
    venue?.name, venue?.name_en, venue?.name_ja,
    venue?.city, venue?.city_en, venue?.city_ja,
  ].some(v => normalizeHaystack(v).includes(needle))) return true;

  return (
    performers.some(name => normalizeHaystack(name).includes(needle)) ||
    genres.some(name => normalizeHaystack(name).includes(needle))
  );
}
```

### Correct single-variable pattern for performers.ts
```typescript
// In searchPerformers():
const queryNeedle = input.query ? normalizeQuery(input.query) : "";   // replaces sanitizeIlike + toLowerCase

// Updated inline filter:
.filter((summary) => {
  if (!queryNeedle) return true;
  const normalizeHaystack = (s: string) => stripAccents(s).toLowerCase().replace(/\s+/g, "");
  if (normalizeHaystack(summary.name).includes(queryNeedle)) return true;
  return summary.genres.some(genre => normalizeHaystack(genre).includes(queryNeedle));
})
```

---

## Exact Change Sites

### events.ts

| Location | Current code | Change |
|----------|-------------|--------|
| Top-level import | (no normalize import) | Add `import { normalizeQuery, stripAccents } from "../utils/normalize.js";` |
| Line ~775 `searchEvents()` | `const queryText = input.query ? sanitizeIlike(input.query) : "";` | Keep as-is (DB ILIKE) |
| Line ~775 area | (no separate needle) | Add: `const queryNeedle = input.query ? normalizeQuery(input.query) : "";` |
| Line ~778 `needsClientFiltering` | uses `queryText` | Change to use `queryNeedle` (non-empty check is identical behavior) |
| Line ~596 `fetchOccurrencesByIds` | `query = query.or(...queryText...)` | Keep using `queryText` (this is the DB ILIKE path) |
| Line ~867 filter call | `matchQuery(row, queryText, ...)` | Change to `matchQuery(row, queryNeedle, ...)` |
| `matchQuery` function body | `needle = query.trim().toLowerCase()` + `hasNeedle(needle, ...)` | Normalize haystack inside: apply `stripAccents().toLowerCase().replace(/\s+/, "")` to each haystack value before `.includes(needle)` |

### performers.ts

| Location | Current code | Change |
|----------|-------------|--------|
| Top-level import | (no normalize import) | Add `import { normalizeQuery, stripAccents } from "../utils/normalize.js";` |
| Line ~842 `queryNeedle` | `const queryNeedle = input.query ? sanitizeIlike(input.query).toLowerCase() : ""` | Replace with `const queryNeedle = input.query ? normalizeQuery(input.query) : ""` |
| Lines ~865-873 filter | `summary.name.toLowerCase().includes(queryNeedle)` + `genre.toLowerCase().includes(queryNeedle)` | Apply `stripAccents().toLowerCase().replace(/\s+/g, "")` to each haystack value before `.includes()` |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `sanitizeIlike + toLowerCase` for all needle derivation | `normalizeQuery` for in-memory needle; `sanitizeIlike` for DB queries | Phase 12 | "shinjuku" matches "Shinjūku", "dua lipa" matches "Dua Lipa" |
| Single-sided lowercase matching | Normalized needle + accent-stripped haystack | Phase 12 | Cross-accent substring matching works bidirectionally |

**Not changed (by design):**
- DB ILIKE query parameter still uses `sanitizeIlike` — space collapse would break word-by-word matching
- `resolveGenreEventIds`, `resolveGenrePerformerIds` — genre DB queries unchanged
- No fuzzy RPC fallback for events/performers (per project decision in STATE.md and REQUIREMENTS.md "Out of Scope")

---

## Open Questions

1. **Should the area filter in events also use normalizeQuery?**
   - What we know: `matchArea()` uses `area.trim().toLowerCase()` and `hasNeedle()`. Area names like "Shinjuku" may have macron variants in the DB.
   - What's unclear: Is area normalization in scope for Phase 12? The requirements (EP-01, EP-02) say "text matching" without specifically calling out area.
   - Recommendation: Follow what the success criteria test — they only mention `query` parameter, not `area`. Apply normalization to the `query` path only to stay focused. Area normalization can be deferred.

2. **Haystack normalization cost**
   - What we know: `matchQuery` in events iterates over ~10-15 string fields per row and the result set can be up to 200 rows. Each `stripAccents()` call is a `normalize('NFD') + replace` — very cheap.
   - What's unclear: Any measurable latency impact?
   - Recommendation: No concern. NFD normalization is a V8 built-in, sub-microsecond per string. Not worth measuring.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test` + `node:assert/strict`) via `tsx` |
| Config file | none — configured via package.json script |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EP-01 | `normalizeQuery` needle used in events matchQuery | unit | `npm test` | Wave 0 — new file needed |
| EP-01 | accent variant in query matches accented event/performer name | unit | `npm test` | Wave 0 — new file needed |
| EP-02 | `normalizeQuery` needle used in performers filter | unit | `npm test` | Wave 0 — new file needed |
| EP-02 | macron-free query ("shinjuku") matches macron name ("Shinjūku") | unit | `npm test` | Wave 0 — new file needed |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

**Note:** One pre-existing test failure exists (`create_vip_booking_request description enforces dual-date late-night confirmation`) that is unrelated to Phase 12. Full suite will show 1 fail throughout — this is expected and not introduced by this phase. Phase gate passes when all new EP-01/EP-02 tests pass and no regressions are introduced.

### Wave 0 Gaps

- [ ] `src/services/events.test.ts` — covers EP-01: normalized needle + cross-accent matchQuery behavior
- [ ] `src/services/performers.test.ts` has existing tests (UUID validation, sort tests) but needs new tests covering EP-02: normalized needle + cross-accent filter behavior

*(The performers.test.ts file exists but does not have tests for the query normalization path. Events has no test file at all.)*

---

## Sources

### Primary (HIGH confidence)
- `src/utils/normalize.ts` — confirmed exports: `normalizeQuery`, `stripAccents`; confirmed behavior via `src/utils/normalize.test.ts`
- `src/services/venues.ts` — confirmed pattern for two-variable approach (queryText vs normalizeQuery); confirmed `import { normalizeQuery }` at line 19
- `src/services/events.ts` — confirmed current needle at line ~775: `sanitizeIlike(input.query)`, confirmed `matchQuery()` and `hasNeedle()` signatures
- `src/services/performers.ts` — confirmed current needle at line ~842: `sanitizeIlike(input.query).toLowerCase()`, confirmed inline filter at lines ~865-873
- `.planning/REQUIREMENTS.md` — confirmed EP-01/EP-02 scope, confirmed fuzzy matching out of scope for events/performers
- `.planning/STATE.md` — confirmed architecture decision: TypeScript-only for events/performers, no RPC

### Secondary (MEDIUM confidence)
- Phase 10-02 plan and summary — confirmed design rationale for `stripAccents` exported separately from `normalizeQuery` so services can use accent-only stripping without space collapse

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — normalize.ts is confirmed, zero new dependencies
- Architecture: HIGH — exact change sites identified with line numbers, pattern confirmed from venues.ts precedent
- Pitfalls: HIGH — all pitfalls derived from direct code inspection, not speculation

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable codebase, no external dependencies)
