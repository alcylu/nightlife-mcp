# Architecture Research

**Domain:** Fuzzy/accent-insensitive search integration — nightlife-mcp v3.0
**Researched:** 2026-03-12
**Confidence:** HIGH — based on direct source inspection + verified PostgreSQL official docs + Supabase extension docs

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Incoming query (MCP tool / REST API)         │
│  search_venues / search_events / search_performers               │
│  query="CeLaVi"  query="1oak"  query="Dua Lipa"                  │
├─────────────────────────────────────────────────────────────────┤
│                     src/utils/normalize.ts  (NEW)                │
│  normalizeQuery(raw) → { normalized, stripped }                  │
│  - NFD + strip diacritics   ("CÉ LA VI" → "ce la vi")           │
│  - strip spaces              ("1 oak" → "1oak")                  │
│  - lowercase                                                     │
├───────────────────────┬─────────────────────────────────────────┤
│  Venue search path    │  Events / Performers search path         │
│  (aggressive)         │  (basic normalization only)              │
├───────────────────────┤─────────────────────────────────────────┤
│  DB RPC               │  Existing service logic                  │
│  search_venues_fuzzy  │  Modified hasNeedle() / matchQuery()    │
│  (pg_trgm +           │  now receives normalizedNeedle           │
│   unaccent + GIN)     │  from normalizeQuery()                  │
├───────────────────────┴─────────────────────────────────────────┤
│                  Supabase (shared DB nqwyhdfwcaedtycojslb)       │
│  Extensions: unaccent  pg_trgm                                   │
│  Function:   f_unaccent(text) IMMUTABLE  (wrapper)               │
│  Function:   search_venues_fuzzy(city_id, query, threshold, ...)  │
│  Index:      venues_name_en_fuzzy  GIN (f_unaccent(lower(name_en)) gin_trgm_ops)│
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `src/utils/normalize.ts` | Shared query normalization — accent stripping, space collapse, lowercase | NEW — pure TypeScript, no DB deps |
| `src/services/venues.ts` | Venue search via DB RPC for fuzzy; existing logic for no-query path | MODIFIED — `searchVenues()` calls RPC when `input.query` is set |
| `src/services/events.ts` | Event search with normalized needle in `matchQuery()` | MODIFIED — pass normalizedNeedle into hasNeedle calls |
| `src/services/performers.ts` | Performer search with normalized needle in name filter | MODIFIED — normalize before `.filter()` in `searchPerformers()` |
| `supabase/migrations/...fuzzy_search.sql` | DB migration: extensions + immutable wrapper + RPC + indexes | NEW |
| DB function `f_unaccent(text)` | IMMUTABLE wrapper around `unaccent()` enabling expression indexes | NEW via migration |
| DB function `search_venues_fuzzy(...)` | Returns venue rows matching fuzzy query, scoped by city | NEW via migration |
| GIN index on venues | Fast trigram scan on `f_unaccent(lower(name_en))` | NEW via migration |

## Recommended Project Structure

```
src/
├── utils/
│   ├── time.ts               # UNCHANGED — service-day logic
│   └── normalize.ts          # NEW — normalizeQuery(), stripAccents(), collapseSpaces()
├── services/
│   ├── venues.ts             # MODIFIED — use RPC when query present
│   ├── events.ts             # MODIFIED — normalize needle before hasNeedle calls
│   └── performers.ts         # MODIFIED — normalize needle before name filter
supabase/
└── migrations/
    └── 20260312_fuzzy_search.sql   # NEW — extensions, wrapper fn, RPC, indexes
```

### Structure Rationale

- **`src/utils/normalize.ts`**: Centralizing normalization in one file means all three services share identical logic. It is pure TypeScript with no DB calls, so it runs synchronously — no latency cost on the hot path.
- **Venues only use the DB RPC**: The RPC is the only way to get `pg_trgm` similarity scoring without fetching all 450 venues. Events and performers already fetch a bounded set per city/date before filtering, so app-level normalization there costs nothing.
- **Migration file**: Keeps all DB changes version-controlled alongside the TypeScript. The shared Supabase project means the migration must be applied once and affects both nightlife-mcp and the consumer site (read-only DDL additions are safe — no table changes).

## Architectural Patterns

### Pattern 1: Hybrid — DB RPC for Venues, App-Level Normalize for Events/Performers

**What:** Two different strategies for two different data profiles. Venues are searched by name directly (450 rows, city-scoped to ~200), so a DB RPC with `pg_trgm` similarity handles the hard fuzzy-matching problem. Events and performers are already fetched into memory before the query needle is applied — just normalize the needle in TypeScript and let the existing `hasNeedle()` substring check handle the rest.

**When to use:** Use the DB RPC strategy whenever you need true fuzzy matching (tolerance for typos) against a named entity table with no pre-filtering. Use app-level normalization whenever the candidate set is already in memory from a prior DB fetch.

**Trade-offs:** The DB RPC adds one migration + one Supabase function to maintain. App-level normalization is invisible to the DB and requires no infrastructure. Mixing the two is pragmatic, not inconsistent — venues have a qualitatively different matching problem (the triggering bug was "CeLaVi" → 0 results from a direct name lookup, not from an event text search).

**Example — DB RPC call from venues.ts:**
```typescript
// src/services/venues.ts — searchVenues()
if (queryNeedle) {
  const { data, error } = await supabase.rpc('search_venues_fuzzy', {
    p_city_id: city.id,
    p_query: queryNeedle,        // already normalized by normalizeQuery()
    p_threshold: 0.15,           // trigram similarity threshold
    p_limit: 200,
  });
  // merge with occurrences filter chain below
}
```

**Example — app-level normalize in events.ts:**
```typescript
// src/utils/normalize.ts
export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacriticals
    .replace(/\s+/g, '')              // collapse spaces (for "1 oak" → "1oak")
    .toLowerCase()
    .replace(/[,()]/g, '')            // existing sanitize logic
    .trim();
}
```

```typescript
// In matchQuery() / hasNeedle() callers — events.ts, performers.ts
const normalizedNeedle = normalizeQuery(input.query || '');
// hasNeedle now normalizes each haystack value before comparing
```

### Pattern 2: DB Migration — Extensions + Immutable Wrapper + RPC + Index

**What:** A single migration file installs everything the DB-level fuzzy path needs. This is the correct Supabase workflow: apply once to the shared project, committing the SQL to version control.

**When to use:** Any time DB behavior changes — new function, new index, new extension. Not application code.

**Trade-offs:** Requires running the migration against the production Supabase project via `psql` or the Supabase dashboard. One-time cost, no ongoing maintenance unless the RPC signature changes.

**Example — full migration:**
```sql
-- 20260312_fuzzy_search.sql

-- 1. Enable extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Immutable wrapper so unaccent() can be used in index expressions
--    (built-in unaccent is STABLE, not IMMUTABLE — cannot index STABLE functions)
CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$
  SELECT public.unaccent('public.unaccent', $1)
$$;

-- 3. GIN trigram index on normalized venue name_en
--    Covers: "CeLaVi" → "celavi" % f_unaccent(lower("CÉ LA VI")) = "ce la vi"
--    Also covers pure ILIKE '%celavi%' patterns via gin_trgm_ops
CREATE INDEX IF NOT EXISTS venues_name_en_fuzzy
  ON venues USING GIN (f_unaccent(lower(name_en)) gin_trgm_ops);

-- Optional: index name (non-English fallback) if needed in later phase
-- CREATE INDEX IF NOT EXISTS venues_name_fuzzy
--   ON venues USING GIN (f_unaccent(lower(name)) gin_trgm_ops);

-- 4. RPC: fuzzy venue search scoped by city
CREATE OR REPLACE FUNCTION search_venues_fuzzy(
  p_city_id   uuid,
  p_query     text,    -- already normalized (lowercased, diacritics stripped, spaces removed)
  p_threshold float    DEFAULT 0.15,
  p_limit     int      DEFAULT 200
)
RETURNS SETOF venues
LANGUAGE sql STABLE AS
$$
  SELECT v.*
  FROM venues v
  WHERE v.city_id = p_city_id
    AND (
      -- Trigram similarity match (typo tolerance)
      similarity(f_unaccent(lower(v.name_en)), p_query) > p_threshold
      -- Substring / prefix containment (catches "celavi" inside "ce la vi" even if trigram score is low)
      OR f_unaccent(lower(v.name_en)) ILIKE '%' || p_query || '%'
      -- Fallback: space-stripped version ("1oak" matches "1 oak")
      OR replace(f_unaccent(lower(v.name_en)), ' ', '') ILIKE '%' || p_query || '%'
    )
  ORDER BY similarity(f_unaccent(lower(v.name_en)), p_query) DESC
  LIMIT p_limit;
$$;
```

### Pattern 3: Normalize-Then-Compare in hasNeedle()

**What:** The existing `hasNeedle(needle, ...values)` helper checks if any value contains the needle as a plain lowercase substring. For events and performers, extending it to also normalize the haystack values (strip accents, collapse spaces) makes all in-memory text matching accent-insensitive without any DB changes.

**When to use:** Events and performers — anywhere a `query` needle is compared to in-memory text fields (event names, venue names embedded in events, performer names).

**Trade-offs:** Slightly more CPU per comparison (NFD + regex replace), negligible at the scale of 200 event rows already in memory. Zero DB round-trips, zero migrations, zero index maintenance.

**Example:**
```typescript
// src/utils/normalize.ts
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Modified hasNeedle — normalize both sides
function hasNeedle(needle: string, ...values: Array<string | null | undefined>): boolean {
  const n = stripAccents(needle.toLowerCase());
  return values.some((value) => stripAccents(String(value || '').toLowerCase()).includes(n));
}
```

## Data Flow

### Venue Search with Fuzzy Query

```
searchVenues(input: { city, query: "CeLaVi", ... })
    |
normalizeQuery("CeLaVi") → "celavi"
    |
IF queryNeedle present:
  supabase.rpc('search_venues_fuzzy', { p_city_id, p_query: "celavi", p_threshold: 0.15 })
    |
  DB: similarity(f_unaccent(lower("CÉ LA VI")), "celavi")
      = similarity("ce la vi", "celavi") → ~0.44  (above 0.15 threshold ✓)
    |
  Returns VenueRow[] matching: { id, name_en: "CÉ LA VI", ... }
    |
  Intersect with occurrences already fetched (city + date + genre filter)
  → Venues that appear in both sets pass through
    |
ELSE (no query):
  Existing occurrence-based aggregation unchanged
    |
rankVenueSummaries() → paginate → return
```

### Event/Performer Search with Normalized Query

```
searchEvents(input: { city, query: "Dua Lipa" }) OR
searchPerformers(input: { city, query: "Dua lipa" })
    |
normalizeQuery(input.query) → "dua lipa"  (same as before — no accents here)
    |
Existing DB fetch (occurrences by city + date range) — UNCHANGED
    |
matchQuery(row, "dua lipa", performers, genres)
  hasNeedle("dua lipa", ...) — but now normalizes both sides
  stripAccents(performer.name.toLowerCase()) → can match "Duá Lipa" → "dua lipa" ✓
    |
Filter → paginate → return
```

### Space-Normalized Venue Search ("1oak" → "1 OAK")

```
input.query = "1oak"
    |
normalizeQuery("1oak") → "1oak"  (no spaces to collapse; lowercase)
    |
RPC search_venues_fuzzy p_query = "1oak"
    |
DB: replace(f_unaccent(lower("1 OAK")), ' ', '') = "1oak"
    ILIKE '%1oak%' → TRUE ✓
```

### Key Data Flows

1. **Venue fuzzy match:** `normalizeQuery()` in TypeScript → RPC in DB → DB returns venue rows → intersect with occurrence-filtered venue set → rank and paginate.
2. **Event/performer accent match:** `normalizeQuery()` in TypeScript → existing in-memory filter → `hasNeedle()` now normalizes both sides.
3. **No-query path:** All three services take the existing code path unchanged. No regressions possible on the happy path.

## Integration Points

### New vs Modified Components

| Component | Status | Notes |
|-----------|--------|-------|
| `src/utils/normalize.ts` | NEW | `normalizeQuery()`, `stripAccents()` — pure TypeScript, no deps |
| `supabase/migrations/20260312_fuzzy_search.sql` | NEW | Extensions + f_unaccent wrapper + RPC + GIN index |
| DB function `f_unaccent(text)` | NEW (via migration) | Immutable wrapper — required for indexed expression |
| DB function `search_venues_fuzzy(...)` | NEW (via migration) | Fuzzy venue lookup scoped by city |
| GIN index `venues_name_en_fuzzy` | NEW (via migration) | Speeds up pg_trgm similarity + ILIKE on name_en |
| `src/services/venues.ts` — `searchVenues()` | MODIFIED | Calls RPC when query present; normalizes needle |
| `src/services/events.ts` — `hasNeedle()` / `matchQuery()` | MODIFIED | Normalize both sides in accent comparison |
| `src/services/performers.ts` — query filter in `searchPerformers()` | MODIFIED | Normalize before `.filter()` on performer name |
| All MCP tool files (`src/tools/*.ts`) | UNCHANGED | No interface changes |
| REST router (`src/rest.ts`) | UNCHANGED | No interface changes |
| Auth, config, types, errors | UNCHANGED | No changes needed |

### Build Order (Dependency-Aware)

Build this bottom-up so each layer can be tested before the next is added.

**Step 1 — DB migration (no code deps)**
Apply `20260312_fuzzy_search.sql` to the shared Supabase project. Use `psql` with the service role key (same process as previous migrations). Verify:
- `SELECT f_unaccent('CÉ LA VI');` → `CE LA VI`
- `SELECT similarity('celavi', 'ce la vi');` → non-zero float
- `SELECT * FROM search_venues_fuzzy('<tokyo_city_id>', 'celavi');` → returns CÉ LA VI row

**Step 2 — normalize.ts (no deps)**
Create `src/utils/normalize.ts` with `normalizeQuery()` and `stripAccents()`. Unit test with the concrete cases from the trigger bug: `"CeLaVi"` → `"celavi"`, `"1oak"` → `"1oak"`, `"é"` → `"e"`.

**Step 3 — venues.ts (deps: migration + normalize.ts)**
Modify `searchVenues()` to normalize the query needle and call the RPC when a query is present. The RPC returns `VenueRow[]` — intersect that ID set with the occurrence-based venue set already built. This keeps the date/genre/area filter chain intact.

**Step 4 — events.ts (deps: normalize.ts only)**
Modify `hasNeedle()` (or its caller) to normalize both needle and haystack. No DB changes. Test with: `input.query = "Café Mambo"` matches event named `"CAFÉ MAMBO"`.

**Step 5 — performers.ts (deps: normalize.ts only)**
Modify the query filter in `searchPerformers()` (the `.filter()` on `summary.name.toLowerCase().includes(queryNeedle)`). Same normalize-both-sides pattern. Test with: `query = "dua lipa"` matches `"Duá Lipa"`.

**Step 6 — integration test all three tools**
- `search_venues city=tokyo query=celavi` → returns CÉ LA VI
- `search_venues city=tokyo query=1oak` → returns 1 OAK
- `search_events city=tokyo query="dua lipa"` → returns any Dua Lipa events
- `search_performers city=tokyo query="dua lipa"` → returns Dua Lipa if active

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase | `supabase.rpc('search_venues_fuzzy', params)` | New RPC; same client pattern as existing queries |
| PostgreSQL extensions | Applied via migration SQL | `unaccent` and `pg_trgm` both available on Supabase (confirmed in extension catalog) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `searchVenues()` → DB RPC | `supabase.rpc()` call | Returns `VenueRow[]`; integrate with existing occurrence-set intersection |
| All services → `normalize.ts` | Direct import | Synchronous, no I/O |
| Venues RPC result → occurrence intersection | In-memory Set lookup | Build `Set<venueId>` from RPC results; keep only occurrences matching a venueId in set |

## Supabase PostgREST Constraints Addressed

**Why the fuzzy venue search must be an RPC, not a PostgREST filter:**

PostgREST exposes table filters via `.filter()`, `.ilike()`, `.textSearch()`, and the `%` trigram operator is not natively exposed through PostgREST's filter syntax. The `similarity()` function and the `%` operator require calling a PostgreSQL function that executes the query server-side. The `supabase.rpc()` call wraps a `SELECT * FROM search_venues_fuzzy(...)` PostgreSQL set-returning function, which PostgREST supports natively.

**Why the existing `.ilike()` on venues cannot be extended for this:**

The current venue search does not query the `venues` table directly — it queries `event_occurrences` (with joined venue data) and aggregates per venue. Bolting `.ilike()` onto that query would require filtering at the occurrence level, not the venue level, and would miss venues whose name is `"CÉ LA VI"` when the user types `"celavi"` (no shared substring after case-folding). The RPC pattern queries `venues` directly with `pg_trgm` similarity, then intersects with the occurrence-based set.

**Why pg_trgm threshold 0.15 (not the default 0.3):**

Venue names like "CÉ LA VI" (normalized to "ce la vi") vs. query "celavi" produce a trigram similarity of ~0.44 with `word_similarity()` and ~0.28 with `similarity()` (because short queries have fewer trigrams). The ILIKE containment fallback in the RPC covers the low-similarity case. Threshold 0.15 lets `similarity()` handle approximate whole-name matches; the ILIKE arm handles exact substring matches for "1oak" → "1 oak" style queries. If threshold produces false positives in testing, raise it — 0.2–0.25 is a reasonable adjustment range.

## Anti-Patterns

### Anti-Pattern 1: Fetching All Venues Then Filtering in TypeScript

**What people do:** `SELECT * FROM venues WHERE city_id = ?` (returning all 450 venues), then running `similarity()` logic in TypeScript.

**Why it's wrong:** Fetching all venues for every search query adds ~200 extra rows over the wire on every call. It also means implementing trigram logic in TypeScript (no standard library) instead of using PostgreSQL's native and indexed `pg_trgm`. The point of the DB RPC is to let Postgres do what it does well.

**Do this instead:** Use the `search_venues_fuzzy` RPC to let Postgres filter before anything crosses the wire.

### Anti-Pattern 2: Applying pg_trgm to Events or Performers

**What people do:** Add trigram similarity RPC calls for event name search and performer name search.

**Why it's wrong:** Events and performers are already fetched into memory scoped by city + date window (up to 2000 rows, chunked). The cost of fetching them is already paid. Adding DB round-trips for trigram scoring before that fetch would serialize what is currently a single efficient query. App-level accent normalization on already-fetched rows costs microseconds.

**Do this instead:** Apply `normalizeQuery()` + the modified `hasNeedle()` to in-memory rows only. DB fuzzy matching is reserved for venues, where the name is the primary search axis and the entity set is not pre-filtered by date.

### Anti-Pattern 3: Using `unaccent()` Directly in Index Expressions

**What people do:** `CREATE INDEX ... USING GIN (unaccent(name_en) gin_trgm_ops)` — using the built-in `unaccent()` function.

**Why it's wrong:** The built-in `unaccent()` is declared `STABLE`, not `IMMUTABLE`. PostgreSQL requires all functions in index expressions to be `IMMUTABLE`. Creating this index will fail with "ERROR: functions in index expression must be marked IMMUTABLE."

**Do this instead:** Create the `f_unaccent(text)` immutable wrapper function first, then build the index using `f_unaccent()`.

### Anti-Pattern 4: Normalizing in the DB RPC Instead of Before the Call

**What people do:** Pass the raw user input (`"CeLaVi"`) to the RPC and let the RPC normalize it via `f_unaccent(lower(?))`.

**Why it's wrong:** Not wrong for correctness, but creates duplication. The TypeScript services already need to normalize needles for the app-level event/performer filtering. Centralizing normalization in `normalize.ts` means one place to update the logic, and the RPC receives an already-normalized query, making the RPC simpler and its behavior easier to test independently.

**Do this instead:** Normalize in `normalize.ts` before any call — whether to the RPC or to in-memory filter functions.

### Anti-Pattern 5: Changing the Venue Search Query Path for All Cases

**What people do:** Route all `searchVenues()` calls through the RPC, even when no query is provided.

**Why it's wrong:** When no query is present, `searchVenues()` already returns the right set via the occurrence-based aggregation (city + date + genre filters). Adding a no-op RPC call adds latency and complexity.

**Do this instead:** Only call the RPC when `queryNeedle` is non-empty. The condition is: `if (queryNeedle) { ... use RPC ... }`.

## Scaling Considerations

The current scale is ~450 venues (Tokyo), with multi-city expansion planned. The GIN index on `venues.name_en` handles this efficiently.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 450 venues (Tokyo only) | GIN index handles easily — pg_trgm GIN index makes similarity lookups sub-millisecond |
| 5 cities (~2,000 venues) | Same architecture. RPC is already scoped by `p_city_id`, so each query only scans that city's venues |
| 20+ cities (~10,000 venues) | Same architecture. The `city_id` scoping in the RPC + index means the scanner never touches other cities' rows |
| name_ja / name fields | If non-English venue names need fuzzy search, add a second GIN index on `f_unaccent(lower(name))`. Low priority for Tokyo — `name_en` is the canonical search field |

## Sources

- Direct source read: `/Users/alcylu/Apps/nightlife-mcp/src/services/venues.ts` (full file — searchVenues, hasNeedle, query path)
- Direct source read: `/Users/alcylu/Apps/nightlife-mcp/src/services/events.ts` (full file — searchEvents, matchQuery, hasNeedle)
- Direct source read: `/Users/alcylu/Apps/nightlife-mcp/src/services/performers.ts` (full file — searchPerformers, query filter)
- [PostgreSQL pg_trgm documentation](https://www.postgresql.org/docs/current/pgtrgm.html) — similarity(), operators, GIN index support (HIGH confidence)
- [PostgreSQL unaccent documentation](https://www.postgresql.org/docs/current/unaccent.html) — dictionary behavior, STABLE vs IMMUTABLE (HIGH confidence)
- [Neon unaccent extension docs](https://neon.com/docs/extensions/unaccent) — immutable wrapper pattern, expression index example (HIGH confidence)
- [Unaccented Name Search with Postgres and Ecto](https://peterullrich.com/unaccented-name-search-with-postgres-and-ecto) — concrete example of f_unaccent + GIN(gin_trgm_ops) combined (MEDIUM confidence — community source, verified against official docs)
- [Supabase Extensions Overview](https://supabase.com/docs/guides/database/extensions) — confirmed unaccent and pg_trgm are available on Supabase (HIGH confidence)
- [MDN String.prototype.normalize()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize) — NFD normalization for diacritics stripping in JavaScript (HIGH confidence)
- `.planning/PROJECT.md` — v3.0 milestone target features and constraints

---
*Architecture research for: Fuzzy/accent-insensitive search — nightlife-mcp v3.0*
*Researched: 2026-03-12*
