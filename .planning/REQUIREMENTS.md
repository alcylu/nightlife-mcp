# Requirements: Nightlife MCP — Fuzzy Search

**Defined:** 2026-03-12
**Core Value:** AI agents find the right venue/event/performer regardless of accent, spacing, or spelling variations in their query.

## v3.0 Requirements

Requirements for fuzzy search milestone. Each maps to roadmap phases.

### Database Infrastructure

- [ ] **DB-01**: pg_trgm and unaccent extensions enabled on Supabase
- [ ] **DB-02**: Immutable `f_unaccent` wrapper function created (required for index expressions)
- [ ] **DB-03**: GIN trigram index on normalized venue names (created with CONCURRENTLY to avoid blocking shared DB)
- [ ] **DB-04**: `search_venues_fuzzy` RPC function using `word_similarity` with configurable threshold

### Search Normalization

- [ ] **NORM-01**: Accent-insensitive search — "celavi" finds "CÉ LA VI", "é" matches "e", "ō" matches "o"
- [ ] **NORM-02**: Space/punctuation normalization — "celavi" matches "CÉ LA VI", "1oak" matches "1 OAK"
- [ ] **NORM-03**: Number-word equivalence — "1oak" matches "oneoak", "1 OAK" matches "one oak"
- [ ] **NORM-04**: Case-insensitive matching across all search tools

### Venue Fuzzy Search

- [ ] **VEN-01**: Two-pass search strategy — exact/normalized match first, fuzzy fallback on zero results
- [ ] **VEN-02**: Typo-tolerant venue search — "Zoook" finds "Zouk", "celavy" finds "CÉ LA VI"
- [ ] **VEN-03**: Fuzzy results ranked by match quality (similarity score)
- [ ] **VEN-04**: Fuzzy search scoped by city (no cross-city false positives)

### Events/Performers Normalization

- [ ] **EP-01**: Event search uses accent/space/case normalization on text matching
- [ ] **EP-02**: Performer search uses accent/space/case normalization on text matching

## Future Requirements

### Extended Fuzzy Matching

- **FUT-01**: Japanese katakana/hiragana normalization (カタカナ ↔ ひらがな)
- **FUT-02**: Venue name aliases column for edge cases (W∆RP → WARP)
- **FUT-03**: Phonetic matching for venue names

## Out of Scope

| Feature | Reason |
|---------|--------|
| Japanese character fuzzy matching | pg_trgm drops non-ASCII; agents query in Latin script |
| Full-text search (tsvector) overhaul | Current ilike approach works; fuzzy is additive fix |
| Fuzzy matching for events/performers | Too many records, high false-positive risk; basic normalization sufficient |
| Search analytics/logging | Separate concern, not part of fuzzy fix |
| fuse.js or client-side fuzzy library | DB-level approach is cleaner; no new dependencies needed |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | — | Pending |
| DB-02 | — | Pending |
| DB-03 | — | Pending |
| DB-04 | — | Pending |
| NORM-01 | — | Pending |
| NORM-02 | — | Pending |
| NORM-03 | — | Pending |
| NORM-04 | — | Pending |
| VEN-01 | — | Pending |
| VEN-02 | — | Pending |
| VEN-03 | — | Pending |
| VEN-04 | — | Pending |
| EP-01 | — | Pending |
| EP-02 | — | Pending |

**Coverage:**
- v3.0 requirements: 14 total
- Mapped to phases: 0
- Unmapped: 14 ⚠️

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 after initial definition*
