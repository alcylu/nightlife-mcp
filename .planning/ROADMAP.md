# Roadmap: Nightlife MCP — VIP Operations

## Milestones

- ✅ **v1.0 VIP Pricing Redesign** — Phases 1-5 (shipped 2026-03-11)
- ✅ **v2.0 VIP Dashboard Migration** — Phases 6-9 (shipped 2026-03-12)
- 🚧 **v3.0 Fuzzy Search** — Phases 10-12 (in progress)

## Phases

<details>
<summary>✅ v1.0 VIP Pricing Redesign (Phases 1-5) — SHIPPED 2026-03-11</summary>

- [x] Phase 1: MCP Pricing Tool (3/3 plans) — completed 2026-03-10
- [x] Phase 2: Ember Prompt Update (1/1 plan) — completed 2026-03-11
- [x] Phase 3: Cleanup and Event Context (1/1 plan) — completed 2026-03-11
- [x] Phase 4: Phase 2 Verification and Metadata Hygiene (1/1 plan) — completed 2026-03-11
- [x] Phase 5: Agent Workspace Sync (1/1 plan) — completed 2026-03-11

</details>

<details>
<summary>✅ v2.0 VIP Dashboard Migration (Phases 6-9) — SHIPPED 2026-03-12</summary>

- [x] Phase 6: Foundation and Read-Only Dashboard (3/3 plans) — completed 2026-03-11
- [x] Phase 7: Create Booking Mutation (1/1 plan) — completed 2026-03-11
- [x] Phase 8: Status Update with Stripe and Resend (2/2 plans) — completed 2026-03-11
- [x] Phase 9: Cleanup (1/1 plan) — completed 2026-03-11

</details>

### v3.0 Fuzzy Search (In Progress)

**Milestone Goal:** Make MCP search tools resilient to accent variations, spacing differences, and fuzzy spelling — venues get aggressive DB-level trigram matching, events and performers get lightweight accent normalization.

#### Phase Checklist

- [x] **Phase 10: DB Infrastructure and Normalization Utility** - Enable PostgreSQL extensions, create IMMUTABLE wrapper + GIN index + fuzzy RPC, build shared normalizeQuery() utility (completed 2026-03-12)
- [ ] **Phase 11: Venue Fuzzy Search Integration** - Wire venues service to the fuzzy RPC with two-pass strategy; "CeLaVi", "1oak", "Zeuk" all return correct results
- [ ] **Phase 12: Events and Performers Normalization** - Apply normalizeQuery() to event and performer text matching; accent-variant queries return correct results

## Phase Details

### Phase 10: DB Infrastructure and Normalization Utility
**Goal**: The database extensions, immutable wrapper function, GIN trigram index, and fuzzy search RPC are deployed to production, and the shared TypeScript normalization utility is written and tested — giving the venues service (Phase 11) everything it needs to call the RPC and giving events/performers (Phase 12) the utility to import.
**Depends on**: Nothing (first phase of v3.0)
**Requirements**: DB-01, DB-02, DB-03, DB-04, NORM-01, NORM-02, NORM-03, NORM-04
**Success Criteria** (what must be TRUE):
  1. `SELECT f_unaccent('CÉ LA VI')` returns `ce la vi` in Supabase production (accent stripping works)
  2. `SELECT * FROM search_venues_fuzzy('<tokyo_city_id>', 'celavi', 0.15, 10)` returns the CÉ LA VI row (fuzzy RPC callable)
  3. `EXPLAIN ANALYZE` on a venue name query shows Index Scan using the GIN index, not a Seq Scan (index is active)
  4. `normalizeQuery('CeLaVi')` returns `'celavi'`, `normalizeQuery('1oak')` returns `'1oak'`, `normalizeQuery('é')` returns `'e'` (TypeScript utility correct)
  5. All existing tool calls return identical results to pre-migration (zero regressions)
**Plans:** 2/2 plans complete

Plans:
- [x] 10-01-PLAN.md — DB migrations: extensions, f_unaccent wrapper, fuzzy RPC, GIN index (code complete, awaiting production deployment)
- [x] 10-02-PLAN.md — TDD: normalizeQuery() and stripAccents() TypeScript utility

### Phase 11: Venue Fuzzy Search Integration
**Goal**: The `search_venues` MCP tool and `GET /api/v1/venues` REST endpoint return correct results for accent-variant, spacing-variant, and typo-variant venue name queries, using the two-pass strategy — exact/normalized match first, fuzzy RPC fallback on zero results — without affecting any existing filter behavior.
**Depends on**: Phase 10
**Requirements**: VEN-01, VEN-02, VEN-03, VEN-04
**Success Criteria** (what must be TRUE):
  1. `search_venues city=tokyo query=celavi` returns CÉ LA VI (accent variant resolved)
  2. `search_venues city=tokyo query=1oak` returns 1 OAK (space/case variant resolved)
  3. `search_venues city=tokyo query=zeuk` returns Zouk (1-2 character typo resolved)
  4. Fuzzy results are ordered with highest-similarity venue first (ranking by match quality)
  5. `search_venues city=tokyo` with no query returns the same venue set as before this change (no-query path unchanged)
**Plans**: TBD

### Phase 12: Events and Performers Normalization
**Goal**: The `search_events` and `search_performers` MCP tools and their REST counterparts return correct results for accent-variant queries by normalizing the search needle in TypeScript before matching — no DB changes, no RPC calls, no changes to tool interfaces.
**Depends on**: Phase 10
**Requirements**: EP-01, EP-02
**Success Criteria** (what must be TRUE):
  1. `search_events city=tokyo query="dua lipa"` finds events with performers named "Dua Lipa" or similar accent variants (event search normalized)
  2. `search_performers city=tokyo query="shinjuku"` finds performers whose names contain "Shinjuku" or similar macron variants (performer search normalized)
  3. No `pg_trgm` similarity operators or RPC calls appear in the events or performers code paths (normalization stays TypeScript-only)
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. MCP Pricing Tool | v1.0 | 3/3 | Complete | 2026-03-10 |
| 2. Ember Prompt Update | v1.0 | 1/1 | Complete | 2026-03-11 |
| 3. Cleanup and Event Context | v1.0 | 1/1 | Complete | 2026-03-11 |
| 4. Phase 2 Verification | v1.0 | 1/1 | Complete | 2026-03-11 |
| 5. Agent Workspace Sync | v1.0 | 1/1 | Complete | 2026-03-11 |
| 6. Foundation Dashboard | v2.0 | 3/3 | Complete | 2026-03-11 |
| 7. Create Booking | v2.0 | 1/1 | Complete | 2026-03-11 |
| 8. Status + Stripe/Resend | v2.0 | 2/2 | Complete | 2026-03-11 |
| 9. Cleanup | v2.0 | 1/1 | Complete | 2026-03-11 |
| 10. DB Infrastructure and Normalization Utility | 2/2 | Complete   | 2026-03-12 | - |
| 11. Venue Fuzzy Search Integration | v3.0 | 0/? | Not started | - |
| 12. Events and Performers Normalization | v3.0 | 0/? | Not started | - |

---
*For full phase details (v1.0, v2.0), see milestone archives in `.planning/milestones/`*
