# Phase 10: DB Infrastructure and Normalization Utility - Research

**Researched:** 2026-03-12
**Domain:** PostgreSQL fuzzy search extensions (pg_trgm, unaccent), GIN indexes, Supabase RPC, TypeScript accent normalization
**Confidence:** HIGH — grounded in project's own prior research docs (ARCHITECTURE.md, STACK.md, PITFALLS.md), PostgreSQL official docs, and direct codebase audit

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DB-01 | pg_trgm and unaccent extensions enabled on Supabase | Both extensions are pre-installed in Supabase cloud; enable via `CREATE EXTENSION IF NOT EXISTS` — idempotent and safe. |
| DB-02 | Immutable `f_unaccent` wrapper function created (required for index expressions) | `unaccent()` is STABLE not IMMUTABLE — PostgreSQL forbids STABLE functions in index definitions. Wrapper pattern is well-established; exact SQL in Code Examples. |
| DB-03 | GIN trigram index on normalized venue names (created with CONCURRENTLY to avoid blocking shared DB) | `CREATE INDEX CONCURRENTLY` is mandatory — shared DB with nightlife-tokyo-next; table lock would block consumer site writes. CONCURRENTLY cannot run inside a transaction block. |
| DB-04 | `search_venues_fuzzy` RPC function using `word_similarity` with configurable threshold | PostgREST cannot express the pg_trgm similarity operator as a `.filter()` call — RPC is the only correct path. `word_similarity` outperforms `similarity` for partial name matches. Exact function in Code Examples. |
| NORM-01 | Accent-insensitive search — "celavi" finds "CÉ LA VI", "é" matches "e", "ō" matches "o" | NFD normalization + `/[\u0300-\u036f]/g` strip covers all standard Latin diacritics. `unaccent` covers db side. Macrons (ō) may need custom unaccent rules — verify in Phase 10. |
| NORM-02 | Space/punctuation normalization — "celavi" matches "CÉ LA VI", "1oak" matches "1 OAK" | TypeScript: strip spaces before comparison. DB RPC: `replace(f_unaccent(lower(v.name_en)), ' ', '') ILIKE '%' || p_query || '%'` arm handles this. |
| NORM-03 | Number-word equivalence — "1oak" matches "oneoak", "1 OAK" matches "one oak" | Not a separate DB mechanism — covered by space collapse + ILIKE containment arm in the RPC. The normalized query "1oak" will substring-match inside "1 oak" (after space removal). "oneoak" matching "1 oak" is harder and may need a separate mapping — see Open Questions. |
| NORM-04 | Case-insensitive matching across all search tools | TypeScript: `.toLowerCase()` on needle before all comparisons. DB: `lower()` applied in index expression and RPC WHERE clause. Both already needed for DB-02/DB-04. |
</phase_requirements>

---

## Summary

Phase 10 is infrastructure-only: no user-visible behavior changes, no tool interface changes. It creates the database foundation (two PostgreSQL extensions, one immutable wrapper function, one GIN trigram index, one fuzzy search RPC) and the shared TypeScript utility (`src/utils/normalize.ts`) that all three phases of v3.0 will import.

The project already has detailed prior research (`.planning/research/ARCHITECTURE.md`, `STACK.md`, `PITFALLS.md`) from when the v3.0 milestone was scoped. Phase 10 research synthesizes that work into actionable implementation guidance. All architectural decisions are already locked. The planner's job is to sequence the steps and define verification checkpoints — not re-evaluate alternatives.

The single most important constraint: `CREATE INDEX CONCURRENTLY` cannot run inside a PostgreSQL transaction block. Supabase migrations run in transactions by default. The index creation must be isolated as a separate, non-transactional step — either a standalone SQL file or run manually via the Supabase SQL editor after the function migration completes.

**Primary recommendation:** Split the migration into two files — one transactional file for extensions + functions (DB-01, DB-02, DB-04), and one standalone CONCURRENTLY file for the index (DB-03). Apply both to production via psql with the service role key, same as all previous migrations.

---

## Standard Stack

### Core (No New npm Packages)

| Component | Version | Purpose | Why This |
|-----------|---------|---------|----------|
| `pg_trgm` PostgreSQL extension | Ships with PostgreSQL 14-17 | Trigram-based fuzzy similarity (`word_similarity`, GIN ops) | Pre-installed in Supabase cloud. Native, no npm dep. Only correct way to do DB-level typo-tolerant name matching. |
| `unaccent` PostgreSQL extension | Ships with PostgreSQL 14-17 | Strip diacritics from text (é→e, ō→o) | Pre-installed in Supabase cloud. Required for "CeLaVi" → "celavi" normalization before trigram comparison. |
| `f_unaccent(text)` DB function | Custom wrapper | IMMUTABLE proxy to `unaccent()` | Built-in `unaccent()` is STABLE — PostgreSQL refuses STABLE functions in index expressions. Wrapper is the standard solution. |
| Node.js `String.prototype.normalize('NFD')` | Built-in (Node 20+) | Decompose accented characters in TypeScript | Zero-dep, runtime-native. Pairs with regex to strip combining diacritical marks. |

### Supporting (Fallback — Not Used in Primary Path)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fuse.js` | 7.1.0 | App-level fuzzy matching on pre-fetched venue list | Only if Supabase RPC typing or CONCURRENTLY blocks cannot be resolved. Do not install unless the DB path hits an unrecoverable blocker. |

**Installation:**
```bash
# No new npm packages for the primary approach.
# Fallback only (do not install unless primary path is blocked):
# npm install fuse.js@7.1.0
```

---

## Architecture Patterns

### Recommended Project Structure (Phase 10 additions only)

```
src/
└── utils/
    └── normalize.ts          # NEW — normalizeQuery(), stripAccents()
supabase/
└── migrations/
    ├── 20260312_fuzzy_search.sql         # NEW — extensions + f_unaccent wrapper + RPC
    └── 20260312_fuzzy_search_index.sql   # NEW — GIN index (CONCURRENTLY, separate non-transactional step)
```

Everything else is unchanged in Phase 10. No modifications to service files, tool files, REST router, or types.

### Pattern 1: Two-File Migration Split (CONCURRENTLY Constraint)

**What:** Split the DB migration into two SQL files. The first file (transactional) creates extensions and functions. The second file creates the GIN index with CONCURRENTLY — which cannot run inside a transaction.

**When to use:** Always, for any index created with CONCURRENTLY on a shared production database.

**Why critical:** Supabase applies migrations inside a transaction by default. `CREATE INDEX CONCURRENTLY` inside a transaction causes PostgreSQL error: "ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block." The index creation silently fails or errors out if this constraint is violated.

**How to apply:**
1. Apply `20260312_fuzzy_search.sql` via psql (transactional — extensions + wrapper fn + RPC)
2. Apply `20260312_fuzzy_search_index.sql` via psql with `\set AUTOCOMMIT on` or run as a standalone statement outside a transaction

**Alternatively:** Run the index creation directly in the Supabase SQL editor (which does not wrap in a transaction by default).

### Pattern 2: Immutable Wrapper — Required Before Index Creation

**What:** The `f_unaccent(text)` function must exist in the DB before any index that uses it is created. The wrapper calls `unaccent` with an explicit dictionary reference, which is the only form of the call that PostgreSQL will accept in an IMMUTABLE function body.

**When to use:** Always, before any `CREATE INDEX ... USING GIN (f_unaccent(...) gin_trgm_ops)`.

**Key detail:** The exact function body must be:
```sql
SELECT public.unaccent('public.unaccent', $1)
```
Not `SELECT unaccent($1)` — the schema-qualified dictionary form is required for the IMMUTABLE contract to hold.

### Pattern 3: TypeScript Normalization via NFD + Regex

**What:** `src/utils/normalize.ts` exports `normalizeQuery(raw: string): string` that strips accents, collapses spaces, and lowercases — producing the normalized form that the DB RPC expects as input and that `hasNeedle()` comparisons use for events/performers.

**When to use:** Called at the top of any search handler that accepts a user `query` string.

**Why centralizing matters:** If normalization logic lives in multiple places (venues.ts, events.ts, performers.ts), they can diverge. A single export from `normalize.ts` guarantees all three phases of v3.0 apply identical logic.

### Anti-Patterns to Avoid

- **Using `unaccent()` directly in `CREATE INDEX`:** Will fail with "functions in index expression must be marked IMMUTABLE." Always use the `f_unaccent()` wrapper.
- **Running `CREATE INDEX CONCURRENTLY` inside a transaction block:** Causes PostgreSQL error. Must be outside any `BEGIN/COMMIT`.
- **Passing `unaccent(column_name)` to Supabase JS `.ilike()`:** PostgREST interprets the column argument literally; function calls are not valid column identifiers in the PostgREST filter API. Always use an RPC for accent-aware queries.
- **Normalizing in TypeScript only and relying on `ILIKE` for accent matching:** `ILIKE` is case-insensitive but not accent-insensitive. `'celavi' ILIKE 'ce la vi'` is false — the space difference prevents a match. The DB function must apply `f_unaccent(lower(...))` and the ILIKE containment or trigram arms must both be present in the RPC.
- **Index expression and query expression using different functions:** If the index is on `f_unaccent(lower(name_en))` but the RPC queries `lower(f_unaccent(name_en))`, the index will not be used. They must be identical in order.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accent stripping in PostgreSQL | Custom `REPLACE()` chain for individual accented chars | `unaccent` extension + `f_unaccent()` wrapper | `unaccent` handles 400+ diacritic mappings via its dictionary. Manual replacement would miss chars and needs constant maintenance. |
| Fuzzy name matching in TypeScript | Levenshtein distance algorithm, custom trigram implementation | `pg_trgm` extension via RPC | PostgreSQL's `pg_trgm` is battle-tested, uses GIN indexes for sub-millisecond lookups at scale, and handles the similarity scoring correctly. App-level trigram matching means fetching all venues first. |
| Accent stripping in TypeScript | Custom char-by-char replacement map | `String.prototype.normalize('NFD')` + regex | NFD decomposition + combining diacritic strip is the canonical Unicode solution. No lookup tables, no maintenance, handles all Latin diacritics correctly. |
| Storing pre-normalized venue names | Additional column `name_en_normalized` + trigger to maintain it | Expression index on `f_unaccent(lower(name_en))` | Expression indexes give identical query benefits with zero schema drift risk. No trigger, no extra column, no sync bugs. |

**Key insight:** The DB extension path (`unaccent` + `pg_trgm`) and the JavaScript NFD path are both standard library solutions. Building custom alternatives for either would be worse in coverage, performance, and maintainability.

---

## Common Pitfalls

### Pitfall 1: CONCURRENTLY Inside a Transaction Block

**What goes wrong:** The migration file wraps `CREATE INDEX CONCURRENTLY` in a `BEGIN/COMMIT` (or Supabase runs it in a transaction), causing PostgreSQL error: "CREATE INDEX CONCURRENTLY cannot run inside a transaction block."

**Why it happens:** Standard Supabase migration practice wraps statements in transactions. Developers copy `CREATE INDEX CONCURRENTLY` into a migration file without realizing the constraint.

**How to avoid:** Put the index creation in a separate SQL file with no `BEGIN`/`COMMIT`. Apply it via `psql` with autocommit, or run it directly in Supabase SQL editor.

**Warning signs:** Migration logs show "ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block." — or the index simply does not appear in `pg_stat_user_indexes`.

### Pitfall 2: Wrong `f_unaccent()` Function Body

**What goes wrong:** Creating `f_unaccent` with body `SELECT unaccent($1)` instead of `SELECT public.unaccent('public.unaccent', $1)`. The simple form may work for queries but is not truly IMMUTABLE — PostgreSQL may allow it but the optimizer cannot guarantee index stability, and the index may be skipped.

**Why it happens:** The simpler form is seen in blog posts. The schema-qualified dictionary form is in the PostgreSQL docs but less commonly cited.

**How to avoid:** Use the exact body: `SELECT public.unaccent('public.unaccent', $1);` — this explicitly binds to the `unaccent` dictionary in the `public` schema, which satisfies the IMMUTABLE contract.

**Warning signs:** `EXPLAIN ANALYZE` shows `Seq Scan` instead of `Index Scan` even after index creation.

### Pitfall 3: Macron Gap (ō, ū) in Default `unaccent.rules`

**What goes wrong:** `SELECT f_unaccent('ō')` returns `'ō'` (unchanged), not `'o'`. Japanese romanization uses macrons (Tōkyō, Ōsaka). A venue named "Ōsaka" is invisible to a query for "Osaka".

**Why it happens:** The default PostgreSQL `unaccent.rules` file covers Western European diacritics but has documented gaps for macrons and katakana. Developers test with `é` and `ü`, which work, and miss the macrons.

**How to avoid:** In Phase 10, verify macron handling immediately with `SELECT f_unaccent('ō'), f_unaccent('ū'), f_unaccent('ā')`. If they return unchanged, extend the `unaccent.rules` file with mappings (`ō→o`, `ū→u`, `ā→a`, `ī→i`, `ē→e` plus uppercase). This is a ~10-line addition and does not require a PostgreSQL restart on Supabase cloud.

**Warning signs:** `SELECT f_unaccent('ō')` returns `'ō'` — not `'o'`.

### Pitfall 4: `word_similarity` vs `similarity` — Short Query Score Mismatch

**What goes wrong:** Using `similarity()` instead of `word_similarity()` causes "celavi" vs "ce la vi" to score too low. `similarity()` compares full string trigram sets — a short query "celavi" has fewer trigrams than the full venue name, penalizing the score. "celavi" vs "ce la vi" may score ~0.28, below a 0.3 threshold.

**Why it happens:** `similarity` is the more commonly documented function. `word_similarity` (which checks if the query trigrams are a subset of the target's trigrams) is better suited for name search.

**How to avoid:** Use `word_similarity(p_query, f_unaccent(lower(v.name_en)))` in both the WHERE condition and the ORDER BY. Start with threshold 0.15 — the ILIKE containment arms catch the easy cases and the similarity arm catches the truly fuzzy ones.

**Warning signs:** "celavi" returns 0 results from the RPC even though the ILIKE arm should catch it. Run `SELECT word_similarity('celavi', 'ce la vi')` in Supabase SQL editor to verify the score.

### Pitfall 5: Index Expression Order Mismatch

**What goes wrong:** Index is created on `f_unaccent(lower(name_en))` but RPC queries `lower(f_unaccent(name_en))`. The query planner sees these as different expressions and does not use the index — resulting in a full table scan.

**Why it happens:** The index and query are written at different times, in different files, and the order of `lower()` and `f_unaccent()` is swapped.

**How to avoid:** Canonicalize the expression as `f_unaccent(lower(column))` — strip accents after lowercasing. Use this exact expression in both the `CREATE INDEX` definition and the RPC `WHERE`/`ORDER BY` clauses. Document this in a comment above both usages.

**Warning signs:** `EXPLAIN ANALYZE` shows `Seq Scan on venues` even after index creation.

---

## Code Examples

Verified patterns from project research and official sources:

### Migration File 1: Extensions + Wrapper Function + RPC (Transactional)

```sql
-- supabase/migrations/20260312_fuzzy_search.sql

-- 1. Enable extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. IMMUTABLE wrapper around unaccent()
--    Built-in unaccent() is STABLE — PostgreSQL forbids STABLE in index expressions.
--    Schema-qualified dictionary form is required for IMMUTABLE to hold.
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$
  SELECT public.unaccent('public.unaccent', $1)
$$;

-- 3. Fuzzy venue search RPC scoped by city
--    Uses word_similarity (not similarity) — better for partial name matches.
--    ILIKE arms handle space-stripped and exact containment cases.
CREATE OR REPLACE FUNCTION public.search_venues_fuzzy(
  p_city_id   uuid,
  p_query     text,    -- pre-normalized: lowercased, diacritics stripped, spaces removed
  p_threshold float    DEFAULT 0.15,
  p_limit     int      DEFAULT 200
)
RETURNS SETOF public.venues
LANGUAGE sql STABLE AS
$$
  SELECT v.*
  FROM public.venues v
  WHERE v.city_id = p_city_id
    AND (
      word_similarity(p_query, f_unaccent(lower(v.name_en))) > p_threshold
      OR f_unaccent(lower(v.name_en)) ILIKE '%' || p_query || '%'
      OR replace(f_unaccent(lower(v.name_en)), ' ', '') ILIKE '%' || p_query || '%'
    )
  ORDER BY word_similarity(p_query, f_unaccent(lower(v.name_en))) DESC
  LIMIT p_limit;
$$;
```

### Migration File 2: GIN Index (Non-Transactional, CONCURRENTLY)

```sql
-- supabase/migrations/20260312_fuzzy_search_index.sql
-- IMPORTANT: Run this OUTSIDE a transaction block.
-- In psql: \set AUTOCOMMIT on
-- Or run directly in Supabase SQL editor (no transaction wrapper).

-- 4. GIN trigram index on normalized venue name_en
--    Expression must match exactly what the RPC uses in its WHERE clause.
CREATE INDEX CONCURRENTLY IF NOT EXISTS venues_name_en_fuzzy
  ON public.venues
  USING GIN (f_unaccent(lower(name_en)) gin_trgm_ops);
```

### TypeScript Normalization Utility

```typescript
// src/utils/normalize.ts
// Source: MDN String.prototype.normalize + project ARCHITECTURE.md

/**
 * Normalize a search query for accent-insensitive, space-insensitive matching.
 * Output is used as input to:
 * - DB RPC search_venues_fuzzy (p_query argument)
 * - hasNeedle() comparisons in events.ts and performers.ts
 *
 * Rules:
 * 1. NFD decomposition — splits accented chars into base + combining diacritic
 * 2. Strip combining diacritics (U+0300–U+036F) — é→e, ō→o, ü→u
 * 3. Collapse all whitespace (handles "1 OAK" → "1oak" matching)
 * 4. Lowercase
 */
export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .replace(/\s+/g, '')              // collapse all whitespace
    .toLowerCase();
}

/**
 * Strip accents only, preserving spaces.
 * Used for normalizing haystack values in hasNeedle() comparisons.
 */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
```

### How the RPC Is Called (from venues.ts pattern)

```typescript
// Source: src/auth/authorize.ts — existing .rpc() usage pattern in this codebase
// Phase 11 will wire this — but Phase 10 must ensure the RPC exists and is callable.

const { data, error } = await supabase.rpc('search_venues_fuzzy', {
  p_city_id:   city.id,
  p_query:     normalizeQuery(input.query || ''),  // pre-normalized
  p_threshold: 0.15,
  p_limit:     200,
});
```

### Verification SQL (Run in Supabase SQL Editor After Migration)

```sql
-- DB-01: Extensions enabled
SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm');

-- DB-02: f_unaccent wrapper works (accent stripping)
SELECT f_unaccent('CÉ LA VI');  -- Expected: 'CE LA VI'
SELECT f_unaccent('é'), f_unaccent('ō'), f_unaccent('ü');  -- Expected: 'e', 'o', 'u'

-- DB-03: GIN index is active
SELECT indexname, idx_scan
FROM pg_stat_user_indexes
WHERE tablename = 'venues' AND indexname = 'venues_name_en_fuzzy';

-- DB-03: Index is actually used (not a seq scan)
EXPLAIN ANALYZE
SELECT * FROM venues WHERE f_unaccent(lower(name_en)) ILIKE '%celavi%' LIMIT 1;

-- DB-04: Fuzzy RPC callable and returns CÉ LA VI
-- Replace '<tokyo_city_id>' with actual UUID from cities table
SELECT id, name_en FROM search_venues_fuzzy('<tokyo_city_id>', 'celavi', 0.15, 10);
SELECT id, name_en FROM search_venues_fuzzy('<tokyo_city_id>', '1oak', 0.15, 10);
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `.ilike('name_en', '%celavi%')` via Supabase JS | `search_venues_fuzzy` RPC with `pg_trgm` + `unaccent` | Accent variants and typos now find the right venue |
| Direct `unaccent()` in queries (STABLE, no index) | `f_unaccent()` immutable wrapper (IMMUTABLE, indexable) | GIN index can be built; seq scans eliminated |
| No TypeScript normalization | `normalizeQuery()` in `src/utils/normalize.ts` | Single source of truth for all three phases |

**Deprecated / do not use:**
- `unaccent()` directly in index expressions — will fail or not be used by planner
- Supabase PostgREST `.textSearch()` for venue name matching — wrong tool (it's for full-text document search, not short name similarity)
- `similarity()` instead of `word_similarity()` for partial name queries — penalizes short queries

---

## Open Questions

1. **NORM-03: "1oak" → "1 OAK" vs "oneoak" → "one oak" (number-word equivalence)**
   - What we know: Space collapse handles "1oak" matching "1 OAK" (ILIKE arm strips spaces). The trigram arm also scores these similarly.
   - What's unclear: "oneoak" matching "1 OAK" is a different problem — it requires a digit-to-word mapping ("1" → "one"). The RPC as designed does not handle this.
   - Recommendation: Implement space/accent normalization for Phase 10. Add a digit-to-word mapping step in `normalizeQuery()` as an optional enhancement (e.g., `'1' → 'one'`, `'2' → 'two'`). Document as a gap and test with "oneoak" after Phase 11 — if it's a real-world miss, add the mapping. The REQUIREMENTS.md lists this under NORM-03 but it may be over-specified for v3.0 scope.

2. **Macron handling in Supabase's unaccent installation**
   - What we know: Default `unaccent.rules` may not map ō→o, ū→u.
   - What's unclear: Whether Supabase's managed PostgreSQL ships a patched or extended `unaccent.rules` that already covers macrons.
   - Recommendation: First action of Phase 10 DB work — run `SELECT f_unaccent('ō')` in Supabase SQL editor before writing the migration. If it returns `'o'`, macrons are covered and no extra work is needed. If it returns `'ō'`, plan to add custom rules — estimated 20 minutes.

3. **Tokyo city_id UUID for RPC verification**
   - What we know: The RPC is scoped by `p_city_id` (UUID). The success criteria requires calling it with the Tokyo city_id.
   - What's unclear: The exact UUID is not in project docs.
   - Recommendation: Add a task to `SELECT id FROM public.cities WHERE slug = 'tokyo'` and record it in the phase plan for use in verification.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) + `node:assert/strict` |
| Config file | None — run via `tsx --test` |
| Quick run command | `npm test` (runs `tsx --test src/**/*.test.ts`) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | Extensions enabled in Supabase | manual | SQL: `SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm')` | N/A (DB-only) |
| DB-02 | `f_unaccent('CÉ LA VI')` returns `'ce la vi'` | manual | SQL: `SELECT f_unaccent('CÉ LA VI')` | N/A (DB-only) |
| DB-03 | GIN index active, `EXPLAIN ANALYZE` shows Index Scan | manual | SQL: `EXPLAIN ANALYZE SELECT ...` | N/A (DB-only) |
| DB-04 | `search_venues_fuzzy` returns CÉ LA VI for 'celavi' | manual | SQL: `SELECT * FROM search_venues_fuzzy('<tokyo_id>', 'celavi', 0.15, 10)` | N/A (DB-only) |
| NORM-01 | `normalizeQuery('é')` returns `'e'` | unit | `npm test` | ❌ Wave 0: `src/utils/normalize.test.ts` |
| NORM-02 | `normalizeQuery('CÉ LA VI')` returns `'celavi'` | unit | `npm test` | ❌ Wave 0: `src/utils/normalize.test.ts` |
| NORM-03 | `normalizeQuery('1oak')` returns `'1oak'` | unit | `npm test` | ❌ Wave 0: `src/utils/normalize.test.ts` |
| NORM-04 | `normalizeQuery('CeLaVi')` returns `'celavi'` | unit | `npm test` | ❌ Wave 0: `src/utils/normalize.test.ts` |

### Sampling Rate

- **Per task commit:** `npm test` (runs existing test suite — confirms no regressions)
- **Per wave merge:** `npm test` + manual SQL verification of DB-01 through DB-04
- **Phase gate:** Full suite green + all 4 DB verification SQL statements pass before proceeding to Phase 11

### Wave 0 Gaps

- [ ] `src/utils/normalize.test.ts` — covers NORM-01 through NORM-04 with exact test cases from success criteria:
  - `normalizeQuery('CeLaVi')` → `'celavi'`
  - `normalizeQuery('1oak')` → `'1oak'`
  - `normalizeQuery('é')` → `'e'`
  - `normalizeQuery('CÉ LA VI')` → `'celavi'` (accent + space)
  - `stripAccents('CÉ LA VI')` → `'CE LA VI'` (spaces preserved)

No framework install needed — `node:test` is built-in and already used in `src/utils/recommendationFeatures.test.ts`.

---

## Sources

### Primary (HIGH confidence)

- `.planning/research/ARCHITECTURE.md` — full system architecture, data flows, build order, anti-patterns
- `.planning/research/STACK.md` — extension versions, RPC signature, TypeScript normalization pattern, fallback analysis
- `.planning/research/PITFALLS.md` — 8 critical pitfalls with prevention and recovery steps
- `src/services/venues.ts` (direct read) — existing `hasNeedle()`, `sanitizeIlike()`, VenueRow types, VENUE_SELECT
- `src/auth/authorize.ts` (direct read) — existing `.rpc()` call pattern in this codebase
- `src/utils/recommendationFeatures.test.ts` (direct read) — confirmed test framework is `node:test`
- [PostgreSQL pg_trgm documentation](https://www.postgresql.org/docs/current/pgtrgm.html) — `word_similarity`, GIN ops, threshold behavior
- [PostgreSQL unaccent documentation](https://www.postgresql.org/docs/current/unaccent.html) — STABLE limitation, dictionary reference
- [Neon unaccent extension docs](https://neon.com/docs/extensions/unaccent) — immutable wrapper exact SQL (Neon runs same PostgreSQL as Supabase)
- [Supabase extensions overview](https://supabase.com/docs/guides/database/extensions) — confirmed `pg_trgm` and `unaccent` are available

### Secondary (MEDIUM confidence)

- [Unaccented Name Search with Postgres and Ecto](https://peterullrich.com/unaccented-name-search-with-postgres-and-ecto) — confirmed `f_unaccent` + GIN combined index pattern, verified against official docs
- [MDN String.prototype.normalize()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize) — NFD normalization for diacritics stripping in JavaScript

### Tertiary (LOW confidence, use for orientation only)

- Supabase fuzzy search community discussion — confirms pg_trgm is the standard Supabase approach; does not address CONCURRENTLY constraint

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — extensions confirmed pre-installed on Supabase; versions confirmed in PostgreSQL docs; no new npm packages
- Architecture: HIGH — patterns verified in prior project research docs and confirmed against official PostgreSQL docs
- Pitfalls: HIGH — CONCURRENTLY constraint is official PostgreSQL behavior; STABLE/IMMUTABLE distinction is in official docs; all confirmed in prior project PITFALLS.md
- TypeScript normalize pattern: HIGH — NFD + regex is the canonical Unicode approach; confirmed in MDN docs

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (PostgreSQL extension APIs are stable; Supabase extension availability confirmed)

---

*Phase 10 research — synthesized from project's own `.planning/research/` docs + direct codebase audit*
*No new external research was needed — the project's prior research already covers this domain at HIGH confidence*
