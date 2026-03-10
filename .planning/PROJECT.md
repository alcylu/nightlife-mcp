# VIP Generic Pricing Redesign

## What This Is

A redesign of the nightlife-mcp VIP table tools and Ember AI agent to shift from specific table availability checks to generic venue pricing information. Instead of pretending venues maintain real-time availability data, the system presents honest weekday/weekend minimum spend ranges with table charts, then routes interested users into a booking inquiry flow handled by ops/venues.

## Core Value

Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry — no false promises about "live" availability.

## Requirements

### Validated

- ✓ VIP booking request submission (create_vip_booking_request) — existing, stays as-is
- ✓ Table chart images stored in Supabase — existing, will continue to serve
- ✓ VIP day-default pricing data seeded for 3 venues (1 Oak, CE LA VI, Zouk) — existing
- ✓ Venue operating hours data — existing

### Active

- [ ] MCP VIP tool returns generic weekday/weekend min spend ranges (not per-table availability)
- [ ] MCP VIP tool returns table chart image URL
- [ ] MCP VIP tool includes relevant event info for the requested date (e.g., "busy night — cool event tonight")
- [ ] Ember system prompts updated to present generic pricing conversationally
- [ ] Ember guides users from pricing info → "want me to check with the venue?" → booking inquiry submission
- [ ] Design scales to more venues beyond the initial 3

### Out of Scope

- Per-table real-time availability status — venues won't maintain this data
- Changing the booking request submission flow — works fine as-is
- Adding new venues — this project redesigns the tool/flow, venue expansion is separate
- VIP dashboard or admin UI — not part of this project

## Context

- **Current state**: VIP tools check 4-level pricing fallback (per-date → day-defaults → venue default → unknown) and return per-table availability status. This implies real-time accuracy that venues don't provide.
- **Problem**: Venues won't actively update table availability. Showing "available" or "unknown" per-table is misleading.
- **Solution**: Simplify to generic pricing (weekday vs weekend minimums) + table chart visual. Let the booking inquiry handle specifics.
- **Ember (AI agent)**: Lives in `~/Apps/openclaw/`, deployed on Railway via OpenClaw. Needs prompt updates to use the new conversational flow.
- **Seeded data**: 3 venues have day-default pricing rows — this data still informs the generic weekday/weekend ranges.
- **MCP codebase**: `~/Apps/nightlife-mcp/` — TypeScript, Express, Supabase, MCP SDK.

## Constraints

- **Backward compatibility**: The `create_vip_booking_request` tool and its DB schema stay unchanged
- **Data reuse**: Existing `vip_table_day_defaults` data feeds the generic pricing — don't delete or restructure
- **Two repos**: MCP changes in nightlife-mcp, Ember prompt changes in openclaw
- **Scaling**: Design must handle adding new venues easily (more day-default rows, not code changes)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace existing VIP tool (not new tool) | Simpler — one tool, no deprecation dance | — Pending |
| Generic pricing, not per-table status | Venues won't maintain availability data | — Pending |
| Keep DB structure for future | Per-date/per-table schema may be useful later when venues adopt | — Pending |
| Include event context in response | Helps user understand if it's a busy night | — Pending |

---
*Last updated: 2026-03-10 after initialization*
