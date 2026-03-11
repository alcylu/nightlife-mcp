---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: VIP Dashboard Migration
status: defining_requirements
stopped_at: null
last_updated: "2026-03-11"
last_activity: 2026-03-11 — Milestone v2.0 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-11)

**Core value:** Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry — no false promises about live availability.
**Current focus:** Defining requirements for v2.0 VIP Dashboard Migration

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-11 — Milestone v2.0 started

## Accumulated Context

### Decisions

- [Pre-milestone]: Supabase-direct queries from nlt-admin (no nightlife-mcp admin API intermediary)
- [Pre-milestone]: Stripe deposit + Resend email side effects move to nlt-admin API routes
- [Pre-milestone]: Access restricted to super_admin + admin roles
- [Pre-milestone]: Full feature parity — list, detail, update, create, email triggers

### Pending Todos

None yet.

### Blockers/Concerns

- Cross-repo dependency: nlt-admin dashboard must be built and verified before nightlife-mcp admin code removal
- nlt-admin Railway env needs STRIPE_SECRET_KEY and RESEND_API_KEY

## Session Continuity

Last session: 2026-03-11
Stopped at: Milestone initialization
Resume file: None
