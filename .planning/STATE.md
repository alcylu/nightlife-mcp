---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Fuzzy Search
status: awaiting_human_action
stopped_at: "10-01-PLAN.md Task 2 — Apply SQL migrations to Supabase production"
last_updated: "2026-03-12T07:22:00Z"
last_activity: "2026-03-12 — 10-01 SUMMARY.md created; SQL migrations and normalize utility committed; awaiting production deployment"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 4
  completed_plans: 2
  percent: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** AI agents find the right venue/event/performer regardless of accent, spacing, or spelling variations in their query.
**Current focus:** v3.0 Fuzzy Search — Phase 10: DB Infrastructure and Normalization Utility

## Current Position

Phase: 10 of 12 (DB Infrastructure and Normalization Utility)
Plan: 10-01 — paused at Task 2 (checkpoint:human-action — apply migrations to Supabase production)
Status: Awaiting human action
Last activity: 2026-03-12 — Plans 10-01 and 10-02 code complete and committed; 10-01 SUMMARY created; awaiting DB migration deployment

Progress: [█░░░░░░░░░] 10%

## Accumulated Context

### Decisions

- Architecture: Hybrid approach — DB-level trigram fuzzy matching for venues only; TypeScript-only accent normalization for events and performers. Avoids RPC overhead on event/performer queries where city+date already scopes the result set.
- Implementation order: DB migration first (Phase 10) because both venues service (Phase 11) and events/performers (Phase 12) depend on it.
- Critical constraint: All `CREATE INDEX` statements must use `CONCURRENTLY` — shared Supabase DB with nightlife-tokyo-next means table locks block the consumer site.
- Pitfall to avoid: `unaccent()` is `STABLE`, not `IMMUTABLE`. Must create `f_unaccent()` wrapper before any index definition or the index creation will fail.
- [Phase 10-02]: No npm packages for normalization — String.prototype.normalize('NFD') + regex is zero-dependency canonical solution
- [Phase 10-02]: stripAccents exported separately from normalizeQuery so venues service can use accent-only normalization without collapsing spaces

### Pending Todos

- Apply `supabase/migrations/20260312_fuzzy_search.sql` to production Supabase (project nqwyhdfwcaedtycojslb) via SQL editor
- Test macron handling after migration: `SELECT f_unaccent('ō'), f_unaccent('ū');`
- Apply `supabase/migrations/20260312_fuzzy_search_index.sql` via SQL editor during off-peak hours (not Fri/Sat evening JST)
- Run 4 DB verification checks (DB-01 through DB-04) — see 10-01-PLAN.md Task 2 for exact queries
- Report results to resume Plan 10-01 Task 2 continuation

### Blockers/Concerns

- ACTIVE BLOCKER: SQL migrations not yet applied to production — required before Phase 11 can start
- Verify `unaccent` handles macrons (ō, ū, ā) after migration — if unchanged, add custom unaccent rules (~20 min fix)
- Schedule GIN index creation during off-peak hours (not Friday/Saturday evening JST) — CONCURRENTLY builds without lock but still uses DB resources
- W∆RP edge case: delta character (∆) may not normalize to "A" — acceptable gap for v3.0; defer to v3.x name_aliases

## Session Continuity

Last session: 2026-03-12T07:22:00Z
Stopped at: 10-01-PLAN.md Task 2 — Apply SQL migrations to Supabase production (checkpoint:human-action)
Resume file: None
