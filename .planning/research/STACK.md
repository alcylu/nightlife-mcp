# Stack Research

**Domain:** Fuzzy and accent-insensitive search — PostgreSQL extensions + application-level normalization for an MCP server with 450 venues
**Researched:** 2026-03-12
**Confidence:** HIGH (PostgreSQL extension docs confirmed; Supabase support confirmed; fuse.js version confirmed via GitHub/npm)

---

## The Core Question

The existing search uses Supabase PostgREST `.ilike()` and `.textSearch()`. Neither strips accents (é, ō, ü) nor tolerates typos. Gemini 2.5 Flash called `search_venues` with "CeLaVi" and got zero results — the DB stores "CÉ LA VI". Fix this without adding a new search infrastructure.

Three capabilities are needed, each at different aggressiveness:

| Capability | Where needed | Approach |
|------------|-------------|----------|
| Accent stripping (é→e) | All tools — venues, events, performers | `unaccent` PostgreSQL extension |
| Space/case normalization ("1oak" → "1 OAK") | All tools | Application-level: strip spaces + lowercase before querying |
| Typo tolerance ("Zeuk" finds "Zouk") | Venues only (450 scoped by city) | `pg_trgm` PostgreSQL extension via Supabase RPC |

---

## Recommended Stack

### Core Technologies (New Additions Only)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `pg_trgm` (PostgreSQL built-in extension) | ships with PostgreSQL 14-17 | Trigram-based fuzzy similarity matching for venue names | Native to Supabase. No new dependency. Indexes support similarity operators (`%`, `<->`) and ILIKE. GIN index makes fuzzy search on 450 venues effectively instant. The only correct way to do typo-tolerant search inside the DB. |
| `unaccent` (PostgreSQL built-in extension) | ships with PostgreSQL 14-17 | Strips diacritics from text (é→e, ō→o, ü→u) | Native to Supabase. Pre-installed alongside pg_trgm. Required for "CeLaVi" to match "CÉ LA VI". Pairs with pg_trgm: normalize first, then fuzzy match. |

No new npm packages needed. Both extensions are already available in the Supabase-managed PostgreSQL instance — they just need to be enabled via a migration.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fuse.js` | `7.1.0` (released 2025-02-03) | Application-level fuzzy matching for pre-fetched venue lists | Only if DB-level pg_trgm approach hits a blocker (e.g., Supabase RPC typing issues). This is the fallback path, not the primary approach. Ships TypeScript types. Zero dependencies. |

fuse.js is explicitly a fallback. The primary approach is DB-level (pg_trgm + unaccent RPC). Only reach for fuse.js if the PostgreSQL extension path is blocked.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Supabase SQL editor / migration file | Enable extensions + create immutable wrapper + GIN index + RPC function | All four steps go in a single migration file. Run via `psql` against production after local verification. |

---

## Installation

```bash
# No new npm packages needed for the primary (DB-level) approach.

# Fallback only — if pg_trgm RPC approach is blocked:
npm install fuse.js@7.1.0
```

The real "installation" is a Supabase migration file:

```sql
-- 1. Enable extensions
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Create an IMMUTABLE wrapper around unaccent()
--    Required: PostgreSQL forbids STABLE functions in index expressions.
--    This wrapper calls unaccent with an explicit dictionary reference,
--    which makes it safe to mark IMMUTABLE.
CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$
  SELECT public.unaccent('public.unaccent', $1);
$$;

-- 3. Create a GIN trigram index on normalized venue names
--    Normalize: strip accents + lowercase. GIN beats GiST for small result sets.
CREATE INDEX IF NOT EXISTS idx_venues_name_trgm
  ON venues
  USING GIN (f_unaccent(lower(name)) gin_trgm_ops);

-- 4. Fuzzy venue search RPC
--    PostgREST cannot express the pg_trgm similarity operator (%) as a filter.
--    An RPC function is the only path. Threshold 0.2 catches "Zeuk"→"Zouk".
--    word_similarity used (not similarity) so partial matches like "1oak"
--    still score well against "1 OAK".
CREATE OR REPLACE FUNCTION search_venues_fuzzy(
  p_query       text,
  p_city_id     uuid,
  p_limit       int DEFAULT 20,
  p_threshold   float DEFAULT 0.2
)
RETURNS TABLE (
  id            uuid,
  name          text,
  slug          text,
  city_id       uuid,
  similarity    float
)
LANGUAGE sql STABLE AS
$$
  SELECT
    v.id,
    v.name,
    v.slug,
    v.city_id,
    word_similarity(f_unaccent(lower(p_query)), f_unaccent(lower(v.name))) AS similarity
  FROM venues v
  WHERE
    v.city_id = p_city_id
    AND word_similarity(f_unaccent(lower(p_query)), f_unaccent(lower(v.name))) >= p_threshold
  ORDER BY similarity DESC
  LIMIT p_limit;
$$;
```

---

## Integration Points

### How the TypeScript service calls the RPC

```typescript
// In src/services/venues.ts — fuzzy path when normal ilike returns 0 results
const { data, error } = await supabase
  .rpc('search_venues_fuzzy', {
    p_query:     normalizedQuery,  // already lowercased + space-stripped in app layer
    p_city_id:   cityId,
    p_limit:     limit,
    p_threshold: 0.2,
  });
```

PostgREST exposes all RPC functions automatically. The `@supabase/supabase-js` `.rpc()` method passes parameters by name matching the PostgreSQL function's parameter names exactly.

### Application-level normalization (do this before any DB query)

Space/case normalization happens in the TypeScript layer before the query hits Supabase. This handles "1oak" → "1 OAK" by stripping non-alphanumeric characters and lowercasing:

```typescript
// src/utils/normalize.ts
export function normalizeQuery(q: string): string {
  return q
    .normalize('NFD')                    // decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')     // strip combining diacritical marks
    .replace(/[^a-z0-9\s]/gi, '')        // strip punctuation
    .replace(/\s+/g, ' ')               // collapse whitespace
    .trim()
    .toLowerCase();
}
```

This runs in every search handler before hitting Supabase. It's cheap (pure string manipulation) and makes the DB query simpler. The DB still applies `f_unaccent()` on its side for belt-and-suspenders — different Unicode normalization paths can yield different results.

### Search strategy (venues)

```
User query: "CeLaVi"
Step 1: app normalizes → "celavi"
Step 2: try ilike with unaccent: WHERE f_unaccent(lower(name)) ILIKE '%celavi%'
Step 3: if 0 results → call search_venues_fuzzy RPC with threshold 0.2
Step 4: merge/return results
```

For events and performers: only Steps 1–2 (no fuzzy RPC). Accent stripping + ilike is sufficient for events/performers because the corpus is larger and fuzzy false-positives would be too noisy.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `pg_trgm` RPC (DB-level fuzzy) | `fuse.js` (app-level fuzzy) | fuse.js is correct when: (a) dataset fits in memory, (b) you want zero migration risk, (c) pg_trgm RPC has typing/auth issues. 450 venues fits easily in memory (~50KB). fuse.js is the safe fallback. |
| `pg_trgm` RPC (DB-level fuzzy) | Elasticsearch / Algolia / Meilisearch | These are the right tools at 50K+ records or when you need faceted/semantic search. For 450 venues in a single city scope, the added ops burden is unjustifiable. |
| `word_similarity` operator (`<%`) | `similarity` operator (`%`) | `similarity` compares entire strings — "celavi" vs "CÉ LA VI" scores low because length difference penalizes. `word_similarity` checks if the query is similar to any extent of the target string — far better for partial/abbreviated matches. |
| GIN index | GiST index | GiST is faster to build and update but slower to query. GIN wins on read performance for small result sets (which is every venue search). Venues are mostly static — insert/update cost is irrelevant. |
| Immutable `f_unaccent()` wrapper | Direct `unaccent()` in index | PostgreSQL requires IMMUTABLE functions in index expressions. `unaccent()` is STABLE, not IMMUTABLE — index creation fails without the wrapper. This is a well-known PostgreSQL constraint, not a Supabase limitation. |
| Application-level Unicode normalization | DB-only normalization | Both run. The app layer catches common NFD vs NFC encoding differences before the query. The DB layer catches anything the app missed. Belt-and-suspenders is correct here. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `fuzzball` npm package | Levenshtein/Jaro-Winkler implementations; heavier than fuse.js; no maintained TS types; fuse.js is more popular and better documented | `fuse.js@7.1.0` if you need app-level fuzzy |
| `elasticlunr`, `lunr` | Full-text search engines designed for documents, not short venue names; no accent normalization built in; unmaintained | `pg_trgm` via RPC |
| `pg_trgm` on events/performers search | Events/performers have a larger corpus and fuzzy matching would produce confusing false-positives (e.g., "house" matching "warehouse" for genre search). The signal-to-noise ratio is too low. | Accent normalization + ilike only for events/performers |
| Storing pre-normalized names in a separate column | Adds a trigger + extra column to maintain; index expressions on `f_unaccent(lower(name))` give the same benefit with zero schema drift risk | Expression index on `f_unaccent(lower(name))` |
| Raising similarity threshold above 0.3 for venues | "Zeuk" has similarity ~0.22 against "Zouk". A threshold of 0.3 (pg_trgm default) would miss it. Start at 0.2 for venue names; tune up if false-positives appear in production. | Start at 0.2, monitor production logs |

---

## Stack Patterns by Variant

**If query returns results via ilike:**
- Return those results directly. Don't run the fuzzy RPC — it's an expensive fallback.

**If query returns zero results via ilike and query.length >= 3:**
- Run `search_venues_fuzzy` RPC with threshold 0.2.
- pg_trgm requires at least 1 trigram to work. Strings shorter than 3 characters produce no trigrams and will always score 0. Skip the RPC for 1-2 character queries.

**If the fuzzy RPC itself returns zero results:**
- Return empty with `{ message: "No venues found matching [query]" }`.
- Do not cascade to a third approach — that would produce irrelevant results.

**For events and performers:**
- No fuzzy RPC. Apply application-level normalization + `f_unaccent(lower(name)) ILIKE '%query%'` only.
- This requires updating the Supabase query from `.ilike('name', ...)` to a raw filter expression, or running the normalization RPC-side via a simpler `search_events_accent` RPC that wraps the ilike with unaccent.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `pg_trgm` (PostgreSQL extension) | PostgreSQL 14, 15, 16, 17; Supabase cloud | Pre-installed in Supabase. Enable with `CREATE EXTENSION IF NOT EXISTS pg_trgm`. GIN index operator class `gin_trgm_ops` available on all supported versions. |
| `unaccent` (PostgreSQL extension) | PostgreSQL 14, 15, 16, 17; Supabase cloud | Pre-installed in Supabase. Enable with `CREATE EXTENSION IF NOT EXISTS unaccent`. Immutable wrapper pattern required on all versions. |
| `@supabase/supabase-js` | `^2.x` (currently `^2.50.0` in this project) | `.rpc()` method supports all PostgreSQL function signatures. Parameters passed by name must match exactly (including `p_` prefix convention used here). |
| `fuse.js@7.1.0` (fallback only) | Node.js 16+, TypeScript 5+, ESM + CJS | Zero dependencies. Ships its own type definitions — no `@types/fuse.js` needed. Last published 2025-02-03. |

---

## Sources

- [PostgreSQL pg_trgm documentation (v18 current)](https://www.postgresql.org/docs/current/pgtrgm.html) — functions, operators, index types, threshold GUC parameters — HIGH confidence
- [PostgreSQL unaccent documentation (v17)](https://www.postgresql.org/docs/17/unaccent.html) — extension behavior, STABLE vs IMMUTABLE limitation — HIGH confidence
- [Neon docs — unaccent extension](https://neon.com/docs/extensions/unaccent) — immutable wrapper pattern, exact SQL — HIGH confidence (Neon runs same PostgreSQL version as Supabase)
- [Supabase docs — extensions overview](https://supabase.com/docs/guides/database/extensions) — pg_trgm and unaccent confirmed available and pre-installed — HIGH confidence
- [GitHub — krisk/Fuse](https://github.com/krisk/Fuse) — fuse.js v7.1.0 confirmed as latest, TypeScript support confirmed — HIGH confidence
- [Aapelivuorinen.com — Postgres text search vs trigrams](https://www.aapelivuorinen.com/blog/2021/02/24/postgres-text-search/) — when to use trigrams vs FTS for short name fields — MEDIUM confidence (community, patterns still current)
- [pganalyze — GIN indexes](https://pganalyze.com/blog/gin-index) — GIN vs GiST for trigram use case — MEDIUM confidence (community, authoritative author)
- Existing codebase — `@supabase/supabase-js` `.rpc()` usage already in `src/services/cities.ts` and `src/auth/authorize.ts` — HIGH confidence (live code)

---

*Stack research for: v3.0 fuzzy/accent-insensitive search — nightlife-mcp venues, events, performers*
*Researched: 2026-03-12*
