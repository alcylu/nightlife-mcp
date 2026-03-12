# Project Research Summary

**Project:** nightlife-mcp v3.0 — Fuzzy/Accent-Insensitive Search
**Domain:** Search normalization — PostgreSQL extension-backed fuzzy matching + TypeScript accent stripping for venue, event, and performer discovery
**Researched:** 2026-03-12
**Confidence:** HIGH

## Executive Summary

The trigger for this milestone is concrete and well-understood: Gemini called `search_venues` with "CeLaVi" and got zero results because the DB stores "CÉ LA VI". The fix does not require a new search infrastructure. The existing Supabase/PostgreSQL instance already ships with `pg_trgm` and `unaccent` — two built-in extensions that, combined with a new `src/utils/normalize.ts` utility and a single migration file, resolve the entire feature set. The approach is a two-tier strategy: aggressive fuzzy matching (DB RPC with trigram similarity) for venue names only, and lightweight accent stripping (TypeScript-only, in-memory) for events and performers. No new npm packages are required on the primary path.

The recommended implementation order is bottom-up: DB migration first (extensions + immutable wrapper function + GIN index + fuzzy RPC), then the shared TypeScript `normalizeQuery()` utility, then the venues service (calls the new RPC), then events and performers (normalize the in-memory needle). Each step is independently testable and has zero risk of regressing the no-query code path. The total surface area is: one new SQL migration file, one new TypeScript utility file, and modifications to three existing service files. All MCP tool interfaces, the REST router, auth, and config remain unchanged.

The most significant risk is a well-known PostgreSQL constraint: `unaccent()` is declared `STABLE`, not `IMMUTABLE`, meaning it cannot be used directly in index definitions. Every pitfall in the research traces back to one of two root causes — either skipping the `IMMUTABLE` wrapper around `unaccent()`, or applying the aggressive fuzzy-match pattern to events and performers where it would produce noisy, over-broad results. Both are prevented by following the architecture exactly as specified. The shared Supabase DB constraint (the consumer site nightlife-tokyo-next reads and writes the same tables) means all index creation must use `CREATE INDEX CONCURRENTLY` and be run during off-peak hours.

## Key Findings

### Recommended Stack

No new npm packages are needed for the primary approach. Both `pg_trgm` and `unaccent` are pre-installed on the Supabase-managed PostgreSQL instance — they only need to be enabled via `CREATE EXTENSION IF NOT EXISTS`. A single migration file handles everything: enable extensions, create the `IMMUTABLE` wrapper function `f_unaccent(text)`, create the GIN trigram index on `f_unaccent(lower(name_en))`, and create the `search_venues_fuzzy` RPC. The RPC is required because PostgREST cannot express the `pg_trgm` similarity operator as a filter — only a server-side PostgreSQL function can use it. The `supabase.rpc()` call pattern is already used in this codebase (`cities.ts`, `authorize.ts`), so no new integration pattern is introduced.

`fuse.js@7.1.0` is identified as a valid fallback if the DB-level path encounters a blocker (e.g., RPC typing issues). It ships its own TypeScript types, has zero dependencies, and 450 venues fits comfortably in memory. It should not be reached unless the primary path fails.

**Core technologies:**
- `pg_trgm` (PostgreSQL built-in): Trigram-based similarity matching for venue names — the only correct way to do typo-tolerant search inside the DB; GIN index makes it sub-millisecond on 450 venues.
- `unaccent` (PostgreSQL built-in): Strips diacritics (é→e, ō→o) — required so "CeLaVi" finds "CÉ LA VI"; must be wrapped in an `IMMUTABLE` function before it can appear in an index expression.
- `src/utils/normalize.ts` (new TypeScript utility): NFD Unicode decomposition + diacritic strip + space collapsing + lowercase; shared by all three services; runs synchronously with zero I/O cost.
- `fuse.js@7.1.0` (fallback only, not installed by default): App-level fuzzy matching if the DB RPC path is blocked.

### Expected Features

**Must have (table stakes — v3.0):**
- Accent stripping on venue, event, and performer name queries — resolves the Gemini "CeLaVi" trigger bug and all related cases (ō→o, ü→u, â→a).
- Space/punctuation normalization on venue names — "1oak" must find "1 OAK".
- Typo-tolerant venue search via `pg_trgm` RPC — "Zeuk" must find "Zouk"; 1-2 character typos caught.
- Basic accent normalization for event and performer queries — same `normalizeQuery()` utility applied to in-memory `hasNeedle()` calls.

**Should have (ship with v3.0 or immediately after):**
- Result ranking by `pg_trgm` similarity score — most relevant venue ranks first; exact name matches always outrank fuzzy matches.
- GIN index on `venues.name_en` — created as part of the same migration with no extra effort; makes fuzzy search sub-millisecond.

**Defer (v3.x and beyond):**
- `name_aliases text[]` column on venues for stylized names like W∆RP — only needed if space/punctuation stripping proves insufficient; low priority pending post-launch testing.
- PGroonga for Japanese-character queries — AI agents always query in Latin script; not worth the complexity.
- External search engine (Algolia, Typesense, Meilisearch) — appropriate only after dataset exceeds approximately 5,000 venues.
- Phonetic matching (Soundex/Metaphone) — too many false positives for short nightclub names.

### Architecture Approach

The implementation follows a hybrid pattern: DB-level fuzzy matching for venues (where the name is the primary search axis and the entity set is not pre-filtered by date), and TypeScript-layer accent normalization for events and performers (where rows are already fetched into memory by city+date and only the needle needs normalizing). This avoids unnecessary DB round-trips for events and performers while delivering true typo tolerance where it matters most. The `normalizeQuery()` utility in `src/utils/normalize.ts` is the shared foundation — all three services import it; the venues service additionally calls the Supabase RPC when a non-empty query is present. When no query is present, all three services take the existing code path entirely unchanged.

**Major components:**
1. `src/utils/normalize.ts` (NEW) — `normalizeQuery()` and `stripAccents()`; pure TypeScript; no DB deps; synchronous on the hot path.
2. `supabase/migrations/20260312_fuzzy_search.sql` (NEW) — enables `unaccent` and `pg_trgm`, creates `f_unaccent()` IMMUTABLE wrapper, creates `search_venues_fuzzy` RPC, creates GIN index on `venues.name_en`.
3. `src/services/venues.ts` (MODIFIED) — calls `search_venues_fuzzy` RPC when `queryNeedle` is non-empty; intersects RPC result IDs with the occurrence-based venue set; no-query path unchanged.
4. `src/services/events.ts` (MODIFIED) — passes normalized needle into `hasNeedle()` / `matchQuery()`; DB queries unchanged.
5. `src/services/performers.ts` (MODIFIED) — normalizes before the `.filter()` on performer name; DB queries unchanged.

### Critical Pitfalls

1. **`unaccent()` is `STABLE`, not `IMMUTABLE` — cannot be used directly in index definitions.** Create the `f_unaccent(text)` immutable wrapper before creating any index. All index expressions and query `WHERE` clauses must reference `f_unaccent()`, never raw `unaccent()`. Verify with `EXPLAIN ANALYZE` that searches use an Index Scan, not a Seq Scan.

2. **Index expression and query expression must be identical.** The GIN index on `f_unaccent(lower(name_en))` is only useful if the RPC `WHERE` clause also uses `f_unaccent(lower(name_en))`. A mismatch causes the planner to ignore the index silently. Define normalization once in the DB function and use it everywhere — no parallel normalization logic in TypeScript that might diverge.

3. **`pg_trgm` silently ignores non-ASCII characters.** Trigrams are only extracted from ASCII characters; Japanese kanji, hiragana, and katakana produce zero trigrams. Venue fuzzy search must be scoped to `name_en` only. Any Japanese-character query path must use `ILIKE` with wildcard patterns, not similarity operators.

4. **`CREATE INDEX` without `CONCURRENTLY` locks the shared table and blocks the consumer site.** The nightlife-mcp Supabase project is shared with nightlife-tokyo-next. Every `CREATE INDEX` in this milestone must use `CONCURRENTLY` and cannot run inside a migration transaction block. Schedule during off-peak hours — not Friday or Saturday evening JST.

5. **Fuzzy match pattern must not be applied to events or performers.** Events and performers are already city+date scoped in memory before filtering. Applying `pg_trgm` similarity to those tables would add DB round-trips, increase latency, and return hundreds of low-relevance matches. Events and performers use accent normalization only — no similarity operators, no RPC.

## Implications for Roadmap

The work splits naturally into three sequential phases ordered by hard dependency: DB infrastructure must exist before the venues service can call it, and the shared normalization utility must exist before any service can use it. Events and performers have no DB dependency, so their normalization trails the venues work and is the simplest phase.

### Phase 1: DB Infrastructure + Core Normalization Utility

**Rationale:** Everything else depends on this phase. The `f_unaccent()` wrapper, the GIN index, and the `search_venues_fuzzy` RPC must be in the DB before the venues service can call them. The `normalize.ts` utility must exist before any service can import it. This phase produces zero application-visible behavior changes — it only lays the foundation.

**Delivers:** Migration applied to Supabase production (extensions enabled, `f_unaccent()` wrapper, GIN index on `venues.name_en`, `search_venues_fuzzy` RPC). `src/utils/normalize.ts` with `normalizeQuery()` and `stripAccents()` unit-tested against concrete failing cases.

**Addresses:** Table-stakes features — accent normalization foundation, space/punctuation normalization foundation, pg_trgm infrastructure for typo tolerance.

**Avoids:** Pitfall 1 (STABLE/IMMUTABLE — wrapper is created first), Pitfall 2 (index-query mismatch — single normalization function used in both), Pitfall 4 (CONCURRENTLY — enforced in migration file), Pitfall 7 (normalization asymmetry between TypeScript and DB).

**Verification gate before proceeding to Phase 2:**
- `SELECT f_unaccent('CÉ LA VI')` returns `ce la vi`
- `SELECT * FROM search_venues_fuzzy('<tokyo_city_id>', 'celavi', 0.15, 10)` returns the CÉ LA VI row
- Unit tests: `normalizeQuery('CeLaVi')` → `'celavi'`; `normalizeQuery('1oak')` → `'1oak'`; `normalizeQuery('é')` → `'e'`
- `EXPLAIN ANALYZE` on venue query shows Index Scan, not Seq Scan

### Phase 2: Venue Search Integration

**Rationale:** Venues are the highest-priority search surface (triggered the milestone) and require the DB RPC from Phase 1. The venues service modification is the most architecturally complex change — it introduces the two-pass search strategy (exact/ilike first → fuzzy RPC fallback on zero results) and must intersect RPC results with the occurrence-based venue set without disrupting the date/genre/area filter chain.

**Delivers:** `search_venues` MCP tool and `GET /api/v1/venues` REST endpoint correctly return results for "CeLaVi", "1oak", "Zeuk", and similar queries. No regressions on the no-query path or any existing filter behavior.

**Uses:** `search_venues_fuzzy` RPC (Phase 1), `normalizeQuery()` utility (Phase 1), existing `.rpc()` call pattern from `cities.ts` and `authorize.ts`.

**Implements:** Two-pass search strategy — if `queryNeedle` is non-empty: call RPC, build `Set<venueId>` from results, intersect with occurrence-based venue set; if RPC returns zero results, return empty with no further fallback.

**Avoids:** Pitfall 5 (no `.ilike()` column expression — RPC is the only path for normalized search), Pitfall 4 (over-fuzzy matching — threshold 0.15 + ILIKE arm in RPC, results ordered by similarity DESC), Anti-Pattern 1 from ARCHITECTURE.md (no full-venue-table fetch in TypeScript).

**Verification gate before proceeding to Phase 3:**
- `search_venues city=tokyo query=celavi` returns CÉ LA VI
- `search_venues city=tokyo query=1oak` returns 1 OAK
- `search_venues city=tokyo query=zeuk` returns Zouk
- `search_venues city=tokyo` (no query) returns same results as before the change
- W∆RP edge case tested and documented: if "warp" does not find "W∆RP", note it as a known gap for v3.x `name_aliases`

### Phase 3: Events and Performers Normalization

**Rationale:** Simpler than venues — no DB changes, no RPC calls, no intersection logic. Apply `normalizeQuery()` to the in-memory needle before `hasNeedle()` calls in events and performers services. Trailing Phase 2 ensures the normalization utility is already stable and battle-tested before being applied more broadly.

**Delivers:** `search_events` and `search_performers` tools return results for accent-variant queries (e.g., "dua lipa" finds "Duá Lipa", "shinjuku" finds "Shinjukū"). Zero DB changes. Zero changes to MCP tool interfaces or REST endpoints.

**Uses:** `normalizeQuery()` utility (Phase 1 only).

**Avoids:** Pitfall 8 (no `pg_trgm` similarity applied to events/performers — accent-stripped ILIKE only), Anti-Pattern 2 from ARCHITECTURE.md (no DB RPC for event/performer search).

**Verification gate:**
- `search_events city=tokyo query="dua lipa"` finds Dua Lipa events if any exist
- Existing event search test cases pass without regression
- No similarity operators or RPC calls appear in the events or performers code paths

### Phase Ordering Rationale

- Phase 1 must precede Phase 2 because the venues service depends on both the DB RPC and the normalize utility.
- Phase 1 must precede Phase 3 because the events/performers services depend on the normalize utility.
- Phase 2 and Phase 3 are independent once Phase 1 is complete — they could be parallelized, but Phase 2 is higher priority and more complex, so sequential ordering reduces diagnostic surface area.
- The two-pass search strategy (try exact/ilike first → fall back to fuzzy RPC only on zero results) isolates the fuzzy overhead to the minority case and keeps the happy path fast.
- No phase changes MCP tool interfaces, the REST router, auth, or config — this limits regression risk to the three modified service files.

### Research Flags

No phases require `/gsd:research-phase` during planning. All patterns are fully specified in the research files.

Phases with well-documented patterns:
- **Phase 1 (DB migration):** PostgreSQL official docs, Supabase extension catalog, and the immutable wrapper pattern are all documented with HIGH-confidence sources. The full migration SQL is specified in both STACK.md and ARCHITECTURE.md and can be copied directly into the migration file.
- **Phase 2 (venues service):** The `supabase.rpc()` call pattern is already used in the codebase (`cities.ts`, `authorize.ts`). The ID set intersection is standard TypeScript. No new patterns introduced.
- **Phase 3 (events/performers):** Modifying `hasNeedle()` to normalize both sides is a trivial change. No new patterns, no DB involvement.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | PostgreSQL official docs for both extensions; Supabase extension catalog confirmed availability; existing codebase confirms `supabase.rpc()` call pattern works in production |
| Features | HIGH | Verified against existing `hasNeedle()` source code in all three service files; PGroonga docs confirm pg_trgm + Japanese limitation; all feature decisions grounded in concrete observed code behavior |
| Architecture | HIGH | Based on direct source reads of venues.ts, events.ts, and performers.ts; build order is dependency-derived; component responsibilities confirmed against live code |
| Pitfalls | HIGH | `unaccent()` STABLE/IMMUTABLE from official PostgreSQL docs; katakana failure from official PostgreSQL BUG report; `CONCURRENTLY` constraint from official docs; consumer-site table lock from direct project knowledge of shared Supabase setup |

**Overall confidence:** HIGH

### Gaps to Address

- **W∆RP edge case:** The delta character (∆) is non-ASCII and non-alphabetic. After NFD normalization and non-alphanumeric stripping, "W∆RP" becomes "WRP" (not "WARP"), so `query=warp` may not find it. This is an acceptable gap for v3.0 — if confirmed during Phase 2 verification, document it as a known gap and add `name_aliases: ['WARP']` to the venue record in a v3.x follow-up. Do not block v3.0 launch on this edge case.

- **`pg_trgm` threshold calibration:** The research recommends 0.15 as the initial RPC threshold (lower than the pg_trgm default of 0.3) because the RPC uses an ILIKE containment arm as a second condition. If over-matching appears in production testing (too many irrelevant venues returned for short queries), raise to 0.2–0.25. This requires one or two test cycles against real Tokyo venue data to calibrate — not a blocker for launch.

- **`unaccent` macron coverage:** Research flags that `unaccent()` may not handle `ō`, `ū`, `ā` (Japanese romanization macrons) correctly out of the box. Must verify in Phase 1 before any search logic is tested: `SELECT f_unaccent('ō')` should return `'o'`. If it returns `'ō'` unchanged, add custom rules to the `unaccent.rules` file. This is a 20-minute fix and must not be skipped — it affects the most common Japanese romanization patterns (Ōsaka, Tōkyō, Shinjukū).

## Sources

### Primary (HIGH confidence)
- [PostgreSQL pg_trgm documentation (v18)](https://www.postgresql.org/docs/current/pgtrgm.html) — similarity operators, GIN index support, threshold GUC parameters
- [PostgreSQL unaccent documentation (v17)](https://www.postgresql.org/docs/17/unaccent.html) — STABLE vs IMMUTABLE constraint, dictionary behavior
- [Neon unaccent extension docs](https://neon.com/docs/extensions/unaccent) — immutable wrapper pattern, exact SQL for expression index
- [Supabase extensions overview](https://supabase.com/docs/guides/database/extensions) — pg_trgm and unaccent confirmed available and pre-installed on Supabase cloud
- [PGroonga vs pg_trgm comparison](https://pgroonga.github.io/reference/pgroonga-versus-textsearch-and-pg-trgm.html) — pg_trgm non-ASCII limitation confirmed
- [PostgreSQL BUG #18216](https://www.postgresql.org/message-id/CAFj8pRALjAQmCjQ+NiCPpob+dAprBFPb2XqZPeYDHEjdJmYK9A@mail.gmail.com) — `unaccent()` katakana failure confirmed
- [How to Use Postgres CREATE INDEX CONCURRENTLY](https://www.bytebase.com/blog/postgres-create-index-concurrently/) — production locking behavior documented
- Codebase: `src/services/venues.ts`, `src/services/events.ts`, `src/services/performers.ts` — existing `hasNeedle()` and query patterns confirmed via direct source read

### Secondary (MEDIUM confidence)
- [Aapelivuorinen.com — Postgres text search vs trigrams](https://www.aapelivuorinen.com/blog/2021/02/24/postgres-text-search/) — when to use trigrams vs full-text search for short name fields
- [pganalyze — GIN indexes](https://pganalyze.com/blog/gin-index) — GIN vs GiST tradeoff for trigram use case
- [Postgres trigram indexes vs Algolia](https://dev.to/saashub/postgres-trigram-indexes-vs-algolia-1oma) — scale thresholds for when external search engines make sense
- [Supabase fuzzy search community discussion](https://github.com/orgs/supabase/discussions/5435) — community consensus on RPC-based approach
- [Unaccented Name Search with Postgres and Ecto](https://peterullrich.com/unaccented-name-search-with-postgres-and-ecto) — concrete example combining f_unaccent + GIN(gin_trgm_ops)

---
*Research completed: 2026-03-12*
*Ready for roadmap: yes*
