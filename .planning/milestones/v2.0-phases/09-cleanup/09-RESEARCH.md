# Phase 9: Cleanup - Research

**Researched:** 2026-03-12
**Domain:** Code deletion — removing Express admin dashboard from nightlife-mcp
**Confidence:** HIGH

## Summary

Phase 9 is a surgical deletion phase. All Express-based VIP admin dashboard code in nightlife-mcp must be removed once nlt-admin has proven itself in production. The work is purely subtractive: no new logic is introduced, no migrations are needed, no API contracts change for external consumers.

The scope is well-bounded: four files in `src/admin/`, one service file (`src/services/vipAdmin.ts`), one test file (`src/services/vipAdmin.test.ts`), a test file for dashboardAuth (`src/admin/dashboardAuth.test.ts`), and targeted edits to `src/http.ts` and `src/config.ts`. The key risk is incomplete removal — leaving dead imports in `http.ts` that cause TypeScript errors, or leaving config fields that create misleading env var documentation.

`src/services/vipAdmin.ts` sits in the services layer and is imported only by `src/admin/vipAdminRouter.ts`. It is not imported by any MCP tool, REST endpoint, or production path. Its test file is also admin-only. Both can be deleted cleanly. The `venues.test.ts` and `performers.test.ts` files reference `vipDashboardAdmins` fields on the config mock object — those references must be removed from the mock when the config fields are cleaned up.

**Primary recommendation:** Delete the `src/admin/` directory, delete `src/services/vipAdmin.ts` and `src/services/vipAdmin.test.ts`, then surgically remove every admin reference from `src/http.ts` and `src/config.ts`. Run `npm run check` and `npm test` to confirm zero TypeScript errors and all surviving tests pass.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLEAN-01 | Express admin dashboard code removed from nightlife-mcp (src/admin/) | All four files in src/admin/ confirmed as admin-only. vipAdminRouter.ts imports vipAdmin.ts service — both must go together. |
| CLEAN-02 | Admin API routes removed from nightlife-mcp Express server | http.ts mounts /api/v1/admin and /ops/* routes. All confirmed admin-only. /deposit/* and /stripe/webhook pages must be preserved. |
| CLEAN-03 | Dashboard auth middleware and config removed from nightlife-mcp | config.ts has VIP_DASHBOARD_ADMINS, VIP_DASHBOARD_SESSION_TTL_MINUTES, VIP_DASHBOARD_SESSION_COOKIE_NAME env vars and three AppConfig fields. All are used only by dashboardAuth. |
</phase_requirements>

## Standard Stack

This phase uses no new libraries. All work is deletion within existing TypeScript source.

### Tools Already Present
| Tool | Version | Purpose |
|------|---------|---------|
| TypeScript | ^5.9.3 | Type checking confirms no broken imports after deletion |
| tsx | ^4.21.0 | Runs tests via `npm test` |
| Node test runner | built-in | `tsx --test src/**/*.test.ts` — no jest/vitest |

## Architecture Patterns

### What Must Be Deleted

**`src/admin/` directory (4 files):**
- `dashboardAuth.ts` — in-process session store, cookie auth, middleware
- `dashboardAuth.test.ts` — test for the above
- `vipAdminRouter.ts` — Express Router for `/api/v1/admin/*` and session-auth wrapper
- `vipDashboardPage.ts` — server-rendered HTML for `/ops/login` and `/ops/vip-dashboard` (~55KB file, large HTML template)

**`src/services/vipAdmin.ts`** — Admin service layer. Imported only by `vipAdminRouter.ts`. Not used by any MCP tool or REST route.

**`src/services/vipAdmin.test.ts`** — 456-line test file, tests the admin service exclusively.

### What Must Be Edited (not deleted)

**`src/http.ts`** — Contains all admin wiring. Surgical removal required:

1. Remove three import lines at the top:
   ```
   import { createDashboardAuth, type RequestWithDashboardAuth } from "./admin/dashboardAuth.js";
   import { createVipAdminRouter } from "./admin/vipAdminRouter.js";
   import { renderVipDashboardLoginPage, renderVipDashboardPage } from "./admin/vipDashboardPage.js";
   ```

2. Remove `dashboardAuth` construction in `main()` (lines 636–641):
   ```typescript
   const dashboardAuth = createDashboardAuth({
     admins: config.vipDashboardAdmins,
     sessionTtlMinutes: config.vipDashboardSessionTtlMinutes,
     sessionCookieName: config.vipDashboardSessionCookieName,
     secureCookies: process.env.NODE_ENV === "production",
   });
   ```

3. Remove all `/ops/*` routes:
   - `GET /ops/login`
   - `POST /ops/login`
   - `POST /ops/logout`
   - `GET /ops/vip-dashboard`

4. Remove `/api/v1/admin` mount block:
   ```typescript
   app.use(
     "/api/v1/admin",
     (req: RequestWithDashboardAuth, res, next) => dashboardAuth.requireApiSession(req, res, next),
     createVipAdminRouter(supabase, { ... }),
   );
   ```

**Preserve everything else** — `/deposit/success`, `/deposit/cancelled`, `/stripe/webhook`, all MCP routes, all REST routes, health endpoint, debug page.

**`src/config.ts`** — Remove dashboard-related items:

1. In `envSchema`: remove `VIP_DASHBOARD_ADMINS`, `VIP_DASHBOARD_SESSION_TTL_MINUTES`, `VIP_DASHBOARD_SESSION_COOKIE_NAME`
2. Remove exported type `VipDashboardAdminCredential`
3. In `AppConfig` type: remove `vipDashboardAdmins`, `vipDashboardSessionTtlMinutes`, `vipDashboardSessionCookieName`
4. Remove `parseVipDashboardAdmins()` function
5. In `loadConfig()` return object: remove the three dashboard fields and the `parseVipDashboardAdmins` call

**`src/services/venues.test.ts`** — Mock config object includes dashboard fields. Remove these three lines from the mock:
```typescript
vipDashboardAdmins: [],
vipDashboardSessionTtlMinutes: 720,
vipDashboardSessionCookieName: "vip_dashboard_session",
```
(TypeScript will enforce this once the fields are removed from `AppConfig`.)

**`src/services/performers.test.ts`** — Same pattern as venues.test.ts. Remove the same three lines from its config mock.

### Routes That MUST Be Preserved

| Route | Reason |
|-------|--------|
| `GET /deposit/success` | Customer-facing deposit result page |
| `GET /deposit/cancelled` | Customer-facing deposit result page |
| `POST /stripe/webhook` | Stripe payment webhook — live traffic |
| All `/mcp` routes | Core product |
| All `/api/v1` routes | REST API — external consumers |
| `GET /health` | Monitored by Cloudflare Workers |
| `GET /debug/recommendations` | Dev-only debug UI (non-production) |
| `GET /favicon.ico` | Harmless, keep for browser requests |

### Anti-Patterns to Avoid

- **Partial deletion:** Removing `src/admin/` without removing the `http.ts` imports leaves TypeScript errors on build. Always delete in the correct sequence.
- **Over-deletion:** `src/services/deposits.ts`, `src/services/email.ts`, `src/services/stripe.ts` are used by `vipBookings.ts` (the MCP booking tool) and the Stripe webhook — do NOT delete them.
- **Removing deposit/stripe routes:** The `/deposit/*` and `/stripe/webhook` routes are live customer-facing paths unrelated to the admin dashboard.
- **Leaving dead env vars in Railway:** After the PR merges, `VIP_DASHBOARD_ADMINS`, `VIP_DASHBOARD_SESSION_TTL_MINUTES`, `VIP_DASHBOARD_SESSION_COOKIE_NAME` should be removed from Railway env vars. This is a follow-up ops step, not a code task, but worth noting.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Confirming no broken imports | Manual grep | `npm run check` (tsc --noEmit) — catches all missing imports instantly |
| Verifying tests still pass | Manual review | `npm test` — Node built-in test runner via `tsx --test src/**/*.test.ts` |
| Verifying 404 on removed routes | Manual curl | Playwright smoke test against local server |

## Common Pitfalls

### Pitfall 1: Leaving TypeScript errors in http.ts
**What goes wrong:** Deleting `src/admin/` files but leaving the three import lines in `http.ts` causes `tsc` to fail, blocking the build and CI.
**Why it happens:** The import paths are still present even though the files are gone.
**How to avoid:** Always edit `http.ts` to remove the imports before or immediately after deleting the admin directory. Run `npm run check` immediately.
**Warning signs:** TypeScript error "Cannot find module './admin/dashboardAuth.js'"

### Pitfall 2: Breaking test config mocks
**What goes wrong:** Removing `vipDashboardAdmins` and related fields from `AppConfig` causes TypeScript errors in `venues.test.ts` and `performers.test.ts` mock objects.
**Why it happens:** These test files construct a full `AppConfig` literal. Once the type no longer has those fields, TypeScript rejects the extra properties (with `exactOptionalPropertyTypes` or excess property checking).
**How to avoid:** After removing fields from `AppConfig`, run `npm run check` — TypeScript will immediately flag the stale mock properties. Remove them.
**Warning signs:** "Object literal may only specify known properties" errors in test files.

### Pitfall 3: Deleting services used by non-admin code
**What goes wrong:** Assuming `vipAdmin.ts` service is the only "admin service" and also deleting `deposits.ts`, `email.ts`, or `stripe.ts`.
**Why it happens:** Those services are used by `vipAdmin.ts`, so they seem related.
**How to avoid:** `deposits.ts` and `email.ts` are also imported by `vipBookings.ts` (the MCP tool path) and the Stripe webhook route. Only `vipAdmin.ts` and `vipAdmin.test.ts` are exclusive to the admin dashboard.
**Warning signs:** Check imports: `grep -r "from.*deposits\|from.*email" src/services/ src/routes/`

### Pitfall 4: `/api/v1/admin` mount order conflict
**What goes wrong:** Removing the admin router mount but leaving the `dashboardAuth` middleware inline reference causes a runtime error since `dashboardAuth` is undefined.
**Why it happens:** The middleware is inlined as a callback closure around `requireApiSession`.
**How to avoid:** Remove the entire `app.use("/api/v1/admin", ...)` block as one unit, not piecemeal.

## Code Examples

### Exact import lines to remove from http.ts
```typescript
// Source: src/http.ts lines 28-33 (current state)
import { createDashboardAuth, type RequestWithDashboardAuth } from "./admin/dashboardAuth.js";
import { createVipAdminRouter } from "./admin/vipAdminRouter.js";
import {
  renderVipDashboardLoginPage,
  renderVipDashboardPage,
} from "./admin/vipDashboardPage.js";
```

### Config fields to remove from AppConfig type
```typescript
// Source: src/config.ts (current state — these three lines removed)
vipDashboardAdmins: VipDashboardAdminCredential[];
vipDashboardSessionTtlMinutes: number;
vipDashboardSessionCookieName: string;
```

### Env schema fields to remove
```typescript
// Source: src/config.ts envSchema (these three removed)
VIP_DASHBOARD_ADMINS: z.string().optional(),
VIP_DASHBOARD_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(10080).default(720),
VIP_DASHBOARD_SESSION_COOKIE_NAME: z.string().default("vip_dashboard_session"),
```

### Test mock lines to remove from venues.test.ts and performers.test.ts
```typescript
// Both files contain this pattern in config mock objects (remove all three lines)
vipDashboardAdmins: [],
vipDashboardSessionTtlMinutes: 720,
vipDashboardSessionCookieName: "vip_dashboard_session",
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (no jest/vitest) |
| Config file | none — invoked directly via tsx |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

`npm test` runs: `tsx --test src/**/*.test.ts`

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLEAN-01 | src/admin/ files deleted, no broken imports | TypeScript check | `npm run check` | n/a — deletion |
| CLEAN-01 | dashboardAuth.test.ts deleted (no longer runs) | manual verify | `npm test` — test no longer present | ✅ (deleted) |
| CLEAN-02 | /ops/* routes return 404 after server restart | smoke | Manual curl or Playwright against local | n/a — no test file |
| CLEAN-02 | /api/v1/admin routes return 404 after server restart | smoke | Manual curl against local | n/a — no test file |
| CLEAN-03 | Config no longer accepts VIP_DASHBOARD_ADMINS | TypeScript check | `npm run check` | n/a — deletion |
| CLEAN-03 | Surviving tests pass with slimmed config | unit | `npm test` | ✅ venues.test.ts, performers.test.ts |

### Sampling Rate
- **Per task commit:** `npm run check && npm test`
- **Per wave merge:** `npm run check && npm test`
- **Phase gate:** Both commands green before `/gsd:verify-work`

### Wave 0 Gaps
None — existing test infrastructure (Node built-in runner) covers all phase requirements. No new test files needed for a deletion phase. The surviving tests in `venues.test.ts` and `performers.test.ts` automatically validate that config cleanup did not break the config shape.

## Open Questions

1. **Railway env var cleanup**
   - What we know: `VIP_DASHBOARD_ADMINS` is set in Railway production env for nightlife-mcp
   - What's unclear: Is the removal of these env vars in scope for this phase or a post-deploy ops step?
   - Recommendation: Include as a checklist item in the plan (not a code task) — they are harmless if left but create noise. Note in plan that they should be removed from Railway after deploy.

2. **Stripe/Resend keys in nightlife-mcp**
   - What we know: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `RESEND_API_KEY` remain in `config.ts` and `http.ts` because `src/routes/stripeWebhook.ts`, `src/services/deposits.ts`, and `src/services/email.ts` are still active paths
   - What's unclear: Whether nlt-admin now handles all Stripe/email side effects or whether the webhook route in nightlife-mcp still has a role
   - Recommendation: Do NOT remove Stripe/Resend config. The `/stripe/webhook` route and deposit result pages are customer-facing and must remain.

## Sources

### Primary (HIGH confidence)
- Direct source inspection: `src/admin/` (all 4 files read in full)
- Direct source inspection: `src/services/vipAdmin.ts` (read in full — 776 lines)
- Direct source inspection: `src/http.ts` (read in full — 1079 lines, admin wiring lines 636–864 identified)
- Direct source inspection: `src/config.ts` (read in full — 141 lines, dashboard fields lines 37–39, 66–68, 116–135)
- Cross-reference: `grep` confirming vipAdmin is only imported by vipAdminRouter.ts
- Cross-reference: venues.test.ts and performers.test.ts mock config structure confirmed

## Metadata

**Confidence breakdown:**
- Files to delete: HIGH — direct inspection, no ambiguity
- Edit targets in http.ts: HIGH — exact line ranges identified from source read
- Edit targets in config.ts: HIGH — exact fields identified
- Test impact: HIGH — grep confirmed which test files reference dashboard config fields
- Preserved routes: HIGH — deposit/stripe routes confirmed unrelated to admin dashboard

**Research date:** 2026-03-12
**Valid until:** This research describes the current source state. Valid as long as no other phase modifies http.ts or config.ts before Phase 9 executes.
