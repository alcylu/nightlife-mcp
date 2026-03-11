# Pitfalls Research

**Domain:** Express admin dashboard → Next.js 15 app router migration (Supabase, Stripe, Resend)
**Researched:** 2026-03-11
**Milestone:** v2.0 — VIP Dashboard Migration to nlt-admin
**Confidence:** HIGH (grounded in both codebases, verified against official docs and community sources)

---

## Critical Pitfalls

### Pitfall 1: Premature Cleanup — Removing Express Dashboard Before nlt-admin Is Proven in Production

**What goes wrong:**
The Express dashboard code in nightlife-mcp (`src/admin/`, `src/services/vipAdmin.ts`, route at `/ops/`) is deleted before the nlt-admin replacement has been tested in production. If nlt-admin has a bug or a missing env var, ops has no fallback. Bookings pile up unworked.

**Why it happens:**
Cross-repo migrations feel "done" when both repos compile. The temptation is to clean up the source repo immediately after the destination repo is deployed. But production traffic reveals problems that staging doesn't catch — missing Railway env vars, RLS policy differences, Stripe key mismatch.

**How to avoid:**
- Complete nlt-admin dashboard implementation and deploy to production first.
- Run both dashboards in parallel for at least 48 hours before removing Express code.
- Only delete from nightlife-mcp after ops has confirmed at least one full booking status update cycle (deposit, confirm, reject) worked end-to-end in nlt-admin production.
- Gate the cleanup phase behind a signed-off QA checklist, not just "it builds."

**Warning signs:**
- nlt-admin dashboard deployed but `STRIPE_SECRET_KEY` not confirmed set on Railway production.
- Cleanup PR merged without an ops team walkthrough of the new dashboard.
- nightlife-mcp Express routes removed but nlt-admin has never handled a `deposit_required` status change in production.

**Phase to address:** Phase 1 (build nlt-admin dashboard) must be fully production-validated before Phase 2 (nightlife-mcp cleanup) begins. Make this a hard gate in the roadmap.

---

### Pitfall 2: Auth Pattern Mismatch — Client-Side RBAC Does Not Protect API Routes

**What goes wrong:**
nlt-admin's existing `(admin)` layout uses `ProtectedRoute` (a client component) that checks `isAdmin` via `useAdminAuth()`. This guards the UI. But any `/api/` route handler in Next.js is accessible directly via HTTP — the layout guard does not apply to API routes. A `PATCH /api/ops/vip-bookings/:id` route that triggers Stripe and Resend will execute for any authenticated user unless the API route itself checks for `super_admin` or `admin` role.

**Why it happens:**
The existing nlt-admin API routes (`/api/admin/users`, `/api/analytics`) already have their own auth checks. But it's easy to add a new route and forget the server-side role check because the UI already gates the page — the route "feels protected."

**How to avoid:**
- Every `/api/ops/vip-bookings/*` route handler must call `createSupabaseServerClient()` and verify the caller has `super_admin` or `admin` role before executing any business logic.
- Copy the exact pattern from `/api/admin/users/route.ts`: auth user → fetch `user_roles` → check role → proceed or 403.
- Do not rely on `ProtectedRoute`, middleware, or layout-level checks to protect mutation API routes. Server-side check is mandatory for every handler that touches Stripe or Resend.

**Warning signs:**
- A new `route.ts` file added under `/api/ops/` that does not contain a call to `supabase.auth.getUser()` in the first 20 lines.
- Role check done only on the page component, not in the corresponding `route.ts` that the page calls.
- API route returns 200 for an unauthenticated `curl` request.

**Phase to address:** Phase 1 (API route implementation). Define a reusable `requireAdminRole(request)` helper at the start of the phase and use it consistently.

---

### Pitfall 3: Service Role Key Used Wrong — Anon Key Can't Bypass RLS for Admin Writes

**What goes wrong:**
nlt-admin uses two Supabase clients: `createSupabaseServerClient()` (anon key + user session, RLS-bound) and `createServiceRoleClient()` (service role, bypasses RLS). The `admin_update_vip_booking_request` RPC and writes to `vip_booking_status_events`, `vip_booking_edit_audits` may require service role if RLS policies on those tables don't grant write access to the anon role. Using the session client for admin mutations silently fails or throws a 403 that looks like a DB error.

**Why it happens:**
The Express dashboard used a service-role Supabase client unconditionally (passed in at server startup). In nlt-admin, the session client is the default everywhere — it's what every existing route uses for reads. Copying the pattern without switching clients for writes causes subtle permission failures.

**How to avoid:**
- Use `createServiceRoleClient()` for all VIP admin write operations: `admin_update_vip_booking_request` RPC, status event inserts, audit inserts, deposit record writes.
- Use `createSupabaseServerClient()` only for auth verification (getting the current user and their roles).
- Pattern: `const supabase = await createSupabaseServerClient()` to verify auth, then `const adminDb = createServiceRoleClient()` for the actual business logic query.
- Add a comment at the top of each admin route handler explaining which client is used for which purpose.

**Warning signs:**
- Supabase error `new row violates row-level security policy` when calling RPC or inserting to status events table.
- Status updates appearing to succeed on the frontend but no row appearing in `vip_booking_status_events`.
- RPC call returning `null` or empty when called with the session client instead of service role.

**Phase to address:** Phase 1 (API route implementation) — establish the two-client pattern in the first route handler and document it.

---

### Pitfall 4: Stripe Secrets Not Added to nlt-admin Railway Before Cutover

**What goes wrong:**
`STRIPE_SECRET_KEY` and `RESEND_API_KEY` currently live in nightlife-mcp's Railway environment. They do not exist in nlt-admin's Railway service. When the nlt-admin API route for `deposit_required` status change runs, `process.env.STRIPE_SECRET_KEY` is `undefined`. The Stripe client initialization throws. The status change appears to succeed (the RPC updated the DB) but the Stripe checkout session is never created. The customer never gets a payment link.

**Why it happens:**
Env vars are per-service on Railway. Developers assume "the creds are in Railway" without checking which service. The failure is silent because the current Express code catches Stripe errors non-blocking — the same pattern will be copied to nlt-admin, hiding the missing key.

**How to avoid:**
- Before writing a single line of Stripe integration in nlt-admin, verify `STRIPE_SECRET_KEY` is set on the nlt-admin Railway service (both dev and production).
- Add a startup check: if `deposit_required` status transitions are possible, validate `process.env.STRIPE_SECRET_KEY` is present. Return a 500 with a clear message rather than silently failing.
- Do not copy the non-blocking `try/catch` pattern from Express until the happy path is confirmed working in production.
- Required env vars for nlt-admin: `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `NIGHTLIFE_BASE_URL` (for Stripe success/cancel URLs).

**Warning signs:**
- nlt-admin Railway Variables tab does not show `STRIPE_SECRET_KEY`.
- First `deposit_required` status change in nlt-admin produces no row in `vip_booking_deposits`.
- No Stripe checkout session appears in the Stripe dashboard after changing a booking to `deposit_required`.

**Phase to address:** Phase 1, step 0 — set env vars on Railway before writing integration code. Add explicit env var validation to the route handler.

---

### Pitfall 5: `editor_username` Populated With Wrong Value — Audit Trail Is Meaningless

**What goes wrong:**
The `admin_update_vip_booking_request` RPC requires `p_editor_username` to identify who made the change. In the Express dashboard, this was `req.dashboardAdminUsername` from the session cookie (a username like "allen"). In nlt-admin, there is no `dashboardAdminUsername` — the auth system uses Supabase user objects. If this field is hardcoded to `"nlt-admin"`, `"dashboard"`, or omitted, every audit entry reads the same, making the audit trail useless for ops.

**Why it happens:**
Port from Express to Next.js involves remapping auth context. `req.dashboardAdminUsername` has no direct equivalent. It's easy to put a placeholder string in and forget to replace it.

**How to avoid:**
- Resolve the editor identity from `supabase.auth.getUser()` response: use `user.email` as the editor username, or concatenate `user.user_metadata.full_name` + `user.email`.
- Pass this value explicitly through to the RPC call. Never hardcode a static string.
- Add a test: create a booking update, read the resulting `vip_booking_edit_audits` row, verify `editor_username` is a real email, not `"dashboard"`.

**Warning signs:**
- All `vip_booking_edit_audits` rows showing `editor_username = "dashboard"` or `editor_username = "nlt-admin"`.
- Ops unable to trace which admin made a change from the audit log.
- The RPC failing because `p_editor_username` is empty string (the RPC validates non-blank).

**Phase to address:** Phase 1 (API route for PATCH /vip-bookings/:id). Resolve and pass editor identity before the first RPC call.

---

### Pitfall 6: Next.js Serverless Context Breaks Node.js Modules Used by Stripe or Resend

**What goes wrong:**
Railway runs nlt-admin as a Next.js standalone server (`output: 'standalone'`), not as individual serverless functions. This is actually safer than Vercel lambdas for long-running operations. However, the `stripe` and `resend` npm packages may not be installed in nlt-admin — they're in nightlife-mcp's `node_modules`. Importing them in an nlt-admin API route fails at build time with `Cannot find module 'stripe'`.

**Why it happens:**
The business logic services (`deposits.ts`, `email.ts`, `stripe.ts`) live in nightlife-mcp and import from that repo's `node_modules`. When migrating the equivalent logic to nlt-admin, developers sometimes try to call nightlife-mcp's API routes instead of re-implementing. Or they copy the service files without adding the npm packages. Both approaches fail.

**How to avoid:**
- `npm install stripe resend` in nlt-admin before writing any integration code.
- Re-implement the deposit creation and email sending logic directly in nlt-admin (or create shared service modules). Do not call nightlife-mcp's Express routes from nlt-admin — that adds unnecessary network dependency.
- Verify packages are in nlt-admin's `package.json` `dependencies` before deploying to Railway.

**Warning signs:**
- TypeScript build error: `Cannot find module 'stripe'` or `Cannot find module 'resend'` in nlt-admin.
- Runtime error on the API route: `Module not found: Can't resolve 'stripe'`.
- `package.json` in nlt-admin does not contain `"stripe"` or `"resend"` in dependencies.

**Phase to address:** Phase 1, step 0 — add npm packages before writing service code.

---

### Pitfall 7: nlt-admin Admin Layout Lets All Admin Roles Reach VIP Dashboard Pages

**What goes wrong:**
The `(admin)` layout in nlt-admin uses `ProtectedRoute`, which grants access to anyone with `isAdmin || isEventOrganizer || isVenueOrganizer`. VIP dashboard should be restricted to `super_admin` and `admin` only. An `event_organizer` who logs into nlt-admin should not see VIP booking data (customer emails, phone numbers, payment amounts).

**Why it happens:**
nlt-admin's existing `ProtectedRoute` was designed for general admin access, not fine-grained feature access. Adding a new section under `(admin)/ops/vip-bookings/` inherits the broad gate without any additional scoping.

**How to avoid:**
- Add a page-level guard to the VIP dashboard pages: check `userRoles.includes('super_admin') || userRoles.includes('admin')` before rendering.
- Or create a new `VipAdminRoute` wrapper component that only passes with `super_admin` or `admin` roles.
- The API route protection (Pitfall 2) is mandatory regardless. The page-level guard is defense-in-depth.
- Do not expose customer PII (email, phone) to any role below `admin`.

**Warning signs:**
- An `event_organizer` test user can navigate to `/ops/vip-bookings` and see the list page.
- VIP booking list API call returns data for a request authenticated as `event_organizer`.
- PII fields visible in nlt-admin to roles that don't need them.

**Phase to address:** Phase 1 (page routing) — define role gate for VIP section before building any page components.

---

### Pitfall 8: Stripe Checkout Success/Cancel URLs Point to Nightlife-MCP Domain

**What goes wrong:**
The existing `createDepositForBooking` function in nightlife-mcp constructs Stripe success/cancel URLs from `nightlifeBaseUrl` — currently `https://api.nightlife.dev`. This points the customer's post-payment redirect to the MCP server. When nlt-admin re-implements deposit creation, if `NIGHTLIFE_BASE_URL` is set to nlt-admin's Railway URL (`https://nlt-admin-production.up.railway.app`), the customer gets redirected to the admin backend after payment, not the consumer site.

**Why it happens:**
`NIGHTLIFE_BASE_URL` in nightlife-mcp is the API server's own base. In nlt-admin, the same env var name likely doesn't exist and developers set it to the nlt-admin URL by default. Stripe success/cancel URLs need to point to `nightlifetokyo.com`, not to either backend.

**How to avoid:**
- The correct Stripe success URL is `https://nightlifetokyo.com/deposit/success` (or similar consumer-facing page).
- Use a dedicated env var like `NIGHTLIFE_CONSUMER_URL` that explicitly points to the consumer site, distinct from nlt-admin's own URL.
- Test Stripe checkout session creation end-to-end in staging: complete a test payment and verify the redirect lands on the correct domain.

**Warning signs:**
- Stripe checkout session `success_url` contains `nlt-admin` or `railway.app` in the URL.
- After completing a test Stripe payment, the browser redirects to a 404 on the admin domain.
- `NIGHTLIFE_BASE_URL` set to `https://nlt-admin-production.up.railway.app` in Railway.

**Phase to address:** Phase 1 (deposit creation integration). Define and document `NIGHTLIFE_CONSUMER_URL` separately from nlt-admin's own deployment URL.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Copy-paste Stripe/email logic from nightlife-mcp without abstracting | Faster to ship | Two copies of the same logic drift; fixes applied in one place, not the other | Never — create shared service functions in nlt-admin from the start |
| Re-use the existing session client (`createSupabaseServerClient`) for all DB writes | Less code | RLS silently blocks admin writes; data appears to save but doesn't | Never for admin mutations — service role client is mandatory |
| Hardcode `editor_username = "nlt-admin"` in RPC call | Unblocks immediate build | Audit trail useless; ops can't trace who changed what | Never — real user identity must flow through |
| Skip Stripe/email env var validation at startup | Faster initial deploy | Silent failures on first production status change; no alert that Stripe key is missing | Never — validate presence of keys before accepting requests |
| Clean up nightlife-mcp Express code in same PR as nlt-admin launch | Keeps repos clean | Zero fallback if nlt-admin has production bugs | Never — two-phase deploy with parallel window is mandatory |
| Allow all roles under `(admin)` to access VIP pages | Simpler routing | PII exposure to event/venue organizers | Never — role gate is mandatory for VIP section |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase service role | Using session client for admin mutations; RLS blocks writes silently | Use `createServiceRoleClient()` for all mutations; session client only for auth verification |
| Stripe SDK | Forgetting to `npm install stripe` in nlt-admin | Install before writing any integration; verify in `package.json` |
| Stripe success URL | Pointing to nlt-admin or nightlife-mcp URL | Point to consumer site (`nightlifetokyo.com`); use dedicated `NIGHTLIFE_CONSUMER_URL` env var |
| Resend SDK | Singleton pattern from nightlife-mcp (`let resendInstance: Resend | null = null`) works in Express (long-lived process) but in Next.js standalone server also works — however, next.js API routes don't guarantee singleton across restarts | Use module-level singleton carefully; alternatively instantiate per-request for simplicity |
| Railway env vars | Assuming Stripe/Resend keys exist in nlt-admin because they're in nightlife-mcp | Verify in Railway Variables panel for nlt-admin service specifically; add them before testing |
| `admin_update_vip_booking_request` RPC | Calling RPC with anon/session client fails if RLS blocks RPC execution for non-service-role | Use service role client for RPC calls; confirm RPC SECURITY DEFINER or service role requirement |
| editor_username in RPC | Passing empty string or static literal | Extract from `user.email` via `supabase.auth.getUser()`; the RPC validates non-blank |
| nlt-admin CSP header | Strict CSP (`"base-uri 'self'; object-src 'none'; frame-ancestors 'none'"`) does not block server-side Stripe API calls, but Stripe.js CDN scripts would be blocked if ever loaded client-side | VIP dashboard does not need client-side Stripe.js — keep Stripe entirely server-side |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sequential Supabase queries in booking list endpoint (bookings → venues → status events → tasks) | List page loads in >2s | Parallelize venue and event/task fetches with `Promise.all` after loading booking rows | Harmless at <20 bookings; noticeable at 50+ |
| Fetching full booking detail (booking + history + audits) on every list row render | Extreme server load if list has 50+ items | Detail query only on individual booking page, never in list endpoint | Breaks immediately if accidentally triggered per-row |
| Re-creating Stripe client on every API request | Minor — SDK handles this gracefully | Module-level Stripe instance or lazy singleton | Not a real issue in practice but wasteful |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Relying on client-side `isAdmin` check to protect VIP mutation routes | Any authenticated user can call mutation API directly | Server-side role check in every mutation route handler, regardless of UI gating |
| Logging Stripe secret key or Resend key in error handling | Credential leak in Railway logs | Never log env var values; log presence only (`"STRIPE_SECRET_KEY present: true"`) |
| Passing booking customer PII (email, phone) in server logs | Customer data in Railway log stream | Log booking IDs only; never log customer email/phone/name in route handlers |
| Missing CSRF protection on state-changing routes | Cross-site request forgery on PATCH/POST routes | Next.js App Router API routes require valid `Origin` header matching domain (built-in for same-origin fetch); add explicit origin check for mutation routes callable cross-domain |
| Using anon key in service client factory | Anon key bypasses nothing; service role is needed for admin operations | `createServiceRoleClient()` must use `SUPABASE_SERVICE_ROLE_KEY`, not `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Status change triggers Stripe + email but shows no feedback until both complete | Ops sees the page freeze for 1-2s with no indication it's working | Show optimistic update or loading state immediately; Stripe/email are side effects that resolve after the status write |
| No error UI when Stripe key is missing and deposit creation fails silently | Ops changes status to `deposit_required`, customer never gets link, booking stalls | Surface Stripe/email failures explicitly in the admin UI response; don't swallow errors silently in the response body |
| Booking list refreshes entire page on status change | Ops loses scroll position; slow on large lists | Use client-side state update or targeted revalidation after mutation |
| Admin editor name not shown in status history | Ops can't see who made a change from the detail view | Surface `editor_username` from `vip_booking_edit_audits` prominently in the booking detail UI |

---

## "Looks Done But Isn't" Checklist

- [ ] **Stripe key set in Railway:** Verify `STRIPE_SECRET_KEY` exists in nlt-admin Railway service (not just nightlife-mcp) — check Railway Variables panel directly.
- [ ] **Resend key set in Railway:** Verify `RESEND_API_KEY` exists in nlt-admin Railway service.
- [ ] **Consumer URL correct:** Verify Stripe checkout `success_url` redirects to `nightlifetokyo.com`, not `nlt-admin` or `api.nightlife.dev`.
- [ ] **Service role used for writes:** Verify API routes use `createServiceRoleClient()` for mutations, not session client — check each `route.ts` for `createServiceRoleClient()` call.
- [ ] **Auth check in every route:** Verify every `/api/ops/vip-bookings/*` handler has a `supabase.auth.getUser()` call followed by role check before executing business logic.
- [ ] **Editor username populated:** Create a test booking update in nlt-admin; verify `vip_booking_edit_audits.editor_username` is a real email, not `"dashboard"`.
- [ ] **Stripe checkout session created:** Change a test booking to `deposit_required`; verify a row appears in `vip_booking_deposits` and a Stripe checkout session exists in the Stripe dashboard.
- [ ] **Email sent:** Change a test booking to `confirmed`; verify a confirmation email arrives at the customer test email.
- [ ] **VIP pages role-gated:** Log in as `event_organizer` test user; verify `/ops/vip-bookings` redirects or shows access denied.
- [ ] **Express dashboard still works:** Before cleanup PR, verify nightlife-mcp Express `/ops/` routes still respond (as fallback).
- [ ] **nightlife-mcp cleanup deferred:** The cleanup PR must not be merged until at least 48h of nlt-admin production operation has been confirmed.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cleanup done too early — Express dashboard gone, nlt-admin has production bug | HIGH | Revert cleanup commit in nightlife-mcp (restore `src/admin/`); re-deploy; use Express dashboard while nlt-admin bug is fixed |
| Stripe key missing — deposit_required bookings have no payment links | MEDIUM | Add key to Railway; for affected bookings, use nightlife-mcp `regenerateDepositCheckout` directly or via Express dashboard |
| Wrong Stripe success URL (pointing to admin domain) | LOW | Update `NIGHTLIFE_CONSUMER_URL` env var and re-deploy; Stripe sessions already created will still work (URL is embedded in session) |
| Service role client not used — RPC calls silently failing | MEDIUM | Switch all admin mutations to service role client; re-verify affected bookings were actually persisted |
| Editor username logged as static string — audit trail corrupt | LOW | Ongoing fix only (past audits are already corrupt); patch the route to use real user email |
| VIP pages accessible to wrong roles | MEDIUM | Add role gate to pages and API routes immediately; audit access logs for unauthorized views |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Premature cleanup before nlt-admin is production-proven | Phase 2 (cleanup) — gate behind 48h parallel window | Both dashboards functional simultaneously before cleanup begins |
| Client-side RBAC only, no server-side check in API routes | Phase 1 (API route implementation) — `requireAdminRole` helper from day 1 | `curl` unauthenticated request to mutation route returns 401 |
| Wrong Supabase client for mutations (session vs. service role) | Phase 1 (API route implementation) — two-client pattern documented | Test booking update succeeds and audit row appears in DB |
| Stripe/Resend secrets not in nlt-admin Railway | Phase 1, step 0 (env setup) — verify before writing code | Railway Variables panel shows all required keys |
| `editor_username` hardcoded or empty | Phase 1 (PATCH route) — resolved from user auth before RPC call | `vip_booking_edit_audits` row shows real email |
| npm packages not installed in nlt-admin | Phase 1, step 0 (package setup) — `npm install stripe resend` | `package.json` contains both; `npm run build` succeeds |
| All admin roles reach VIP pages | Phase 1 (page routing) — role gate defined before page components | `event_organizer` login cannot access `/ops/vip-bookings` |
| Stripe URLs pointing to wrong domain | Phase 1 (deposit creation) — `NIGHTLIFE_CONSUMER_URL` env var | End-to-end Stripe test payment redirects to `nightlifetokyo.com` |

---

## Sources

- Codebase audit: `/Users/alcylu/Apps/nightlife-mcp/src/admin/vipAdminRouter.ts`, `src/services/vipAdmin.ts`, `src/services/deposits.ts`, `src/services/email.ts`
- Codebase audit: `/Users/alcylu/Apps/nlt-admin/src/app/api/admin/users/route.ts` (existing auth pattern), `src/lib/supabase/service-client.ts`, `src/components/auth/ProtectedRoute.tsx`
- Next.js App Router auth pitfalls: [Common mistakes with the Next.js App Router and how to fix them — Vercel](https://vercel.com/blog/common-mistakes-with-the-next-js-app-router-and-how-to-fix-them) (HIGH confidence)
- Supabase service role in Next.js: [How to Use the Supabase Service Role Secret Key in Next.js Routes](https://adrianmurage.com/posts/supabase-service-role-secret-key/) (MEDIUM confidence)
- Supabase + Next.js production lessons: [Next.js + Supabase app in production: what would I do differently](https://catjam.fi/articles/next-supabase-what-do-differently) (MEDIUM confidence)
- Stripe in Next.js 15: [Stripe + Next.js 15: The Complete 2025 Guide](https://www.pedroalonso.net/blog/stripe-nextjs-complete-guide-2025/) (MEDIUM confidence)
- Cross-repo migration patterns: [Navigating Frontend Migration: Strategies for Refactoring](https://medium.com/syngenta-digitalblog/navigating-frontend-migration-strategies-for-refactoring-rewriting-and-embracing-microfrontends-331520cde2bb) (MEDIUM confidence)
- CLAUDE.md for both projects (HIGH confidence — direct knowledge of env vars, Railway setup, role system, RPC signatures)

---

*Pitfalls research for: Express VIP admin dashboard → Next.js 15 app router migration (Stripe + Resend)*
*Researched: 2026-03-11*
