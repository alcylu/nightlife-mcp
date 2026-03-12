---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Fuzzy Search
status: ready_to_plan
stopped_at: null
last_updated: "2026-03-12"
last_activity: 2026-03-12 — Roadmap created, 3 phases defined (10-12), 14/14 requirements mapped
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** AI agents find the right venue/event/performer regardless of accent, spacing, or spelling variations in their query.
**Current focus:** v3.0 Fuzzy Search — Phase 10: DB Infrastructure and Normalization Utility

## Current Position

Phase: 10 of 12 (DB Infrastructure and Normalization Utility)
Plan: Not started
Status: Ready to plan
Last activity: 2026-03-12 — Roadmap created, phases 10-12 defined

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

- Architecture: Hybrid approach — DB-level trigram fuzzy matching for venues only; TypeScript-only accent normalization for events and performers. Avoids RPC overhead on event/performer queries where city+date already scopes the result set.
- Implementation order: DB migration first (Phase 10) because both venues service (Phase 11) and events/performers (Phase 12) depend on it.
- Critical constraint: All `CREATE INDEX` statements must use `CONCURRENTLY` — shared Supabase DB with nightlife-tokyo-next means table locks block the consumer site.
- Pitfall to avoid: `unaccent()` is `STABLE`, not `IMMUTABLE`. Must create `f_unaccent()` wrapper before any index definition or the index creation will fail.

### Pending Todos

None.

### Blockers/Concerns

- Verify `unaccent` handles macrons (ō, ū, ā) in Phase 10 before proceeding — Japanese romanization depends on this. May need custom `unaccent.rules` addition (20-minute fix if needed).
- W∆RP edge case: delta character (∆) may not normalize to "A" — "warp" may not find "W∆RP". Acceptable gap for v3.0; document and defer to v3.x name_aliases.
- Schedule GIN index creation during off-peak hours (not Friday/Saturday evening JST) due to CONCURRENTLY requirement.

## Session Continuity

Last session: 2026-03-12
Stopped at: Roadmap created — ready to plan Phase 10
Resume file: None
