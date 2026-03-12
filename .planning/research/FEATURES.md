# Feature Research

**Domain:** Fuzzy/accent-insensitive search for venue, event, and performer discovery (MCP + REST API)
**Researched:** 2026-03-12
**Confidence:** HIGH (verified against PostgreSQL official docs, Supabase docs, and direct inspection of existing service code)

---

## Context

This research covers the feature landscape for **v3.0 Fuzzy Search** — making the existing `search_venues`, `search_events`, and `search_performers` tools resilient to:

- Accent variations: `celavi` → finds `CÉ LA VI`, `shin` → finds `Shīn`
- Space/punctuation differences: `1oak` → finds `1 OAK`, `warp` → finds `W∆RP`
- Typo tolerance: `Zoook` → finds `Zouk`
- Japanese long-vowel romanization: `osaka` → finds `Ōsaka`

**Existing search baseline** (read from `src/services/venues.ts`):

The current implementation uses in-memory `hasNeedle()`:
```
String(value || "").toLowerCase().includes(needle)
```
This is pure substring matching — no accent stripping, no normalization, no typo tolerance. The query does not touch the database for text matching (venues are fetched by city+date, then filtered in-memory using `hasNeedle()`).

**PostgreSQL extensions available on Supabase** (confirmed via Supabase docs):
- `unaccent` — removes diacritics from text (é→e, ō→o, etc.)
- `pg_trgm` — trigram similarity matching (fuzzy/typo tolerance)
- `fuzzystrmatch` — Levenshtein distance, Soundex, Metaphone
- `PGroonga` — multilingual full-text search (supports Japanese natively)

**Critical constraint on pg_trgm + Japanese text** (verified via PGroonga docs):
> "pg_trgm disables non-ASCII character support. It means that pg_trgm doesn't support many Asian languages such as Japanese and Chinese by default."

This means pg_trgm trigram similarity works correctly on Latin characters (venue names like "CÉ LA VI", "1 OAK", "Zouk") but will silently ignore Japanese katakana/hiragana/kanji. For this project, venue/performer/event names stored in `name_en` are already in Latin script. Japanese names are stored in `name_ja`. The search `query` parameter from AI agents like Gemini will almost always be in Latin script. So pg_trgm is appropriate.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that AI agents and developers expect to work. Missing these means the API returns zero results for reasonable queries — the triggering bug is Gemini calling `search_venues` with `"CeLaVi"` and getting nothing.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Accent stripping on venue name query | Any AI agent searching for "CÉ LA VI" using "celavi" or "CeLaVi" expects a result. This is the specific bug that triggered v3.0. | LOW | Apply `String.prototype.normalize("NFD")` + strip combining diacritics in TypeScript before calling `hasNeedle()`. No DB change required. Works on Latin accents (é→e, ō→o, â→a, ü→u) and is sufficient for the known failing cases. |
| Case-insensitive matching | Already implemented via `.toLowerCase()`. Expected by every caller. | NONE | Already done in `hasNeedle()`. |
| Space/punctuation normalization on venue names | "1oak" should find "1 OAK". "warp" should find "W∆RP". Agents may drop spaces and punctuation when typing venue names. | LOW | Strip non-alphanumerics from both needle and haystack during comparison. Pure TypeScript, no DB change. Implement as a second pass after the primary accent-stripped comparison. |
| Accent stripping on event and performer name query | An agent searching for "shinjuku" may see "Shinjukū" in results. Basic normalization keeps results consistent. | LOW | Same NFD normalization + diacritic strip applied to event name and performer name fields. Same function, different call sites. |

### Differentiators (Competitive Advantage)

Features that go beyond "fixing the bug" into genuinely better search quality. Valuable but not critical for v3.0.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Typo-tolerant venue search (pg_trgm) | An agent typing "Zoook" instead of "Zouk" still finds the venue. This handles 1-2 character typos that accent normalization alone cannot catch. | MEDIUM | Requires: (1) `CREATE EXTENSION pg_trgm` in Supabase, (2) a Supabase RPC (`search_venues_fuzzy`) that uses `similarity(name_en, $query) > 0.3`, (3) a new code path in `searchVenues()` that falls back to the RPC when the in-memory filter returns zero results. Scope: venue names only (450 records, city-scoped, manageable). |
| Ranked results by match quality | When multiple venues match a fuzzy query, the most similar name ranks first. Currently ranking is by event count, not match similarity. | MEDIUM | Requires pg_trgm `similarity()` score returned from the RPC and used for ordering. Adds a `match_score` field internally (not exposed in API response unless needed). For venue search this matters — if "Zouk" and "1 OAK" both fuzzy-match "Zo1k", Zouk should rank higher. |
| Alternate name / slug indexing | Venues like "W∆RP" have a common alternate name "WARP". Storing and searching alternate names catches stylized spellings that normalization alone can't handle. | HIGH | Requires a DB schema change: `venue_search_aliases` table or `name_aliases text[]` column on `venues`. Out of scope for v3.0. Worth tracking as a future improvement for venues with non-standard characters in official names. |
| Phonetic matching (Soundex / Metaphone) | "Seak" sounds like "Zeek" — phonetic matching catches pronunciation-based typos that trigram matching misses. | HIGH | PostgreSQL `fuzzystrmatch` extension provides `soundex()` and `metaphone()`. For nightclub names (short, often stylized, often proper nouns), phonetic matching generates too many false positives. Not recommended for this domain. |
| Japanese character search (PGroonga) | An agent could search for a venue using actual Japanese kanji/katakana. PGroonga supports this natively; pg_trgm does not. | HIGH | PGroonga is a separate extension with a different index type. It is available on Supabase but requires significant index setup and query pattern changes. The actual user demand for Japanese-script queries from AI agents is very low — agents are prompted in English. This is not worth the complexity for v3.0. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| External search engine (Algolia, MeiliSearch, Typesense) | "Algolia has great fuzzy search out of the box" | At 450 venues, adding an external search service introduces a sync pipeline (DB → search index), a new dependency, API costs, and data staleness risk. pg_trgm in the existing Supabase DB is sufficient for this dataset size and query pattern. One system, zero sync. | Use pg_trgm RPC for fuzzy matching. Revisit external search only if dataset exceeds 10K records or query complexity demands it. |
| Fuzzy search on all fields everywhere | "Make the description field fuzzy too" | Event and performer descriptions are long-form prose. Fuzzy matching on descriptions generates irrelevant results and increases DB load. Fuzzy/typo tolerance is valuable for short proper nouns (venue names), not free text. | Apply fuzzy matching to name fields only. Use standard substring (`ilike`) for description search, which is already sufficient for prose. |
| Real-time search-as-you-type | "Show results as the agent types" | MCP tools are called with a complete query parameter — there is no "typing" event. REST API users could theoretically stream, but the latency of Supabase RPC calls makes sub-100ms interactive search unlikely without caching. | Optimize for single-call latency. A well-tuned RPC with a GIN index on `name_en` will return results in <50ms for 450 records. |
| Levenshtein distance cutoff per word length | "1-typo tolerance for short names, 2-typo for long names" | Dynamic thresholds based on word length require custom application logic and are hard to tune consistently. The pg_trgm similarity threshold (0.3 default) naturally handles this — short strings need more similar trigrams to pass the threshold. | Use pg_trgm's similarity threshold as-is. Tune the threshold constant (e.g., 0.25 for more recall, 0.4 for more precision) based on real query failures. |
| Synonym mapping ("WOMB" = "womb tokyo") | "Map common abbreviations and alternate names to canonical names" | A synonym table requires ops maintenance. Venue names change, alternate names proliferate, and stale mappings cause confusion. | Accent normalization + space stripping handles most variants. For venues with truly unusual names (W∆RP), add a `name_aliases` column as a v3.x improvement with a concrete list of known aliases. |

---

## Feature Dependencies

```
[Accent normalization — TypeScript NFD]
    └──required for──> [Venue search fixes (celavi → CÉ LA VI)]
    └──required for──> [Event search normalization]
    └──required for──> [Performer search normalization]
    └──applies to──> [hasNeedle() — all three services share this function pattern]

[Space/punctuation normalization — TypeScript]
    └──enhances──> [Accent normalization]
    └──required for──> [1oak → 1 OAK style matches]
    └──applies to──> [venue name search only (most important for venue names)]

[pg_trgm RPC (fuzzy typo tolerance)]
    └──requires──> [pg_trgm extension enabled in Supabase]
    └──requires──> [GIN index on venues.name_en (optional but recommended for performance)]
    └──requires──> [Supabase RPC: search_venues_fuzzy(city_id, query_normalized, threshold)]
    └──requires──> [Fallback code path in searchVenues(): try exact → try fuzzy]
    └──enhances──> [Accent normalization] (normalize query before passing to RPC)

[pg_trgm RPC]
    └──conflicts-with──> [Japanese text in name_ja] (pg_trgm drops non-ASCII silently)
    └──scoped-to──> [name_en field only]

[Result ranking by match score]
    └──requires──> [pg_trgm RPC] (similarity() score needed)
    └──enhances──> [Typo-tolerant venue search]
```

### Dependency Notes

- **Accent normalization has no DB dependency.** It is a TypeScript change in `hasNeedle()` (or a new `normalizeForSearch()` utility). This is the fastest win and must ship first.
- **Space/punctuation normalization is also zero-DB.** Strip non-alphanumerics from both needle and haystack during comparison. This is a second normalization pass.
- **Fuzzy typo tolerance requires DB work.** Enabling pg_trgm, writing an RPC, and adding a code path in `searchVenues()` is a self-contained medium effort. It only applies to venues (not events/performers) in v3.0.
- **Events and performers only need accent normalization in v3.0.** The project spec says "basic normalization for events/performers." Fuzzy/typo tolerance is venue-specific.
- **pg_trgm and Japanese text do not conflict if scoped to `name_en`.** The `name_ja` field is never passed to the pg_trgm RPC. Agents search in Latin script; the RPC only touches the English name field.

---

## MVP Definition

This milestone has two tiers: the fast fix (TypeScript only) and the full feature (TypeScript + Supabase RPC).

### Launch With (v3.0 — the fix)

These are the minimum changes to resolve the triggering bug and the project spec:

- [ ] `normalizeForSearch(s: string): string` utility — NFD Unicode normalization + diacritic strip + lowercase. Used in place of raw `.toLowerCase()` in `hasNeedle()`. — **Zero DB dependency, pure TypeScript.**
- [ ] Space/punctuation stripping in venue name comparison — strip `[^a-z0-9]` from both needle and `name_en`/`name` before substring match. — **Zero DB dependency.**
- [ ] Apply `normalizeForSearch()` to event name and performer name fields — "basic normalization" as specified in PROJECT.md. — **Zero DB dependency.**
- [ ] `pg_trgm` enabled in Supabase + `search_venues_fuzzy` RPC — fallback path in `searchVenues()` when accent+space normalization returns zero results. — **Medium effort, resolves typo tolerance for venues.**

### Add After Validation (v3.x)

- [ ] GIN trigram index on `venues.name_en` — trigger: query latency exceeds 100ms on the fuzzy RPC. At 450 records, likely unnecessary, but easy to add.
- [ ] Tune `pg_trgm.similarity_threshold` — trigger: false positives (too many wrong venues returned) or false negatives (known venues not returned). Start at 0.25 and adjust.
- [ ] `name_aliases text[]` column on `venues` for W∆RP/WARP style variants — trigger: specific venue name fails both normalization and trigram matching.

### Future Consideration (v4+)

Defer until concrete demand:

- [ ] PGroonga for Japanese-script search — defer until an AI agent actually sends Japanese-character venue queries (currently all agents prompt in English).
- [ ] External search engine (Algolia/Typesense) — defer until dataset exceeds ~5,000 venues and query patterns demand it.
- [ ] Synonym table for alternate venue names — defer until v3.x `name_aliases` column proves insufficient.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Accent normalization (TypeScript, all services) | HIGH | LOW | P1 |
| Space/punctuation stripping (TypeScript, venue search) | HIGH | LOW | P1 |
| pg_trgm RPC for venue typo tolerance | HIGH | MEDIUM | P1 |
| Apply normalization to events + performer search | MEDIUM | LOW | P1 |
| Result ranking by match score | MEDIUM | LOW | P2 (comes with pg_trgm RPC) |
| GIN index on `venues.name_en` | LOW | LOW | P2 |
| Threshold tuning for pg_trgm | LOW | LOW | P2 |
| `name_aliases` for stylized venue names | LOW | MEDIUM | P3 |
| PGroonga for Japanese text | LOW | HIGH | P3 |
| External search engine | LOW | HIGH | P3 |

**Priority key:**
- P1: Must ship in v3.0
- P2: Add once P1 is validated
- P3: Future milestone only

---

## Special Considerations: Japanese + Latin Mixed Content

This domain (Tokyo nightlife) has a unique challenge: venues, events, and performers have both Japanese names (`name_ja`) and English names (`name_en`), and AI agents always query in Latin script.

**Findings:**

1. **Accent normalization handles romaji variants.** Long vowels (ō→o, ū→u) are represented by diacritics, which NFD normalization strips. So `osaka` finds `Ōsaka` and `shinjuku` finds `Shinjukū`. This is the most common mixed-content case.

2. **pg_trgm drops non-ASCII characters.** If a query or name contains Japanese katakana, pg_trgm silently ignores those characters. This is acceptable because: (a) the RPC is scoped to `name_en` only, (b) agents query in Latin script, (c) the Japanese name field `name_ja` is never passed to the trigram RPC.

3. **No Japanese-to-romaji transliteration needed.** The DB already stores `name_en` (Latin) alongside `name_ja` (Japanese). The search function searches both fields for substring matches, but only passes `name_en` to the pg_trgm RPC.

4. **W∆RP and similar stylized names are a harder problem.** The delta character (∆) is non-ASCII and will be stripped by NFD normalization, which means `warp` searching against `W∆RP` would match after normalization strips `∆` and `W`, leaving `RP`. The space/punctuation stripper handles this: strip non-alphanumeric from both sides → `warp` vs `wrp` → close but not identical. This edge case may require a `name_aliases` field. Flag for post-v3.0 testing.

5. **`unaccent` extension is not required.** The TypeScript NFD approach achieves the same accent stripping without a DB dependency. `unaccent` would be needed if we were doing DB-side filtering (e.g., a tsvector or ilike on normalized columns), but since matching is in-memory, TypeScript normalization is cleaner and sufficient.

---

## Competitor Feature Analysis

| Feature | Eventbrite (event discovery) | Resident Advisor (electronic music) | Our Approach |
|---------|------------------------------|--------------------------------------|--------------|
| Accent-insensitive search | Yes — "celavi" finds "CÉ LA VI" | Yes — handles European DJ names with accents | TypeScript NFD normalization on all name fields |
| Space/punctuation normalization | Partial — "1oak" may or may not work | Minimal — relies on users using correct spacing | Explicit strip-non-alphanumeric comparison pass |
| Typo tolerance | Yes — Levenshtein-based, 1-2 char typos | Limited — mostly exact match with suggestions | pg_trgm similarity with threshold ~0.25-0.3 |
| Ranked by relevance | Yes — complex scoring with facets | Yes — editorial ranking + text relevance | pg_trgm similarity score as secondary sort key |
| Japanese + Latin mixed | N/A | N/A | Scoped: `name_en` only for fuzzy; `name_ja` substring only |

---

## Sources

- PostgreSQL official docs: [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html), [unaccent](https://www.postgresql.org/docs/current/unaccent.html)
- Supabase extensions list: [supabase.com/docs/guides/database/extensions](https://supabase.com/docs/guides/database/extensions)
- PGroonga vs pg_trgm comparison: [pgroonga.github.io/reference/pgroonga-versus-textsearch-and-pg-trgm](https://pgroonga.github.io/reference/pgroonga-versus-textsearch-and-pg-trgm.html)
- Accent-insensitive collation patterns: [oneuptime.com/blog 2026-01-25](https://oneuptime.com/blog/post/2026-01-25-postgresql-accent-insensitive-collation/view)
- Postgres trigram vs Algolia tradeoffs: [dev.to/saashub](https://dev.to/saashub/postgres-trigram-indexes-vs-algolia-1oma)
- Existing codebase: `/Users/alcylu/Apps/nightlife-mcp/src/services/venues.ts` (lines 401-403, 829-930) — confirmed `hasNeedle()` implementation and in-memory filter pattern
- Project context: `/Users/alcylu/Apps/nightlife-mcp/.planning/PROJECT.md`

---
*Feature research for: fuzzy/accent-insensitive search — nightlife-mcp v3.0*
*Researched: 2026-03-12*
