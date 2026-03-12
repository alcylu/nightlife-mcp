# Pitfalls Research

**Domain:** Fuzzy/accent-insensitive search on an existing venue discovery system (Supabase/PostgreSQL, Japanese + Latin content)
**Researched:** 2026-03-12
**Milestone:** v3.0 — Fuzzy Search
**Confidence:** HIGH (grounded in PostgreSQL official docs, Supabase community reports, and direct codebase audit)

---

## Critical Pitfalls

### Pitfall 1: `unaccent()` Is Not Indexable — Sequential Scans Kill Search Performance

**What goes wrong:**
PostgreSQL's `unaccent()` function is `STABLE`, not `IMMUTABLE`. PostgreSQL only allows `IMMUTABLE` functions in index definitions. If you wrap `.ilike()` calls with `unaccent()` at query time — e.g., `WHERE unaccent(name) ILIKE unaccent('%celavi%')` — PostgreSQL cannot use any GIN or B-tree index on the `name` column. Every search becomes a full sequential scan across all venue rows in the table.

With 450 venues scoped by city, a sequential scan is currently survivable. But as rows grow and as the same pattern is applied to `events` and `performers` tables (which can have thousands of rows), this becomes a correctness-masquerading-as-a-performance-bug: searches work but degrade silently.

**Why it happens:**
Developers see `unaccent()` examples in blog posts and docs that show it working in `WHERE` clauses without mentioning the index limitation. The function appears to work — queries return correct results — so the missing index goes unnoticed until load increases.

**How to avoid:**
Create an `IMMUTABLE` wrapper function around `unaccent()` and index that wrapper:

```sql
-- Create immutable wrapper (required for indexing)
CREATE OR REPLACE FUNCTION f_unaccent(text)
RETURNS text AS $$
  SELECT public.unaccent($1)
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- Index using the wrapper
CREATE INDEX CONCURRENTLY idx_venues_name_unaccent
ON venues USING gin (f_unaccent(name) gin_trgm_ops);
```

Use `f_unaccent()` (not `unaccent()`) in all query `WHERE` clauses and index definitions. Never use the raw `unaccent()` function in an index definition — it will fail or fall back to a seq scan silently depending on PostgreSQL version.

**Warning signs:**
- `EXPLAIN ANALYZE` on a venue search shows `Seq Scan` instead of `Index Scan` or `Bitmap Index Scan`.
- Query time grows linearly as venue/event count increases.
- Any index created using `unaccent()` directly was silently rejected or is unused by the planner.

**Phase to address:** Phase 1 (DB schema + indexes). Create the immutable wrapper function and all indexes before writing any application-level search logic.

---

### Pitfall 2: `unaccent` Does Not Cover All Characters in the Dataset — Silent Miss for Some Accents

**What goes wrong:**
The default `unaccent.rules` file covers most Western European diacritics (é→e, ü→u, ñ→n, etc.) but has documented gaps:
- **Macrons** (ō, ū, ā) used in Japanese romanization (e.g., "Tōkyō", "Ōsaka") — these may not be stripped, meaning `unaccent('ō')` returns `'ō'` unchanged, not `'o'`. A user searching "Osaka" would not find a venue named "Ōsaka".
- **Katakana with voiced marks** (dakuten/handakuten — e.g., ド, ガ) — `unaccent()` does not strip these because they are not European diacritics; they are distinct characters in a different Unicode block. A bug report (PostgreSQL BUG #18216) confirms `unaccent()` fails on katakana like 'ド'.
- **Ligatures** like Æ, Œ are expanded but may not match user expectations.

Any venue or event name in the DB that uses macron romanization or katakana with diacritical marks will be invisible to searches that only apply `unaccent()`.

**Why it happens:**
Developers test `unaccent()` with common European examples (é, ü, ñ) which all work correctly. The gaps in coverage for less-common Unicode ranges are only discovered when a specific character fails in production.

**How to avoid:**
- Do not rely solely on `unaccent()` for Japanese content. Handle katakana and hiragana separately at the application layer using a normalization step before querying.
- For macrons in romanization: extend the `unaccent.rules` file to add mappings for `ō→o`, `ū→u`, `ā→a`, `ī→i`, `ē→e` (and their uppercase variants). These can be added without restarting PostgreSQL.
- Audit all venue names in the DB before launch: `SELECT name FROM venues WHERE name ~ '[^\x00-\x7F]'` — inspect all non-ASCII characters and verify `unaccent()` handles each one.
- Write test cases specifically for: "CÉ LA VI" → "celavi", "Ōsaka" → "osaka", "1 OAK" → "1 oak".

**Warning signs:**
- `SELECT unaccent('ō')` returns `'ō'` (unchanged, not `'o'`).
- Venue search for "osaka" returns zero results when a venue named "Ōsaka" exists.
- No test coverage for non-European accent characters.

**Phase to address:** Phase 1 (DB setup). Audit character coverage before building search logic. Add custom rules for macrons. Add katakana normalization at the TypeScript layer.

---

### Pitfall 3: pg_trgm Silently Ignores Non-ASCII Characters — Japanese Venue Names Are Invisible to Fuzzy Search

**What goes wrong:**
`pg_trgm` is the standard PostgreSQL fuzzy search extension. By default, it ignores non-alphanumeric characters when building trigrams. In most PostgreSQL builds, this means **non-ASCII characters (including all kanji, hiragana, katakana) are stripped entirely before trigram extraction**. The result: a venue named "渋谷 WARP" generates trigrams only from "WARP". Searching for "渋谷" returns zero results. Worse, there is no error — the search silently finds nothing.

This is confirmed by the PGroonga project documentation: "pg_trgm disables non-ASCII character support. It means that pg_trgm doesn't support many Asian languages such as Japanese and Chinese by default."

**Why it happens:**
`pg_trgm` is the recommended solution in virtually all Supabase fuzzy search articles and the Supabase documentation itself. None of these resources prominently flag the non-ASCII limitation. Developers add the GIN trigram index, test with Latin-alphabet queries, see it working, and ship — without ever testing Japanese-character queries.

**How to avoid:**
Two complementary strategies:
1. **For Latin-alphabet fuzzy search** (typo tolerance for names like "CeLaVi", "1oak"): Use `pg_trgm` + `unaccent()` wrapper — this works correctly because names are normalized to ASCII before trigram extraction.
2. **For Japanese-character search**: Do NOT rely on `pg_trgm`. Use `ILIKE` with explicit wildcard patterns after normalizing the query. For example: `WHERE name ILIKE '%渋谷%'`. PostgreSQL's `ILIKE` handles multi-byte UTF-8 correctly without trigrams. A B-tree index with `text_pattern_ops` or a partial GIN index can accelerate this.

Scope and label the two search paths clearly in code: `searchByLatinQuery()` uses trigrams, `searchByJapaneseQuery()` uses ILIKE with Japanese normalization.

**Warning signs:**
- Searching a venue by its Japanese name returns zero results even though the venue exists.
- `SELECT similarity('渋谷', '渋谷 WARP')` returns 0.0 (trigrams extracted nothing).
- No test cases for Japanese-name queries exist in the test suite.

**Phase to address:** Phase 1 (search implementation). Establish the dual-path search strategy from the start. Do not build the entire search layer around `pg_trgm` and retrofit Japanese support later.

---

### Pitfall 4: Over-Fuzzy Matching Returns Wrong Venues — Default Similarity Threshold Too Low

**What goes wrong:**
`pg_trgm`'s default similarity threshold is **0.3** (via the `%` operator). This means any two strings sharing 30% of trigrams are considered "similar." For short venue names (3–6 characters), this is catastrophically loose. "WARP" and "WAR" share enough trigrams to match. "Bar" could match "Barcode", "Barbershop", and "Bar Bossa" simultaneously. An AI agent searching for "1 Oak" could receive Club Cielo, Oak Avenue Lounge, and The Oak Bar — none of which is the right venue.

The problem is worse for venue discovery than for document search because the user expects an exact or near-exact name match, not a broad topic match.

**Why it happens:**
Tutorials use the default `%` operator and similarity threshold without discussing how thresholds interact with string length. Short strings have fewer trigrams, which means a small number of shared trigrams produces a disproportionately high similarity score.

**How to avoid:**
- Use `strict_word_similarity` (default threshold 0.5) instead of `similarity` for venue name matching — it matches whole words, which is more appropriate for names.
- Set a higher threshold explicitly for venue searches: `SET pg_trgm.strict_word_similarity_threshold = 0.6;` within the search RPC.
- Return results ordered by similarity score descending (`ORDER BY similarity DESC`) and cap results at the top 3–5 — never return all matches above the threshold.
- Apply city filter first (dramatically reduces the candidate set), then fuzzy match within the city.
- Add a minimum query length guard: require at least 3 characters before triggering trigram search. Queries shorter than 3 characters should fall back to `ILIKE` only.

**Warning signs:**
- Searching "Bar" returns 20+ venues.
- A search for a specific venue name returns multiple venues from unrelated categories.
- Results contain venues with no character overlap with the query string.
- Similarity scores cluster around 0.3 rather than being distributed across the range.

**Phase to address:** Phase 1 (search implementation). Define threshold values and ordering strategy before writing the RPC. Test with adversarial short queries ("bar", "a", "1") to verify no over-matching.

---

### Pitfall 5: Existing `.ilike()` Search Behavior Breaks When Normalization Is Added

**What goes wrong:**
The current services (`events.ts`, `venues.ts`, `performers.ts`) use `.ilike('name', \`%${query}%\`)` directly via the Supabase JS client. This works correctly for exact substring matches. When you add accent normalization, the natural instinct is to wrap the column expression with `unaccent()`. But the Supabase JS client's `.ilike()` method generates SQL like `name ilike '%query%'` — it does not support arbitrary SQL expressions on the column side.

Attempting to pass `unaccent(name)` as the column name to `.ilike()` will either silently fail, throw a PostgREST error, or produce invalid SQL. Developers who don't check the generated SQL will see "no results" and assume the data is wrong.

**Why it happens:**
The Supabase JS client API is not a transparent SQL builder. `.ilike('column_name', pattern)` generates a PostgREST filter, not raw SQL. Column expressions like `unaccent(name)` are not valid PostgREST filter column identifiers.

**How to avoid:**
Move search to a PostgreSQL RPC (stored function) for any query that needs `unaccent()` or trigram similarity. The RPC is called with `.rpc('search_venues', { query, city })` — inside the function, you have full SQL expressiveness. This is the correct Supabase pattern for non-trivial searches.

Keep the existing `.ilike()` path for simple substring matching where normalization is not needed (or not worth the RPC overhead). Make the tradeoff explicit in code comments.

**Warning signs:**
- Attempting to call `.ilike('unaccent(name)', '%query%')` — any column name containing a function call is a PostgREST API misuse.
- "No results" from the Supabase JS client when the underlying SQL query in Supabase Studio does return results.
- PostgREST 400 error mentioning unrecognized column name.

**Phase to address:** Phase 1 (search implementation). Design the RPC interface first. Do not attempt to add normalization through the PostgREST filter API.

---

### Pitfall 6: `CREATE INDEX` Without `CONCURRENTLY` Locks the Table — Blocks Consumer Site Writes

**What goes wrong:**
The nightlife-mcp Supabase project is shared with the consumer site (nightlife-tokyo-next). Both apps read and write to the same tables. Running `CREATE INDEX` (without `CONCURRENTLY`) acquires a `ShareLock` on the target table — this blocks all `INSERT`, `UPDATE`, and `DELETE` operations for the entire duration of the index build. On a table with thousands of event rows, this can take minutes. During that window, the consumer site cannot insert new bookings, update event records, or process VIP requests.

**Why it happens:**
Supabase Studio's "Run" button and manual `psql` sessions run `CREATE INDEX` with the default locking behavior. Developers testing in staging don't notice because staging has minimal load. Production has concurrent writers.

**How to avoid:**
Always use `CREATE INDEX CONCURRENTLY` for all index additions in production. Accept that concurrent builds take longer and cannot run inside a transaction block (Supabase migrations run in transactions by default). Strategy:
1. Write the migration with `CREATE INDEX CONCURRENTLY`.
2. Set `SET lock_timeout = '2s';` before the index creation to fail fast rather than block indefinitely if a lock can't be acquired.
3. Run index creation during off-peak hours (not Friday/Saturday night JST).
4. Verify completion with: `SELECT indexname, idx_scan FROM pg_stat_user_indexes WHERE tablename = 'venues';`.

**Warning signs:**
- Migration file contains `CREATE INDEX` without the `CONCURRENTLY` keyword.
- Migration runs inside a `BEGIN/COMMIT` block (blocks concurrency — must be run outside transaction for `CONCURRENTLY`).
- Index creation attempted during peak nightlife hours (Friday/Saturday 20:00–02:00 JST).

**Phase to address:** Phase 1 (DB migrations). Every `CREATE INDEX` statement in every migration file for this milestone must use `CONCURRENTLY` and be verified before committing.

---

### Pitfall 7: Space/Special-Character Normalization Done Only in TypeScript — DB Data Is Not Normalized

**What goes wrong:**
The trigger for this milestone is "CeLaVi" not finding "CÉ LA VI". The fix seems simple: strip accents and lowercase the query before sending it to the DB. But the DB stores names with original casing and accents. If normalization happens only in TypeScript (query side) and not on the stored data side, the search is asymmetric: `unaccent(lower('CÉ LA VI'))` = `'ce la vi'`, `unaccent(lower('CeLaVi'))` = `'celavi'`. These still don't match because spaces differ.

The root cause requires normalizing both sides: the stored value AND the incoming query. If space removal is added to the query but the index is built on `lower(unaccent(name))` (which preserves spaces), queries like "1oak" still fail to find "1 OAK".

**Why it happens:**
Developers focus on the query path (what the AI agent sends) without thinking through what the normalized stored value looks like. The normalization function applied at query time must exactly match the normalization function used to build the index.

**How to avoid:**
Define a single canonical normalization function in SQL and use it in exactly two places: the index definition and the query `WHERE` clause. No TypeScript normalization — all normalization happens inside the PostgreSQL function.

For space/punctuation-stripping (to handle "1oak" → "1 OAK"):
```sql
CREATE OR REPLACE FUNCTION f_normalize_name(text)
RETURNS text AS $$
  SELECT lower(regexp_replace(f_unaccent($1), '[^a-z0-9]', '', 'g'))
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE INDEX idx_venues_name_normalized ON venues USING btree (f_normalize_name(name));
```

Query: `WHERE f_normalize_name(name) = f_normalize_name('1oak')` — both sides use the identical function.

**Warning signs:**
- Normalization logic appears in TypeScript service files, not exclusively in the PostgreSQL RPC.
- The index expression and the `WHERE` clause expression use different functions.
- "1oak" does not find "1 OAK" even after accent stripping.
- Test for "ce la vi" passes but "celavi" fails (spaces not stripped).

**Phase to address:** Phase 1 (DB + search implementation). Define `f_normalize_name()` in the DB migration. Use it in both the index and the search RPC. Zero normalization logic in TypeScript.

---

### Pitfall 8: Fuzzy Match Deployed for Events/Performers Without Considering Result Volume

**What goes wrong:**
Venue search with 450 venues scoped by city is a contained problem — even with a loose threshold, the result set is manageable. Events and performers are different: there can be thousands of active event records and performers per city. Applying the same fuzzy matching logic (e.g., trigram similarity with threshold 0.3) to the `events` table without tight city+date scoping can return hundreds of low-relevance matches. An AI agent receiving 50 event results for a fuzzy query about "techno night" cannot meaningfully act on them.

**Why it happens:**
The milestone correctly calls for "basic normalization for events/performers (accent stripping + case insensitive)" — but the boundary between "basic normalization" and "full fuzzy search" is blurry during implementation. A developer building the venue fuzzy search logic first may copy that pattern to events without adapting the threshold or pre-filtering strategy.

**How to avoid:**
For events and performers: use accent stripping + case-insensitive `ILIKE` only. Do NOT apply trigram similarity operators. Keep the existing city+date scoping as the primary filter. The `query` parameter on events and performers should only narrow within an already-scoped result set, not act as a standalone discovery mechanism.

Explicit rule: `pg_trgm` similarity is only for venue name fuzzy matching. Events and performers use `unaccent(lower(title)) ILIKE unaccent(lower('%query%'))` — no threshold, no similarity scoring.

**Warning signs:**
- `search_events` RPC includes a `similarity()` operator or the `%` operator.
- Event search for a short query ("techno") returns more than 50 results without a date filter.
- The same search RPC pattern is copy-pasted from venue search to event search verbatim.

**Phase to address:** Phase 2 (events/performers normalization). Treat this as a separate, simpler implementation than venue fuzzy search. The scope is accent stripping only — not fuzzy matching.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using raw `unaccent()` in queries without an immutable wrapper or index | Quick to write | Sequential scans on every search; performance degrades as table grows | Never — takes 5 minutes to create the wrapper function, saves hours of debugging |
| Applying TypeScript-side normalization (lowercasing, accent stripping) before sending to DB | Feels clean | Inconsistent with DB-side index; any mismatch between TS and SQL normalization produces silent misses | Never — all normalization must live in the DB function used for both the index and query |
| Copying venue fuzzy search pattern to events/performers without adapting thresholds | Faster to ship | Over-broad event results make MCP tool outputs useless for AI agents | Never for events/performers — scope to ILIKE only, not similarity |
| `CREATE INDEX` without `CONCURRENTLY` in migration | Simpler migration file | Write lock on shared DB; consumer site blocked during index build | Never in production — always `CONCURRENTLY` |
| Skipping the character audit (what non-ASCII chars are in venue names) | Saves 1 hour | Specific venue names silently return zero results; discovered by users not tests | Never — 20-minute SQL query prevents a production blind spot |
| Using the default `pg_trgm` similarity threshold (0.3) without adjustment | Works out of the box | Over-matching on short strings returns irrelevant venues | Never for venue name search — set threshold explicitly and test with short queries |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase JS `.ilike()` | Passing `unaccent(column_name)` as the column argument | Move accent-insensitive search to a PostgreSQL RPC; `.ilike()` column arg must be a plain column name |
| Supabase PostgREST `.textSearch()` | Using it for fuzzy venue name matching | `.textSearch()` is for full-text document search (tsvector/tsquery), not name similarity — wrong tool for venue names |
| `pg_trgm` GIN index | Creating index on raw column, then querying on `unaccent(column)` | Index expression and query expression must be identical; index on `f_unaccent(name)` and query on `f_unaccent(name)` |
| `pg_trgm` with Japanese | Assuming trigram similarity works for kanji/katakana | Non-ASCII is stripped before trigram extraction; use `ILIKE` for Japanese-character queries, not similarity operators |
| PostgreSQL `unaccent` extension | Using it directly in index definition | `unaccent()` is STABLE, not IMMUTABLE; create an IMMUTABLE wrapper function to enable indexing |
| Supabase migrations | Running `CREATE INDEX CONCURRENTLY` inside a migration transaction | `CONCURRENTLY` cannot run inside a transaction; either use `SET autocommit` or run index creation as a separate, non-transactional migration step |
| Shared Supabase DB | Running migrations without coordinating with consumer site team | Any schema change (new column, index, function) affects both apps; notify before running and monitor consumer site health after |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `unaccent()` without immutable wrapper — no index possible | Venue search takes 50–500ms instead of <5ms | Create `f_unaccent()` wrapper; verify with `EXPLAIN ANALYZE` that index is used | Immediately on events table (thousands of rows); later on venues as dataset grows |
| GIN trigram index on full `events` table without city scoping | Event searches scan full index even when city filter exists | Apply city filter as a B-tree index first, then trigram search within city results; compound the filters | At ~5,000 event rows the GIN scan cost exceeds B-tree city filter benefit |
| `similarity()` function call without an index — full table comparison | Every call computes similarity against every row | GIN trigram index makes `%` operator index-eligible; without the index, `similarity()` is O(n) | At 450 venues it's slow; at 50,000 performers it's unusable |
| Returning all trigram matches above threshold to the application layer and filtering in TypeScript | Application layer filters 200 DB results down to 5 | Filter and sort in the PostgreSQL RPC; return only `LIMIT 10` already ordered by score | Any time DB → app data transfer happens on a connection with latency (i.e., always) |
| `ILIKE '%query%'` without trigram index on frequently-searched columns | Substring search degrades linearly | `CREATE INDEX ... USING gin (column gin_trgm_ops)` enables `ILIKE '%...'` to use the trigram index | At ~1,000 rows for performers and events; 450 venues are borderline |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Passing raw user query string into `unaccent()` or `similarity()` without parameterization | SQL injection if query is built by string concatenation | All RPC functions use `$1` parameterized arguments; never concatenate user input into SQL strings in TypeScript |
| Exposing similarity scores in MCP tool output | Leaks information about DB index structure and match quality; AI agents may misuse score as confidence | Return matched venue names only; drop similarity scores from the MCP response payload |
| No rate limiting on fuzzy search endpoints — trigram similarity is CPU-expensive | A bot sending thousands of short queries can spike DB CPU | Existing API key rate limits (minute + daily quota) already apply to all MCP tools; verify REST endpoints have the same limits |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Fuzzy match returns multiple plausible venues with no ranking signal | AI agent picks wrong venue, sends booking request to wrong place | Order results by similarity score descending; return only the top 1–3 matches for name searches |
| Exact match not ranked above fuzzy match | AI agent searching "WARP" gets "WARP SHINJUKU" ranked below "WARP OSAKA" due to random similarity tie-breaking | Exact matches (after normalization) should always rank first; use `CASE WHEN normalized_name = f_normalize_name(query) THEN 1 ELSE 0 END DESC` as primary sort |
| Zero results returned for near-miss queries with no explanation | AI agent stops search and reports "venue not found" with no suggestion | MCP tool response should include a `search_hint` field when zero results are returned: "Did you mean: [closest match]?" — use top trigram result regardless of threshold |
| Fuzzy search adding latency to all queries | Noticeably slower MCP tool responses for agents | Apply fuzzy logic only when initial exact/ILIKE search returns zero results (two-pass strategy); avoid fuzzy overhead on the happy path |

---

## "Looks Done But Isn't" Checklist

- [ ] **Immutable wrapper exists:** Verify `f_unaccent()` and `f_normalize_name()` functions exist in the DB before any index is created — `\df f_unaccent` in psql.
- [ ] **Index is being used:** Run `EXPLAIN ANALYZE` on a venue search query and verify `Index Scan` or `Bitmap Index Scan` — not `Seq Scan`.
- [ ] **Japanese names work:** Search `SELECT name FROM venues WHERE name ~ '[^\x00-\x7F]'` to find all non-ASCII venue names; verify each one is findable by its Japanese characters via `ILIKE`.
- [ ] **Macron handling tested:** Run `SELECT f_unaccent('ō'), f_unaccent('ū'), f_unaccent('CÉ LA VI')` — verify results are `o`, `u`, `ce la vi`.
- [ ] **Exact match returns first:** Search "WARP" and verify "WARP SHINJUKU" (if that's the only WARP in the city) is the first result, not a different venue.
- [ ] **Short query safety:** Search "a" or "1" — verify no over-matching floods the response with irrelevant venues. Should return zero or only venues with exactly that name.
- [ ] **"1oak" finds "1 OAK":** Space/punctuation stripping works both ways. Test this exact case.
- [ ] **"celavi" finds "CÉ LA VI":** The original trigger for this milestone. Verify end-to-end.
- [ ] **Events search unchanged behavior:** Run existing event search test cases — verify no regressions from the normalization changes.
- [ ] **Indexes created with CONCURRENTLY:** Check every migration file; no `CREATE INDEX` without `CONCURRENTLY` keyword.
- [ ] **Consumer site unaffected:** After migration, test the consumer site (nightlife-tokyo-next) search and venue page loads — verify no errors from schema changes.
- [ ] **RPC used for fuzzy search (not .ilike() with column expression):** Grep codebase for any `.ilike('unaccent` — should be zero results.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Sequential scans discovered post-deploy due to missing index | LOW | `CREATE INDEX CONCURRENTLY` on the column; no data change needed; query automatically uses index after creation |
| `unaccent()` gaps cause specific venue names to be unsearchable | LOW | Extend `unaccent.rules` or add character mappings to `f_unaccent()`; re-index; no data migration |
| Over-fuzzy matching caused wrong venue returned in production | LOW-MEDIUM | Increase threshold in RPC function; redeploy function (no migration needed); add test cases for the failing query |
| `CREATE INDEX` without `CONCURRENTLY` ran in production and locked the table | MEDIUM | Monitor lock duration; if sustained, kill the blocking session in Supabase Studio (`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%CREATE INDEX%'`); restart index creation with `CONCURRENTLY` |
| Events/performers fuzzy search returns excessive results (wrong pattern copied) | LOW | Change similarity operator to `ILIKE` in the RPC; redeploy function; no migration needed |
| Japanese venue names return zero results from trigram search | LOW | Add explicit `ILIKE` fallback path in RPC for non-Latin queries; redeploy function only |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| `unaccent()` not indexable — seq scans | Phase 1 (DB setup): create `f_unaccent()` immutable wrapper before any index | `EXPLAIN ANALYZE` shows Index Scan, not Seq Scan |
| `unaccent` gaps for macrons and katakana | Phase 1 (DB setup): audit all non-ASCII venue names; extend rules file | `SELECT f_unaccent('ō')` returns `'o'`; Japanese-name ILIKE test returns correct venue |
| `pg_trgm` silently ignores Japanese characters | Phase 1 (search implementation): dual-path search design | Searching a venue by kanji name returns the correct result |
| Over-fuzzy matching with low default threshold | Phase 1 (search implementation): explicit threshold + ordering in RPC | Short query "bar" returns ≤5 results; all relevant |
| `.ilike()` column expression rejection by PostgREST | Phase 1 (search implementation): design RPC-first, no PostgREST filter for normalized search | No `.ilike('unaccent(...)` calls in codebase |
| `CREATE INDEX` without `CONCURRENTLY` | Phase 1 (DB migrations): review checklist before every migration | Every `CREATE INDEX` in migration files includes `CONCURRENTLY` |
| Normalization asymmetry between index and query | Phase 1 (DB setup + implementation): single `f_normalize_name()` function used everywhere | "1oak" finds "1 OAK"; "celavi" finds "CÉ LA VI" |
| Fuzzy pattern wrongly applied to events/performers | Phase 2 (events/performers): design explicitly as ILIKE-only, reviewed separately | Event search uses no similarity operators; confirm with `\sf search_events` |

---

## Sources

- PostgreSQL `unaccent` extension docs: [PostgreSQL: Documentation: F.48. unaccent](https://www.postgresql.org/docs/current/unaccent.html) (HIGH confidence)
- `unaccent` immutable limitation thread: [PostgreSQL: BUG #5781 — unaccent() should be marked IMMUTABLE](https://www.postgresql.org/message-id/201012021544.oB2FiTn1041521@wwwmaster.postgresql.org) (HIGH confidence)
- PostgreSQL `pg_trgm` docs and threshold defaults: [PostgreSQL: Documentation: F.35. pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) (HIGH confidence)
- PGroonga comparison with `pg_trgm` for CJK: [PGroonga versus textsearch and pg_trgm](https://pgroonga.github.io/reference/pgroonga-versus-textsearch-and-pg-trgm.html) (HIGH confidence)
- `unaccent` katakana bug report: [PostgreSQL: BUG #18216 — unaccent unable to remove accents from Japanese 'ド'](https://www.postgresql.org/message-id/CAFj8pRALjAQmCjQ+NiCPpob+dAprBFPb2XqZPeYDHEjdJmYK9A@mail.gmail.com) (HIGH confidence)
- `CREATE INDEX CONCURRENTLY` production risks: [How to Use Postgres CREATE INDEX CONCURRENTLY](https://www.bytebase.com/blog/postgres-create-index-concurrently/) (HIGH confidence)
- Supabase fuzzy search discussion (community): [State of Full Text Fuzzy Search — supabase/discussions#5435](https://github.com/orgs/supabase/discussions/5435) (MEDIUM confidence)
- Accent-insensitive collation approaches: [How to Use Accent-Insensitive Collations in PostgreSQL](https://oneuptime.com/blog/post/2026-01-25-postgresql-accent-insensitive-collation/view) (MEDIUM confidence)
- Codebase audit: `/Users/alcylu/Apps/nightlife-mcp/src/services/venues.ts`, `src/services/events.ts`, `src/services/performers.ts` — current `.ilike()` usage (HIGH confidence)
- Project spec: `/Users/alcylu/Apps/nightlife-mcp/.planning/PROJECT.md` — 450 venues, shared Supabase DB, current search approach (HIGH confidence)

---

*Pitfalls research for: fuzzy/accent-insensitive search on venue/event discovery system with Japanese content*
*Researched: 2026-03-12*
