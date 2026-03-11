---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: VIP Dashboard Migration
status: planning
stopped_at: Completed 07-01-PLAN.md
last_updated: "2026-03-11T09:36:48.514Z"
last_activity: 2026-03-11 — v2.0 roadmap created
progress:
  total_phases: 9
  completed_phases: 7
  total_plans: 11
  completed_plans: 11
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-11)

**Core value:** Users get accurate, trustworthy VIP pricing information and a frictionless path to submit a booking inquiry — no false promises about live availability.
**Current focus:** Phase 6 — Foundation and Read-Only Dashboard (nlt-admin)

## Current Position

Phase: 6 of 9 (Foundation and Read-Only Dashboard)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-03-11 — v2.0 roadmap created

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0 (v2.0)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

*Updated after each plan completion*
| Phase 06 P01 | 15 | 2 tasks | 6 files |
| Phase 06 P03 | 5 | 2 tasks | 5 files |
| Phase 06-foundation-read-only-dashboard P02 | 5 | 2 tasks | 7 files |
| Phase 07 P01 | 6 | 2 tasks | 6 files |

## Accumulated Context

### Decisions

- [Pre-milestone]: Supabase-direct queries from nlt-admin (no nightlife-mcp admin API intermediary)
- [Pre-milestone]: Stripe + Resend side effects move to nlt-admin API routes
- [Pre-milestone]: Access restricted to super_admin + admin roles only
- [Pre-milestone]: Phase 9 (cleanup) gated — 48h production operation required before Express removal
- [Phase 06]: Threw plain Error objects in vipAdminService (no NightlifeError) — nlt-admin has no error class, API routes translate to HTTP status codes directly
- [Phase 06]: getVipAdminBookingDetail returns null for not-found instead of throwing — API route cleanly returns 404 without catching specific error types
- [Phase 06]: Crown icon available in lucide-react 0.462.0 — no Star fallback needed
- [Phase 06]: AuditText union type (typeof TEXT.en | typeof TEXT.ja) fixes TypeScript literal type incompatibility when passing i18n text as component prop
- [Phase 06]: keepPreviousData in useVipBookingList prevents flicker during 60s auto-refresh and filter changes
- [Phase 06]: AdminGuard as inline component in page file — consistent with VipBookingDetailPage pattern
- [Phase 07]: Zod parsed.data spread causes TypeScript optional-field mismatch — fix by destructuring into explicit named fields in route and dialog onSubmit
- [Phase 07]: lookupAdminTablePricing ported as private helper in vipAdminService.ts (not cross-repo import) to keep nlt-admin self-contained
- [Phase 07]: Admin-created bookings skip resolveBookingWindow() date check, email send, and vip_agent_tasks insert — ops owns the booking directly
- [Phase 07]: agent_internal_note saved via UPDATE after INSERT — keeps base INSERT payload minimal and avoids schema coupling

### Pending Todos

None yet.

### Blockers/Concerns

- Cross-repo dependency: nlt-admin dashboard (Phases 6-8) must be complete and production-proven before Phase 9
- nlt-admin Railway service needs STRIPE_SECRET_KEY, RESEND_API_KEY, NIGHTLIFE_CONSUMER_URL added before any code touches Stripe/Resend
- Research flag: Confirm whether `admin_update_vip_booking_request` RPC is SECURITY DEFINER before implementing PATCH route (Phase 8)

## Session Continuity

Last session: 2026-03-11T09:32:42.814Z
Stopped at: Completed 07-01-PLAN.md
Resume file: None
