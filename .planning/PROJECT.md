# Nightlife MCP — VIP Operations

## What This Is

The nightlife-mcp VIP operations system: MCP tools and REST API for VIP table pricing and booking requests, plus an admin dashboard for ops to manage bookings. The admin dashboard is being migrated from nightlife-mcp's server-rendered Express UI to nlt-admin (Next.js) for a proper admin experience with role-based access.

## Core Value

Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry — no false promises about "live" availability.

## Current Milestone: v2.0 VIP Dashboard Migration

**Goal:** Move the VIP booking admin dashboard from nightlife-mcp into nlt-admin (Next.js), with full feature parity, Supabase-direct queries, and Stripe/email side effects via Next.js API routes. Remove all dashboard code from nightlife-mcp.

**Target features:**
- VIP booking dashboard in nlt-admin (list, detail, update, create)
- Status change side effects (Stripe deposit creation, Resend emails) in nlt-admin API routes
- Access restricted to super_admin + admin roles
- Admin dashboard code removed from nightlife-mcp

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

### Active

- [ ] VIP booking dashboard in nlt-admin with full CRUD
- [ ] Status change side effects (Stripe deposits, Resend emails) in nlt-admin API routes
- [ ] Access restricted to super_admin + admin roles
- [ ] Admin dashboard code removed from nightlife-mcp

### Out of Scope

- Per-table real-time availability status — venues won't maintain this data
- VIP dashboard access for venue_organizer role — admin-only for now
- Multi-city VIP expansion — venue-by-venue rollout, separate effort
- Redesigning the booking request submission flow — works fine as-is

## Context

- **Current dashboard**: Server-rendered HTML in nightlife-mcp (`src/admin/`), cookie-based auth with env-var credentials (`VIP_DASHBOARD_ADMINS`), Express routes at `/ops/`. Full CRUD: booking list with filters, detail with status history + edit audits, status updates with deposit/email triggers, manual booking creation.
- **nlt-admin**: Next.js 15 app at `~/Apps/nlt-admin/`, deployed on Railway. Has Supabase auth with role-based access (super_admin, admin, event_organizer, etc.). Same Supabase project as nightlife-mcp.
- **Side effects**: Status changes trigger Stripe checkout session creation (deposit_required) and Resend emails (deposit_required, confirmed, rejected). These currently live in `src/services/vipAdmin.ts` via dynamic imports of `deposits.ts` and `email.ts`.
- **DB tables**: `vip_booking_requests`, `vip_booking_status_events`, `vip_agent_tasks`, `vip_booking_edit_audits`, `admin_update_vip_booking_request` RPC.
- **Two repos**: Dashboard build in nlt-admin, cleanup in nightlife-mcp.

## Constraints

- **Same Supabase**: nlt-admin already connects to the same Supabase project — no data migration needed
- **Cross-repo**: Dashboard build (nlt-admin) must be complete before nightlife-mcp admin code removal
- **Stripe/Resend secrets**: nlt-admin needs `STRIPE_SECRET_KEY` and `RESEND_API_KEY` env vars on Railway
- **RPC dependency**: `admin_update_vip_booking_request` RPC is used for atomic status updates with audit trail — nlt-admin must use the same RPC

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace existing VIP tool (not new tool) | Simpler — one tool, no deprecation dance | ✓ Good |
| Generic pricing, not per-table status | Venues won't maintain availability data | ✓ Good |
| Keep DB structure for future | Per-date/per-table schema may be useful later when venues adopt | ✓ Good |
| Include event context in response | Helps user understand if it's a busy night | ✓ Good |
| Supabase-direct from nlt-admin | Same DB, no need for nightlife-mcp as intermediary | — Pending |
| Stripe/email in nlt-admin API routes | Keeps all admin logic in one app, cleaner separation | — Pending |
| super_admin + admin only | VIP ops is internal; venue access deferred | — Pending |

---
*Last updated: 2026-03-11 after v2.0 milestone start*
