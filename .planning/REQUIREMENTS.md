# Requirements: Nightlife MCP — Fuzzy Search

**Defined:** 2026-03-12
**Core Value:** AI agents find the right venue/event/performer regardless of accent, spacing, or spelling variations in their query.

## v3.0 Requirements

Requirements for fuzzy search milestone. Each maps to roadmap phases.

### Database Infrastructure

- [x] **DB-01**: pg_trgm and unaccent extensions enabled on Supabase
- [x] **DB-02**: Immutable `f_unaccent` wrapper function created (required for index expressions)
- [x] **DB-03**: GIN trigram index on normalized venue names (created with CONCURRENTLY to avoid blocking shared DB)
- [x] **DB-04**: `search_venues_fuzzy` RPC function using `word_similarity` with configurable threshold

### Search Normalization

- [x] **NORM-01**: Accent-insensitive search — "celavi" finds "CÉ LA VI", "é" matches "e", "ō" matches "o"
- [x] **NORM-02**: Space/punctuation normalization — "celavi" matches "CÉ LA VI", "1oak" matches "1 OAK"
- [x] **NORM-03**: Number-word equivalence — "1oak" matches "oneoak", "1 OAK" matches "one oak"
- [x] **NORM-04**: Case-insensitive matching across all search tools

### Venue Fuzzy Search

- [x] **VEN-01**: Two-pass search strategy — exact/normalized match first, fuzzy fallback on zero results
- [x] **VEN-02**: Typo-tolerant venue search — "Zoook" finds "Zouk", "celavy" finds "CÉ LA VI"
- [x] **VEN-03**: Fuzzy results ranked by match quality (similarity score)
- [x] **VEN-04**: Fuzzy search scoped by city (no cross-city false positives)

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
| DB-01 | Phase 10 | Complete |
| DB-02 | Phase 10 | Complete |
| DB-03 | Phase 10 | Complete |
| DB-04 | Phase 10 | Complete |
| NORM-01 | Phase 10 | Complete |
| NORM-02 | Phase 10 | Complete |
| NORM-03 | Phase 10 | Complete |
| NORM-04 | Phase 10 | Complete |
| VEN-01 | Phase 11 | Complete |
| VEN-02 | Phase 11 | Complete |
| VEN-03 | Phase 11 | Complete |
| VEN-04 | Phase 11 | Complete |
| EP-01 | Phase 12 | Pending |
| EP-02 | Phase 12 | Pending |

**Coverage:**
- v3.0 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 — VEN-01 through VEN-04 marked complete after Phase 11-01 execution*
