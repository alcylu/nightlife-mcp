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

- [x] **NORM-01**: Accent-insensitive search — "celavi" finds "CÉ LA VI", "é" matches "e", "ō" matches "o"
- [x] **NORM-02**: Space/punctuation normalization — "celavi" matches "CÉ LA VI", "1oak" matches "1 OAK"
- [x] **NORM-03**: Number-word equivalence — "1oak" matches "oneoak", "1 OAK" matches "one oak"
- [x] **NORM-04**: Case-insensitive matching across all search tools

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
| DB-01 | Phase 10 | Pending |
| DB-02 | Phase 10 | Pending |
| DB-03 | Phase 10 | Pending |
| DB-04 | Phase 10 | Pending |
| NORM-01 | Phase 10 | Complete |
| NORM-02 | Phase 10 | Complete |
| NORM-03 | Phase 10 | Complete |
| NORM-04 | Phase 10 | Complete |
| VEN-01 | Phase 11 | Pending |
| VEN-02 | Phase 11 | Pending |
| VEN-03 | Phase 11 | Pending |
| VEN-04 | Phase 11 | Pending |
| EP-01 | Phase 12 | Pending |
| EP-02 | Phase 12 | Pending |

**Coverage:**
- v3.0 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 — traceability mapped after roadmap creation*
