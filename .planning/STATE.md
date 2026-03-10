# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-10)

**Core value:** Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry — no false promises about live availability.
**Current focus:** Phase 1 — MCP Pricing Tool

## Current Position

Phase: 1 of 3 (MCP Pricing Tool)
Plan: 0 of 3 in current phase
Status: Ready to plan
Last activity: 2026-03-10 — Roadmap created

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Pre-planning]: Replace existing VIP tools (not add new ones alongside permanently) — simpler, no deprecation dance
- [Pre-planning]: Old tools stay registered through Phase 1 deploy; removed only after Phase 2 (Ember) is confirmed
- [Pre-planning]: Generic weekday/weekend pricing ranges from vip_table_day_defaults — not per-table status
- [Pre-planning]: Event context (VPRC-07) and pricing_approximate (VPRC-08) deferred to Phase 3 to keep Phase 1 scope tight

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1 → 2]: Cross-repo dependency. nightlife-mcp deploy must precede openclaw SKILL.md update. Confirm openclaw merge can be coordinated with Phase 1 production deploy timing.
- [Phase 1]: Service layer must check vip_table_availability per-date overrides before falling back to day-defaults — special event nights have explicit pricing that must not be suppressed.

## Session Continuity

Last session: 2026-03-10
Stopped at: Roadmap created, STATE.md initialized. Ready to plan Phase 1.
Resume file: None
