---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Fuzzy Search
status: executing
stopped_at: Completed 12-01-PLAN.md — events and performers normalization complete
last_updated: "2026-03-12T12:01:28.042Z"
last_activity: "2026-03-12 — Phase 11-01 complete: two-pass fuzzy venue search with shouldAttemptFuzzy guard, RPC integration, VIP hours synthesis, 91 tests passing"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 4
  completed_plans: 4
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** AI agents find the right venue/event/performer regardless of accent, spacing, or spelling variations in their query.
**Current focus:** v3.0 Fuzzy Search — Phase 11: Venue Fuzzy Search Integration (complete), next: Phase 12 Event/Performer Normalization

## Current Position

Phase: 11 of 12 (Venue Fuzzy Search Integration) — Plan 01 of 01 COMPLETE
Plan: Ready to begin Phase 12 (Event/Performer Fuzzy Normalization)
Status: In progress — Phase 11 done, Phase 12 not yet started
Last activity: 2026-03-12 — Phase 11-01 complete: two-pass fuzzy venue search with shouldAttemptFuzzy guard, RPC integration, VIP hours synthesis, 91 tests passing

Progress: [█████░░░░░] 50%

## Accumulated Context

### Decisions

- Architecture: Hybrid approach — DB-level trigram fuzzy matching for venues only; TypeScript-only accent normalization for events and performers. Avoids RPC overhead on event/performer queries where city+date already scopes the result set.
- Implementation order: DB migration first (Phase 10) because both venues service (Phase 11) and events/performers (Phase 12) depend on it.
- Critical constraint: All `CREATE INDEX` statements must use `CONCURRENTLY` — shared Supabase DB with nightlife-tokyo-next means table locks block the consumer site.
- Pitfall to avoid: `unaccent()` is `STABLE`, not `IMMUTABLE`. Must create `f_unaccent()` wrapper before any index definition or the index creation will fail.
- [Phase 10-02]: No npm packages for normalization — String.prototype.normalize('NFD') + regex is zero-dependency canonical solution
- [Phase 10-02]: stripAccents exported separately from normalizeQuery so venues service can use accent-only normalization without collapsing spaces
- [Phase 11-01]: Fuzzy path uses early return to preserve RPC word_similarity ordering — rankVenueSummaries() would re-rank by event activity and destroy similarity ranking
- [Phase 11-01]: shouldAttemptFuzzy uses queryNeedle.trim().length (not queryNeedle.length) to correctly block whitespace-only queries
- [Phase 11-01]: normalizeQuery (not sanitizeIlike) used for RPC argument — strips accents + collapses spaces + lowercases for consistent trigram matching
- [Phase 12-events-and-performers-normalization]: Two-needle pattern: queryText (sanitizeIlike) for DB ILIKE, queryNeedle (normalizeQuery) for client filter — preserves word-boundary matching in DB queries
- [Phase 12-events-and-performers-normalization]: Haystack normalization must mirror needle normalization: stripAccents + space-collapse + lowercase pipeline applied to both sides of comparison

### Pending Todos

- Begin Phase 12 (Event/Performer Fuzzy Normalization) — venues service fuzzy search complete

### Blockers/Concerns

- W∆RP edge case: delta character (∆) may not normalize to "A" — acceptable gap for v3.0; defer to v3.x name_aliases

## Session Continuity

Last session: 2026-03-12T12:01:28.039Z
Stopped at: Completed 12-01-PLAN.md — events and performers normalization complete
Resume file: None
