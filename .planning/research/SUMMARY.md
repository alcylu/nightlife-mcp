# Project Research Summary

**Project:** VIP Booking Dashboard Migration — nightlife-mcp to nlt-admin
**Domain:** Internal ops admin dashboard migration (Express SSR to Next.js 15 App Router)
**Researched:** 2026-03-11
**Confidence:** HIGH

## Executive Summary

This milestone migrates the existing VIP booking admin dashboard from a server-rendered Express app inside nightlife-mcp (`src/admin/`) into nlt-admin (Next.js 15, React 19, Supabase auth, shadcn-ui). The existing Express dashboard is fully functional — the goal is a code migration with full feature parity, not a greenfield build. All business logic (service functions, RPC contracts, email templates, Stripe deposit flow) already exists and is tested in production inside nightlife-mcp. The primary engineering challenge is adapting this logic to the Next.js App Router patterns already established in nlt-admin, while adding only two new npm packages (`stripe`, `resend`) and three Railway env vars.

The recommended approach is a bottom-up build order: types, then service layer, then read-only API routes, then read-only UI, then create mutation, then update mutation with side effects, then production verification, then cleanup. This order ensures each layer can be tested in isolation before the next is added, and that the Express dashboard remains live as a fallback throughout. The most dangerous phase is the final cleanup (removing Express code from nightlife-mcp) — this must be gated behind at least 48 hours of confirmed production operation in nlt-admin, including at least one verified full status-transition cycle (deposit creation, email dispatch, confirmation).

The key risks are operational rather than architectural: missing Railway env vars for Stripe and Resend, using the wrong Supabase client (session vs. service role) for admin mutations, and cleaning up the Express dashboard before nlt-admin is verified. All three are fully avoidable with explicit checklists and disciplined phase gates. The architecture pattern is already established in nlt-admin — VIP dashboard pages follow the same thin-shell + view-component + API-route structure used by the existing invoicing and users sections.

## Key Findings

### Recommended Stack

nlt-admin already provides the complete stack for this feature. Only two new npm packages are needed: `stripe@^20.4.1` (server-side Stripe API for deposit checkout creation) and `resend@^6.9.3` (transactional email via Resend). Both are already used and tested in nightlife-mcp, so the API shape and integration patterns are known quantities. Three new Railway env vars are required on the nlt-admin service: `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, and `NIGHTLIFE_BASE_URL` (consumer site URL for Stripe redirect URLs, should be renamed `NIGHTLIFE_CONSUMER_URL` to avoid confusion). The Stripe webhook endpoint must be registered separately in the Stripe dashboard for nlt-admin's Railway URL.

**Core technologies:**
- `stripe@^20.4.1`: Server-side deposit checkout creation — same version as nightlife-mcp, same API shape, ports without modification
- `resend@^6.9.3`: Transactional email (deposit required, confirmed, rejected) — same package; port HTML template functions from nightlife-mcp directly, no `react-email` dependency needed
- `@supabase/ssr` (existing): Two-client pattern — session client for auth verification, service role client for admin mutations
- `@tanstack/react-query` (existing): `useQuery` for list and detail, `useMutation` for status update and create
- Radix UI / shadcn (existing): `Table`, `Badge`, `Select`, `Dialog`, `Skeleton` — all installed, no new UI dependencies

**What NOT to add:** `@stripe/stripe-js` (client-side payment UI, not needed here), `react-email` (port existing HTML string templates directly), `@tanstack/react-table` (bounded dataset, Radix Table is sufficient).

See `.planning/research/STACK.md` for full details including version compatibility matrix.

### Expected Features

This is a migration milestone — MVP means full feature parity with the Express dashboard. Features are already defined by the existing implementation. Research validated the complete feature set against hospitality SaaS patterns (TablelistPro, Resy for Operators, Discotech Ops).

**Must have (table stakes — migration incomplete without these):**
- Booking list with status, date range, and search filters, plus pagination — primary ops view
- Booking detail with status history timeline and edit audit log — action context before taking any status change
- Status update (PATCH) with atomic RPC, Stripe deposit creation, and Resend email side effects — core ops workflow
- Manual booking creation form with venue selector (for phone and LINE customers) — ops creates on behalf of customers
- Role guard: super_admin and admin only — replaces cookie-based Express auth
- Nav entry point in nlt-admin admin navigation

**Should have (low-effort differentiators, add alongside v1 or immediately after):**
- Agent task status badge on list rows — surfaces failed email or deposit sends before the customer complains
- Venue filter on booking list — useful when working with a specific venue partner
- 1-minute background refetch via React Query `refetchInterval`
- Empty state with clear-filters call to action

**Defer (v2+):**
- CSV export — not in the Express dashboard; defer until ops explicitly requests
- Bulk status update — risky with per-booking side effects (Stripe, email); defer until volume justifies it
- Stripe dashboard link on booking detail — low priority; ops can open Stripe directly

See `.planning/research/FEATURES.md` for full feature dependency graph and prioritization matrix.

### Architecture Approach

The VIP dashboard follows the exact architectural pattern established in nlt-admin for all admin sections: thin page shell (`app/(admin)/vip/page.tsx`) renders a view component (`views/vip/VipBookingsPage.tsx`) which fetches from Next.js API routes (`app/api/vip/bookings/route.ts`) which call service functions (`services/vipAdminService.ts`) which query Supabase. All VIP data operations — reads and writes — go through API routes, not direct Supabase from client components. This is mandatory because mutations must trigger server-side Stripe and Resend and the service role key must never reach the browser. VIP pages live under `app/(admin)/vip/` to inherit the `ProtectedRoute` + `AdminShell` layout automatically, with a stricter page-level role gate (super_admin and admin only, excluding event and venue organizers who can reach other `(admin)` sections).

**Major components:**
1. **Page shells** (`app/(admin)/vip/`) — thin `'use client'` wrappers under the `(admin)` route group; inherit auth layout automatically
2. **View components** (`views/vip/`) — all UI state, data fetching via `fetch('/api/vip/...')`, interaction logic; client components, not server components
3. **API routes** (`app/api/vip/`) — auth check via session client, role check, then service-role client for queries; Stripe and Resend side effects in PATCH route wrapped in non-blocking `try/catch`
4. **Service layer** (`services/vipAdminService.ts`) — direct port of nightlife-mcp `vipAdmin.ts`; accepts `SupabaseClient` parameter; remove Express-specific imports only
5. **Shared VIP UI components** (`components/vip/`) — `VipStatusBadge`, `VipBookingFilters` reused across list and detail views

See `.planning/research/ARCHITECTURE.md` for full component diagram, data flow sequences, and build order with sub-steps.

### Critical Pitfalls

1. **Premature cleanup — deleting Express dashboard before nlt-admin is production-proven** — keep both codebases running in parallel; gate nightlife-mcp `src/admin/` removal behind 48h of confirmed production operation including a full deposit and confirm cycle in nlt-admin. Never merge the cleanup PR the same day as the nlt-admin launch.

2. **API routes not protected server-side (only UI-gated)** — the `(admin)` layout applies `ProtectedRoute` to pages but does not apply to API route handlers. Every `/api/vip/*` handler must call `createSupabaseServerClient()`, verify the user, check `user_roles` for admin or super_admin, and return 403 before executing any business logic. Define a `requireAdminRole(request)` helper from day one and use it in every route.

3. **Wrong Supabase client for mutations (session client instead of service role)** — `admin_update_vip_booking_request` RPC and write operations require service role. Using the session client causes silent RLS failures. Pattern: `createSupabaseServerClient()` for auth verification only; `createServiceRoleClient()` for all VIP business logic queries.

4. **Stripe and Resend env vars missing from nlt-admin Railway** — `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, and `NIGHTLIFE_BASE_URL` exist in nightlife-mcp's Railway service, not nlt-admin's. Verify and add them to nlt-admin Railway before writing any integration code. Add explicit env var validation in route handlers so failures surface as clear errors rather than silent no-ops.

5. **Stripe checkout success/cancel URLs pointing to wrong domain** — use a dedicated `NIGHTLIFE_CONSUMER_URL` env var pointing to `nightlifetokyo.com`; never set it to the nlt-admin or nightlife-mcp Railway URL. Validate end-to-end in staging: complete a test payment and confirm the redirect lands on `nightlifetokyo.com`.

See `.planning/research/PITFALLS.md` for the full pitfall list with recovery strategies and the "Looks Done But Isn't" verification checklist.

## Implications for Roadmap

The build order is a hard dependency chain. Each phase requires the previous to be complete and testable before proceeding. The parallel-systems window (both Express and nlt-admin live simultaneously) must be maintained throughout Phases 1 through 3.

### Phase 1: Foundation and Read-Only Dashboard

**Rationale:** Types and service layer must exist before API routes can be written. Read-only routes and UI must be validated before adding mutations with side effects. Starting with reads de-risks the most complex parts (Stripe, Resend). Installing packages and setting Railway env vars happens at the very start — even before writing any code that uses them — to eliminate the "packages not installed" and "env vars missing" pitfalls before they can manifest.

**Delivers:** Fully browsable VIP booking list and detail pages in nlt-admin, accessible to super_admin and admin users, with status, date range, and search filters, status history timeline, and edit audit log. No mutation UI yet — read-only throughout this phase.

**Addresses:** Booking list, booking detail, status history timeline, edit audit log, role guard, nav entry point (all table-stakes features except status update and manual create)

**Avoids:** Client-side-only RBAC (define `requireAdminRole` helper first); wrong Supabase client (establish two-client pattern in first route handler and document it); npm packages missing (`npm install stripe resend` at step 0 even though they are not used until Phase 3)

**Build sub-order:**
1. `npm install stripe resend` in nlt-admin; verify in `package.json`; add Railway env vars (`STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `NIGHTLIFE_CONSUMER_URL`) to nlt-admin service
2. `types/vip.ts` — port VIP types from nightlife-mcp `types.ts`
3. `services/vipAdminService.ts` — port list, detail, venues, and create functions from nightlife-mcp `vipAdmin.ts`; remove Express-specific imports; accept `SupabaseClient` parameter
4. `requireAdminRole` helper — shared auth guard reused across all API routes
5. `app/api/vip/venues/route.ts` — GET only (needed later by create form)
6. `app/api/vip/bookings/route.ts` — GET only (list)
7. `app/api/vip/bookings/[id]/route.ts` — GET only (detail)
8. `components/vip/VipStatusBadge.tsx` and `VipBookingFilters.tsx`
9. `views/vip/VipBookingsPage.tsx` and `VipBookingDetailPage.tsx` (read-only, no edit actions)
10. Page shells under `app/(admin)/vip/`, `app/(admin)/vip/[id]/`
11. Add VIP section to `AdminNavConfig.ts`

### Phase 2: Create Booking Mutation

**Rationale:** Creating a booking has fewer side effects than status update — one Resend email, no Stripe. Building it before the more complex PATCH route validates Resend integration in isolation and exercises the POST route pattern cleanly.

**Delivers:** Ops can create bookings on behalf of customers who call in via phone or LINE, directly from nlt-admin. Resend email templates ported and working in the new environment.

**Uses:** `resend@^6.9.3` (already installed in Phase 1); `RESEND_API_KEY` Railway env var; ported `email.ts` and `templates.ts` from nightlife-mcp

**Implements:** POST handler in `app/api/vip/bookings/route.ts`; `createVipAdminBooking()` service function; `views/vip/VipBookingCreatePage.tsx` with venue selector; page shell under `app/(admin)/vip/new/`

**Avoids:** Stripe URL confusion (create flow does not use Stripe, keeping concerns separate for this phase)

### Phase 3: Status Update with Stripe and Resend Side Effects

**Rationale:** The most complex route (PATCH with atomic RPC plus conditional Stripe plus conditional Resend in sequence) is built last, after all dependencies are installed and validated. By this point Resend is tested (Phase 2), Stripe keys are already in Railway (Phase 1 prep), and the service layer is established. The non-blocking `try/catch` pattern for side effects matches the existing Express implementation — deliberate, because an admin must never be blocked from changing booking status due to a transient Stripe or Resend error.

**Delivers:** Full ops workflow — admins can move bookings through the complete status pipeline (submitted → in_review → deposit_required → confirmed or rejected or cancelled) with automatic Stripe deposit session creation and Resend email dispatch on the appropriate transitions.

**Uses:** `stripe@^20.4.1` (already installed); `STRIPE_SECRET_KEY`, `NIGHTLIFE_CONSUMER_URL` Railway env vars; `admin_update_vip_booking_request` RPC for atomic DB update plus audit trail; non-blocking `try/catch` wrapping all side effects

**Avoids:** Blocking HTTP response on side-effect failures; editor_username hardcoded or empty (extract from `user.email` via `supabase.auth.getUser()` before every RPC call); Stripe success URL pointing to wrong domain (use `NIGHTLIFE_CONSUMER_URL` explicitly)

### Phase 4: Production Verification and Express Cleanup

**Rationale:** Cleanup is the last and most irreversible step. The Express dashboard in nightlife-mcp has been running live bookings. Removing it before nlt-admin is proven creates a zero-fallback scenario. Running both systems in parallel through Phases 1 to 3 is the only safe approach.

**Delivers:** nightlife-mcp codebase free of admin/ops code (`src/admin/` deleted, Express admin routes removed from `http.ts`). Clean separation of concerns: all VIP booking management lives in nlt-admin.

**Gate criteria (all must be met before this phase begins):**
- nlt-admin VIP dashboard has been in production for at least 48 hours
- Ops team has confirmed at least one full deposit creation and Stripe session verified in Stripe dashboard
- Ops team has confirmed at least one confirmation email received at the customer test address
- All items in the "Looks Done But Isn't" checklist from PITFALLS.md are checked off
- nightlife-mcp Express admin routes confirmed still responding before the cleanup PR is merged

### Phase Ordering Rationale

- **Reads before writes:** Read-only routes can be validated quickly without any external service dependencies. Mutations require Stripe and Resend to be live, which adds deployment risk.
- **Simple mutations before complex mutations:** Create (Phase 2) has one side effect. Update (Phase 3) has two conditional side effects in sequence. Building in order validates each integration independently so failures are easier to diagnose.
- **Parallel systems throughout Phases 1 to 3:** The Express dashboard remains live the entire time nlt-admin is being built. The cleanup PR is a distinct, gated milestone — never appended as a last step to Phase 3.
- **Package and env var setup at step 0:** Installing packages and setting Railway env vars happens at the very start of Phase 1 before writing any code. This eliminates two of the eight documented pitfalls before they can occur.

### Research Flags

Phases with well-documented patterns — skip additional `/gsd:research-phase`:

- **Phase 1 (Foundation):** All patterns are established in nlt-admin's existing admin sections (`/api/admin/users`, invoicing hooks, `useClientFinancials` hook). Auth, service layer, and read-only route patterns are directly observable in live code. No additional research needed.
- **Phase 2 (Create Mutation):** Resend HTML template approach is fully documented and already in use in nightlife-mcp. POST route pattern follows Phase 1 API route structure exactly.
- **Phase 4 (Cleanup):** Straightforward deletion of `src/admin/` from nightlife-mcp. No research needed — verification checklists drive this phase.

Phases that may need targeted research during planning:

- **Phase 3 (Status Update with Stripe):** The Stripe webhook route (`app/api/webhooks/stripe/route.ts`) uses `request.text()` for raw body — confirmed by community sources (MEDIUM confidence) but worth validating with a test webhook in nlt-admin staging before production. The non-blocking side-effect pattern is a deliberate design decision that should be explicitly re-confirmed with the team — a queue-based retry approach is the alternative if deposit email failures become a support issue at higher booking volumes.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Two new packages (`stripe`, `resend`) are already in nightlife-mcp; versions confirmed via npm registry 2026-03-11. All other stack is unchanged in nlt-admin. No unknowns. |
| Features | HIGH | Feature set is defined by the existing Express dashboard read directly from source. Full parity is the explicit goal — no guessing required. |
| Architecture | HIGH | Both codebases read directly. nlt-admin's existing admin section patterns (invoicing, users) are the blueprint. Component structure fully specified in ARCHITECTURE.md. |
| Pitfalls | HIGH | All 8 pitfalls grounded in direct code inspection of both repos. Most have recovery strategies already documented. Next.js 15 App Router specifics confirmed via Vercel official docs and community sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **`NIGHTLIFE_BASE_URL` vs `NIGHTLIFE_CONSUMER_URL` naming:** PITFALLS.md recommends creating a new env var name (`NIGHTLIFE_CONSUMER_URL`) distinct from any admin or API server URL to avoid Stripe redirect URL misconfiguration. This naming should be resolved before writing the deposit creation route in Phase 3.
- **RLS policy on `admin_update_vip_booking_request` RPC:** Research notes the RPC requires service role, but whether it is declared `SECURITY DEFINER` (executes as owner, bypasses RLS automatically) or requires the caller to present the service role key is not confirmed. Verify this against the Supabase migration file before implementing the PATCH route.
- **Resend singleton lifecycle in nlt-admin:** The singleton pattern (`let resendInstance: Resend | null = null`) works in Express long-lived process and in Next.js standalone server. PITFALLS.md flags MEDIUM confidence on this — if Railway restarts cause issues, the fix is instantiate per-request (one line change). Worth watching on first deploy.

## Sources

### Primary (HIGH confidence)
- Live codebase: `/Users/alcylu/Apps/nightlife-mcp/src/admin/vipAdminRouter.ts`, `src/services/vipAdmin.ts`, `src/services/deposits.ts`, `src/services/email.ts` — exact logic to port
- Live codebase: `/Users/alcylu/Apps/nlt-admin/src/app/api/admin/users/route.ts`, `src/lib/supabase/service-client.ts`, `src/lib/supabase/server.ts`, `src/hooks/useClientFinancials.ts` — established patterns to follow
- npm registry (2026-03-11): `stripe@20.4.1`, `resend@6.9.3` — version confirmation
- Stripe Node SDK changelog: API version `2026-02-25.clover` confirmed for v20.4.x
- Resend official docs (Send with Next.js): `html` prop for HTML string emails confirmed
- CLAUDE.md (both nightlife-mcp and nlt-admin projects): env vars, Railway setup, role system, RPC signatures

### Secondary (MEDIUM confidence)
- Medium, Gragson (2025): Stripe Checkout and Webhook in Next.js 15 — `request.text()` for raw body in App Router webhook route
- Vercel blog: Common mistakes with Next.js App Router — API route auth patterns
- catjam.fi: Next.js + Supabase in production — service role patterns
- Pedro Alonso blog: Stripe + Next.js 15 Complete Guide 2025 — Stripe integration patterns
- adrianmurage.com: How to Use the Supabase Service Role Secret Key in Next.js Routes

### Tertiary (LOW confidence)
- Medium, Syngenta Digital: Navigating Frontend Migration — parallel deployment strategy (general principle, not Next.js-specific)
- TablelistPro / Resy for Operators / Discotech Ops — competitor feature analysis (domain patterns only; not inspected directly)

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
