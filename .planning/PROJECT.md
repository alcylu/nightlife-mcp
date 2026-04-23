# Nightlife MCP

## What This Is

MCP server and REST API for nightlife event discovery, VIP table pricing, and booking requests. Serves AI agents (Ember concierge, hotel AI platforms) and developer integrations. Clean server with zero admin surface — admin UI lives in nlt-admin.

## Core Value

Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry — no false promises about "live" availability.

## Requirements

### Validated

- ✓ VIP booking request submission (create_vip_booking_request) — v1.0
- ✓ Table chart images stored in Supabase — v1.0
- ✓ VIP day-default pricing data seeded for 3 venues — v1.0
- ✓ Venue operating hours data — v1.0
- ✓ get_vip_pricing MCP tool with weekday/weekend ranges — v1.0 Phase 1
- ✓ REST endpoint /api/v1/venues/:id/vip-pricing — v1.0 Phase 1
- ✓ Ember prompt updated for new pricing flow — v1.0 Phase 2
- ✓ Old VIP tools removed (get_vip_table_availability, get_vip_table_chart) — v1.0 Phase 3
- ✓ Event context + pricing_approximate signals — v1.0 Phase 3
- ✓ Agent workspace sync (AGENTS.md + SKILL.md) — v1.0 Phase 5
- ✓ VIP booking dashboard in nlt-admin with full CRUD — v2.0
- ✓ Status change side effects (Stripe deposits, Resend emails) in nlt-admin API routes — v2.0
- ✓ Access restricted to super_admin + admin roles — v2.0
- ✓ Admin dashboard code removed from nightlife-mcp — v2.0
- ✓ Accent-insensitive venue search ("celavi" finds "CÉ LA VI") — v3.0
- ✓ Space/case-normalized venue search ("1oak" finds "1 OAK") — v3.0
- ✓ Fuzzy/typo-tolerant venue search scoped by city — v3.0
- ✓ Basic accent/case normalization for event and performer search — v3.0

### Active

(None yet — define for next milestone)

### Out of Scope

- Per-table real-time availability status — venues won't maintain this data
- VIP dashboard access for venue_organizer role — admin-only for now
- Multi-city VIP expansion — venue-by-venue rollout, separate effort
- Redesigning the booking request submission flow — works fine as-is
- Real-time websocket push — 2 ops users, low volume, 1-min polling sufficient
- Bulk status update — per-booking side effects (Stripe, email) make bulk risky
- Email template editing UI — templates are stable, change via code deploy

## Context

Shipped v3.0 with 19,376 LOC TypeScript.
Tech stack: TypeScript, @modelcontextprotocol/sdk, Express, Supabase.
nlt-admin (Next.js 15) handles all VIP admin UI at ~/Apps/nlt/nlt-admin/.
nightlife-mcp is a clean MCP server + REST API with zero admin surface.
450 venues in the system, scoped by city in queries.
Search: Supabase PostgREST via `.ilike()` + pg_trgm fuzzy RPC for venues + normalizeQuery for events/performers.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace existing VIP tool (not new tool) | Simpler — one tool, no deprecation dance | ✓ Good |
| Generic pricing, not per-table status | Venues won't maintain availability data | ✓ Good |
| Keep DB structure for future | Per-date/per-table schema may be useful later when venues adopt | ✓ Good |
| Include event context in response | Helps user understand if it's a busy night | ✓ Good |
| Supabase-direct from nlt-admin | Same DB, no need for nightlife-mcp as intermediary | ✓ Good |
| Stripe/email in nlt-admin API routes | Keeps all admin logic in one app, cleaner separation | ✓ Good |
| super_admin + admin only | VIP ops is internal; venue access deferred | ✓ Good |
| Non-blocking side effects | Stripe/Resend failures don't block status updates | ✓ Good |
| 4-level pricing fallback | Covers all data availability scenarios without breaking | ✓ Good |
| Hybrid fuzzy: DB for venues, TS for events/performers | 450 venues benefit from trigram; events/performers scoped by city+date already | ✓ Good |
| Two-pass venue search (exact first, fuzzy fallback) | Avoids RPC cost when exact match exists | ✓ Good |
| IMMUTABLE f_unaccent wrapper | Required for GIN index expressions; unaccent() is STABLE | ✓ Good |
| Zero-dependency normalize (NFD + regex) | No npm packages needed for accent stripping | ✓ Good |
| NORM-03 narrowed (no digit-to-word mapping) | Over-specified; fuzzy RPC handles edge cases | ✓ Good |

## Constraints

- **Same Supabase**: nlt-admin connects to the same Supabase project — no data migration needed
- **RPC dependency**: `admin_update_vip_booking_request` RPC used for atomic status updates with audit trail
- **Stripe/Resend secrets**: nlt-admin needs `STRIPE_SECRET_KEY` and `RESEND_API_KEY` env vars on Railway

---
*Last updated: 2026-03-12 after v3.0 milestone*
