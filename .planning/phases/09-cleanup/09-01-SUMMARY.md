---
phase: 09-cleanup
plan: "01"
subsystem: nightlife-mcp
tags: [cleanup, admin, express, typescript]
dependency_graph:
  requires: []
  provides: [clean-nightlife-mcp]
  affects: [src/http.ts, src/config.ts]
tech_stack:
  added: []
  patterns: [dead-code-removal, surgical-deletion]
key_files:
  created: []
  modified:
    - src/http.ts
    - src/config.ts
    - src/services/email.ts
    - src/services/vipBookings.ts
    - src/tools/vipBookings.ts
    - src/services/venues.test.ts
    - src/services/performers.test.ts
  deleted:
    - src/admin/dashboardAuth.ts
    - src/admin/dashboardAuth.test.ts
    - src/admin/vipAdminRouter.ts
    - src/admin/vipDashboardPage.ts
    - src/services/vipAdmin.ts
    - src/services/vipAdmin.test.ts
decisions:
  - "dashboardBaseUrl removed from email.ts sendBookingSubmittedEmail — nlt-admin handles ops notifications, /ops/vip-dashboard no longer exists"
metrics:
  duration_minutes: 4
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_modified: 7
  files_deleted: 6
requirements: [CLEAN-01, CLEAN-02, CLEAN-03]
---

# Phase 9 Plan 1: Admin Dashboard Removal Summary

**One-liner:** Removed 6 admin dashboard files (3167 lines) and all Express wiring — nightlife-mcp is now a clean MCP server + REST API with zero admin surface.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Delete admin files and service layer | e145bfc | 6 files deleted (src/admin/*, src/services/vipAdmin.*) |
| 2 | Remove admin references from http.ts and config.ts, fix test mocks | b89953e | src/http.ts, src/config.ts, src/services/email.ts, test mocks |

## What Was Built

Surgical deletion of the Express-based VIP booking admin dashboard that migrated to nlt-admin (Next.js). Removed:

- `src/admin/` directory: dashboardAuth.ts, dashboardAuth.test.ts, vipAdminRouter.ts, vipDashboardPage.ts
- `src/services/vipAdmin.ts` (775 lines) — admin service layer
- `src/services/vipAdmin.test.ts` (456 lines) — admin service tests
- All `/ops/*` route handlers from http.ts (login, logout, vip-dashboard)
- `/api/v1/admin` Express mount from http.ts
- `dashboardAuth` construction block + `express.urlencoded` middleware from http.ts
- 3 admin import lines from http.ts
- `VIP_DASHBOARD_*` env schema fields + `VipDashboardAdminCredential` type + `parseVipDashboardAdmins()` from config.ts
- 3 stale mock fields from venues.test.ts and performers.test.ts

## Preserved Routes (all intact)

- `/health` — health check endpoint
- `/mcp` — MCP streamable HTTP transport
- `/api/v1/*` — REST API for external consumers
- `/deposit/success` + `/deposit/cancelled` — customer-facing deposit result pages
- `/stripe/webhook` — live Stripe payment webhook
- `/debug/recommendations` — dev-only debug UI

## Verification Results

- `npm run check` — zero TypeScript errors
- `npm test` — 75/75 tests pass (no regressions)
- `ls src/admin/` — returns "No such file or directory"
- No grep matches for dashboardAuth, vipAdminRouter, vipDashboardPage, VIP_DASHBOARD_ADMINS, /ops/login, /ops/vip-dashboard, /api/v1/admin in src/

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed broken /ops/vip-dashboard URL from sendBookingSubmittedEmail**
- **Found during:** Task 2 verification (final dead-reference grep)
- **Issue:** `email.ts:sendBookingSubmittedEmail` was constructing `${dashboardBaseUrl}/ops/vip-dashboard` — a URL that no longer exists after removing the /ops/* routes. The call site in `tools/vipBookings.ts` hardcoded `dashboardBaseUrl: "https://api.nightlife.dev"`, which would produce a broken link in booking-submitted notification emails.
- **Fix:** Removed `dashboardBaseUrl` parameter from `sendBookingSubmittedEmail`, removed the URL construction, and removed the `dashboardBaseUrl` field from `createVipBookingRequest` options type and all call sites. Email template handles missing `dashboardUrl` gracefully (no CTA button rendered).
- **Files modified:** src/services/email.ts, src/services/vipBookings.ts, src/tools/vipBookings.ts
- **Commit:** b89953e (included in Task 2 commit)

## Post-Deploy Ops Note

After this code ships to Railway production, remove these env vars from the nightlife-mcp Railway service (they are no longer parsed):
- `VIP_DASHBOARD_ADMINS`
- `VIP_DASHBOARD_SESSION_TTL_MINUTES`
- `VIP_DASHBOARD_SESSION_COOKIE_NAME`

## Self-Check: PASSED

Files verified:
- src/admin/ — CORRECTLY DELETED (No such file or directory)
- src/http.ts — FOUND
- src/config.ts — FOUND
- 09-01-SUMMARY.md — FOUND
- Commit e145bfc — FOUND
- Commit b89953e — FOUND
