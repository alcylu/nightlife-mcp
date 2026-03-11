# Architecture Research

**Domain:** Admin dashboard migration — Express SSR to Next.js 15 App Router
**Researched:** 2026-03-11
**Confidence:** HIGH — based on direct source inspection of both codebases

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      nlt-admin (Next.js 15)                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  (admin) route group — ProtectedRoute + AdminShell         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ /vip         │  │ /vip/[id]    │  │ /vip/new         │  │  │
│  │  │ list page    │  │ detail page  │  │ create page      │  │  │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │  │
│  └─────────┼─────────────────┼──────────────────┼─────────────┘  │
│            │ client fetch    │                  │                  │
│  ┌─────────▼─────────────────▼──────────────────▼─────────────┐  │
│  │  API Routes  /api/vip/*  (server-only, service-role client) │  │
│  │  ┌──────────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │ GET/POST             │  │ GET/PATCH                    │ │  │
│  │  │ /api/vip/bookings    │  │ /api/vip/bookings/[id]       │ │  │
│  │  └──────────────────────┘  │ → RPC + Stripe + Resend      │ │  │
│  │  ┌──────────────────────┐  └──────────────────────────────┘ │  │
│  │  │ GET /api/vip/venues  │                                   │  │
│  │  └──────────────────────┘                                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                  Supabase (shared DB)                             │
│  vip_booking_requests  vip_booking_status_events                  │
│  vip_booking_edit_audits  vip_agent_tasks                         │
│  venues  admin_update_vip_booking_request RPC                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  External Services (server-only)                  │
│  ┌──────────────────┐       ┌────────────────────────────────┐   │
│  │  Stripe (deposit │       │  Resend (transactional email)  │   │
│  │  checkout)       │       │  via RESEND_API_KEY            │   │
│  │  STRIPE_SECRET   │       │                                │   │
│  └──────────────────┘       └────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `(admin)/vip/page.tsx` | List page shell | Thin wrapper, renders `VipBookingsPage` view |
| `(admin)/vip/[id]/page.tsx` | Detail page shell | Thin wrapper, renders `VipBookingDetailPage` view |
| `(admin)/vip/new/page.tsx` | Create page shell | Thin wrapper, renders `VipBookingCreatePage` view |
| `views/vip/VipBookingsPage.tsx` | List UI — filters, table, pagination | Client component, fetches `/api/vip/bookings` |
| `views/vip/VipBookingDetailPage.tsx` | Detail UI — status history, edit audits, actions | Client component, fetches `/api/vip/bookings/[id]` |
| `views/vip/VipBookingCreatePage.tsx` | Create booking form | Client component, POSTs to `/api/vip/bookings` |
| `api/vip/bookings/route.ts` | List + create | Service-role Supabase; ported query logic |
| `api/vip/bookings/[id]/route.ts` | Detail + update | Service-role Supabase + Stripe + Resend on status change |
| `api/vip/venues/route.ts` | VIP-enabled venue list for dropdowns | Service-role Supabase read |
| `services/vipAdminService.ts` | Query functions (ported from nightlife-mcp) | Pure functions accepting `SupabaseClient` |
| `components/layout/AdminNavConfig.ts` | Navigation | MODIFIED — add VIP nav section |

## Recommended Project Structure

```
src/
├── app/
│   ├── (admin)/
│   │   └── vip/                      # NEW — VIP booking section
│   │       ├── page.tsx              # NEW — list page shell
│   │       ├── new/
│   │       │   └── page.tsx          # NEW — create booking shell
│   │       └── [id]/
│   │           └── page.tsx          # NEW — detail/edit shell
│   └── api/
│       └── vip/                      # NEW — server-side API routes
│           ├── bookings/
│           │   ├── route.ts          # NEW — GET (list) + POST (create)
│           │   └── [id]/
│           │       └── route.ts      # NEW — GET (detail) + PATCH (update)
│           └── venues/
│               └── route.ts          # NEW — GET (vip-enabled venue list)
├── services/
│   └── vipAdminService.ts            # NEW — query layer ported from nightlife-mcp
├── views/
│   └── vip/                          # NEW — all VIP view components
│       ├── VipBookingsPage.tsx       # NEW — list view
│       ├── VipBookingDetailPage.tsx  # NEW — detail/edit view
│       └── VipBookingCreatePage.tsx  # NEW — create form
├── components/
│   └── vip/                          # NEW — shared VIP UI components
│       ├── VipStatusBadge.tsx        # NEW — status color-coded badge
│       ├── VipBookingCard.tsx        # NEW — booking summary card
│       └── VipBookingFilters.tsx     # NEW — status/date/search filters
├── types/
│   └── vip.ts                        # NEW — TypeScript types ported from nightlife-mcp
└── components/layout/
    └── AdminNavConfig.ts             # MODIFIED — add VIP nav section
```

### Structure Rationale

- **`app/(admin)/vip/`**: The `(admin)` route group automatically applies `ProtectedRoute` and `AdminShell` via its `layout.tsx`. All pages inside automatically require auth. The thin-shell pattern matches every existing admin section (`venues/page.tsx`, `finance/clients/page.tsx`).
- **`app/api/vip/`**: Stripe and Resend are server-only concerns. Routing all mutations through API routes ensures side effects never run client-side and the `STRIPE_SECRET_KEY` never reaches the browser.
- **`services/vipAdminService.ts`**: Direct port of nightlife-mcp's `vipAdmin.ts` query functions. Accepts a `SupabaseClient` parameter — same contract, no rewrite needed beyond removing Express-specific imports.
- **`types/vip.ts`**: Copy the six VIP types from nightlife-mcp's `types.ts`. These are stable DB-level interfaces, not likely to diverge.

## Architectural Patterns

### Pattern 1: Thin Page Shell + View Component

**What:** Page files under `app/(admin)/` are minimal `'use client'` wrappers that render one view component. All UI state, data fetching, and interaction logic lives in `views/vip/`.

**When to use:** All VIP pages. This matches every existing admin section in nlt-admin.

**Trade-offs:** One extra file per route, but enables view component testing in isolation and keeps routing concerns separate from display logic.

**Example:**
```typescript
// app/(admin)/vip/page.tsx
'use client';
import VipBookingsPage from '@/views/vip/VipBookingsPage';
export default function VipPage() {
  return <VipBookingsPage />;
}
```

### Pattern 2: Client Component Fetches from Own API Route

**What:** View components (`'use client'`) call `fetch('/api/vip/...')` using React state and `useEffect`. No direct Supabase client calls from VIP view components.

**When to use:** All VIP data operations — reads and writes. Even list fetches go through API routes for consistency.

**Trade-offs:** One extra HTTP hop vs direct Supabase from browser. Justified because: (1) status updates need server-side Stripe/Resend; (2) consistent auth pattern across all operations; (3) service-role key never exposed to browser.

**Example:**
```typescript
// views/vip/VipBookingsPage.tsx
'use client';
const [bookings, setBookings] = useState(null);
useEffect(() => {
  fetch('/api/vip/bookings?statuses=submitted,in_review')
    .then(r => r.json())
    .then(setBookings);
}, []);
```

### Pattern 3: API Route Auth — Server Client + Role Check

**What:** Every `/api/vip/*` route authenticates via `createSupabaseServerClient()` (reads the session cookie), checks `user_roles` for `admin` or `super_admin`, then switches to `createServiceRoleClient()` for the actual query. This is the exact pattern used by `app/api/admin/users/route.ts`.

**When to use:** All VIP API routes without exception.

**Trade-offs:** Two Supabase round-trips per request (auth check + operation). Acceptable for an internal ops tool.

**Example:**
```typescript
export async function GET(request: Request) {
  // 1. Auth check (session cookie via SSR client)
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 2. Role check
  const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
  const isAdmin = roles?.some(r => ['admin', 'super_admin'].includes(r.role));
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // 3. Service-role client for the actual query
  const serviceClient = createServiceRoleClient();
  const result = await listVipAdminBookings(serviceClient, parseParams(request));
  return NextResponse.json(result);
}
```

### Pattern 4: Status Update with Non-Blocking Side Effects

**What:** PATCH `/api/vip/bookings/[id]` calls the `admin_update_vip_booking_request` RPC (atomic: booking update + status_event + edit_audit in one transaction), then conditionally triggers Stripe and Resend in `try/catch` blocks that do not affect the HTTP response.

**When to use:** Only the PATCH route on bookings. Side effects are fire-and-forget.

**Trade-offs:** Side effects can silently fail. This is the same design as the existing nightlife-mcp implementation — deliberate, because an admin should never be blocked from changing booking status due to a transient Stripe or Resend error.

## Data Flow

### Booking List Flow

```
User opens /vip
    |
VipBookingsPage mounts (client component)
    |
fetch('/api/vip/bookings?statuses=submitted,in_review&limit=50')
    |
API route: auth check → role check → createServiceRoleClient()
    |
listVipAdminBookings(serviceClient, filters)
    → SELECT vip_booking_requests WHERE status IN (...)
    → load venue names for unique venue_ids
    → load latest vip_booking_status_events per booking
    → load latest vip_agent_tasks per booking
    |
JSON → VipBookingsPage renders table with status badges and filters
```

### Status Update Flow (with side effects)

```
Admin clicks "Mark Deposit Required"
    |
PATCH /api/vip/bookings/{id}
  body: { patch: { status: "deposit_required" }, note: "Sent deposit link." }
    |
API route: auth check → role check
    |
admin_update_vip_booking_request RPC
  (atomic: updates booking row + inserts status_event + inserts edit_audit)
    |
rpcRow.changed_fields includes "status"?
  YES → newStatus === "deposit_required"?
    YES →
      try { createDepositForBooking() → Stripe checkout → insert vip_booking_deposits }
      catch { log, continue }
      try { sendDepositRequiredEmail() → Resend }
      catch { log, continue }
    |
getVipAdminBookingDetail() → fresh detail with updated history + audits
    |
JSON response (200) → VipBookingDetailPage refreshes
```

### Manual Booking Create Flow

```
Admin fills create form → POST /api/vip/bookings
  body: CreateVipAdminBookingInput
    |
API route: auth check → role check
    |
createVipAdminBooking() → createVipBookingRequest()
  (same path as MCP tool create_vip_booking_request)
  → INSERT vip_booking_requests
  → 4-level pricing fallback populates min_spend
  → sendBookingSubmittedEmail() (Resend)
    |
JSON 201 → redirect to detail page
```

### Key Data Flows

1. **Venue dropdown for create form:** GET `/api/vip/venues` → `listVipAdminVenues()` → `venues WHERE vip_booking_enabled = true`. Used to populate the venue selector in the create booking form.
2. **Detail view:** GET `/api/vip/bookings/[id]` → `getVipAdminBookingDetail()` → booking summary + full `vip_booking_status_events` history + `vip_booking_edit_audits`.
3. **Deposit link regeneration (future):** PATCH with a `regenerate_deposit` flag → calls `regenerateDepositCheckout()` from nightlife-mcp's `deposits.ts`. Port this function alongside `createDepositForBooking`.

## Integration Points

### New vs Modified

| Item | Status | Notes |
|------|--------|-------|
| `app/(admin)/vip/page.tsx` | NEW | Thin shell |
| `app/(admin)/vip/new/page.tsx` | NEW | Thin shell |
| `app/(admin)/vip/[id]/page.tsx` | NEW | Thin shell |
| `app/api/vip/bookings/route.ts` | NEW | GET list + POST create |
| `app/api/vip/bookings/[id]/route.ts` | NEW | GET detail + PATCH update |
| `app/api/vip/venues/route.ts` | NEW | GET vip-enabled venues |
| `services/vipAdminService.ts` | NEW | Ported from nightlife-mcp `vipAdmin.ts` |
| `views/vip/VipBookingsPage.tsx` | NEW | List UI |
| `views/vip/VipBookingDetailPage.tsx` | NEW | Detail/edit UI |
| `views/vip/VipBookingCreatePage.tsx` | NEW | Create form UI |
| `components/vip/VipStatusBadge.tsx` | NEW | Shared status display |
| `types/vip.ts` | NEW | Ported types from nightlife-mcp |
| `components/layout/AdminNavConfig.ts` | MODIFIED | Add VIP nav section under a new "VIP" or "Bookings" section |
| `lib/supabase/service-client.ts` | UNCHANGED | Already exists — `createServiceRoleClient()` |
| `lib/supabase/server.ts` | UNCHANGED | Already exists — `createSupabaseServerClient()` |
| `nightlife-mcp/src/admin/` | DELETED (later) | Remove after nlt-admin is verified in production |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Stripe | Server-only. `STRIPE_SECRET_KEY` env var. Called from PATCH route. | `stripe` package must be added to nlt-admin. Port `stripe.ts` + `createDepositForBooking()` from nightlife-mcp. |
| Resend | Server-only. `RESEND_API_KEY` env var. Called from multiple routes. | `resend` package must be added to nlt-admin. Port `email.ts` + `templates.ts` from nightlife-mcp, or import as shared module. |
| Supabase | `createServiceRoleClient()` for queries; `createSupabaseServerClient()` for auth | Both already exist in nlt-admin. `SUPABASE_SERVICE_ROLE_KEY` must be set on Railway (verify it is). |

### Env Vars Required on nlt-admin Railway

| Var | Purpose | Status |
|-----|---------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase connection | Present |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser auth client | Present |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role API routes | Present (verify) |
| `STRIPE_SECRET_KEY` | Deposit checkout creation | MISSING — must add |
| `RESEND_API_KEY` | Transactional emails | MISSING — must add |
| `NIGHTLIFE_BASE_URL` | Stripe success/cancel redirect URLs | MISSING — must add (`https://nightlifetokyo.com`) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| View components → API routes | HTTP fetch (JSON) | Client components never call Supabase directly for VIP data |
| API routes → vipAdminService | Direct function call | Service functions accept `SupabaseClient` — same signature as nightlife-mcp |
| API routes → Stripe | Direct SDK call (`stripe` package) | Non-blocking in PATCH route |
| API routes → Resend | Direct SDK call (`resend` package) | Non-blocking in PATCH and POST routes |
| nlt-admin → nightlife-mcp | None at runtime | nightlife-mcp plays no role in the new dashboard |

## Build Order (Dependency-Aware)

Build bottom-up. Each layer can be tested before the next layer is added.

**Step 1 — Types (no deps)**
- Create `types/vip.ts` — copy `VipAdminBookingSummary`, `VipAdminBookingListResult`, `VipAdminBookingDetailResult`, `VipAdminBookingUpdateResult`, `VipAdminBookingHistoryEntry`, `VipBookingEditAuditEntry`, `VipBookingStatus` from nightlife-mcp `types.ts`.

**Step 2 — Service layer (deps: types, Supabase)**
- Create `services/vipAdminService.ts` — port `listVipAdminBookings`, `listVipAdminVenues`, `getVipAdminBookingDetail`, `updateVipAdminBooking`, `createVipAdminBooking` from nightlife-mcp `vipAdmin.ts`. Remove Express-specific imports. Accept `SupabaseClient` parameter.

**Step 3 — Read-only API routes (deps: service layer)**
- `app/api/vip/venues/route.ts` — GET only. Needed by create form.
- `app/api/vip/bookings/route.ts` — GET only first.
- `app/api/vip/bookings/[id]/route.ts` — GET only first.
- All three use the auth pattern from `api/admin/users/route.ts`.

**Step 4 — List and detail UI (deps: read routes)**
- `components/vip/VipStatusBadge.tsx` — status colors, used everywhere.
- `views/vip/VipBookingsPage.tsx` — list with status filter, date filter, search, pagination.
- `views/vip/VipBookingDetailPage.tsx` — detail with history timeline and audit log (read-only first).
- Page shells for `/vip` and `/vip/[id]`.
- Add VIP entry to `AdminNavConfig.ts`.

**Step 5 — Mutation: create (deps: venues route, Resend)**
- Add `resend` package. Port `email.ts` and `templates.ts`.
- Add POST to `app/api/vip/bookings/route.ts`.
- `views/vip/VipBookingCreatePage.tsx` — create form.
- Page shell for `/vip/new`.
- Add `RESEND_API_KEY` to Railway.

**Step 6 — Mutation: update with side effects (deps: Stripe, Resend)**
- Add `stripe` package. Port `stripe.ts` and `createDepositForBooking()` from `deposits.ts`.
- Add PATCH to `app/api/vip/bookings/[id]/route.ts` with Stripe + Resend side effects.
- Enable edit actions in `VipBookingDetailPage.tsx`.
- Add `STRIPE_SECRET_KEY` and `NIGHTLIFE_BASE_URL` to Railway.

**Step 7 — Verification and cleanup**
- Smoke test all status transitions in production (submitted → in_review → deposit_required → confirmed → rejected).
- Confirm deposit email sends and Stripe checkout URL is valid.
- Remove `src/admin/` from nightlife-mcp after verified.

## Anti-Patterns

### Anti-Pattern 1: Direct Supabase from Client Components for VIP Data

**What people do:** Import the `supabase` browser client in view components and query `vip_booking_requests` directly, as other admin views do for non-sensitive reads.

**Why it's wrong:** Status updates must trigger Stripe and Resend on the server. If reads are client-direct but writes go through API routes, the auth and data-fetch patterns are split. The service-role key (needed for full read access) must never reach the browser.

**Do this instead:** All VIP data operations go through `/api/vip/*` routes — both reads and writes.

### Anti-Pattern 2: Bypassing the admin_update_vip_booking_request RPC

**What people do:** Direct `UPDATE vip_booking_requests SET status = ...` instead of calling the RPC.

**Why it's wrong:** The RPC is a single atomic transaction: it updates the booking, inserts a `vip_booking_status_events` row, and inserts a `vip_booking_edit_audits` row. Bypassing it means the audit trail can silently fall out of sync on any partial failure.

**Do this instead:** Always route status changes through the `admin_update_vip_booking_request` RPC. Direct table writes are only acceptable for fields outside the RPC's scope (none identified yet).

### Anti-Pattern 3: Blocking HTTP Response on Side-Effect Failures

**What people do:** Await Stripe/Resend without try/catch, letting a transient Stripe rate-limit return a 500 to the admin.

**Why it's wrong:** The booking state has already been durably updated in Supabase via the RPC. A failed side effect does not un-do that. Returning 500 confuses the admin about whether the booking was actually updated.

**Do this instead:** Wrap every side effect in `try/catch`. Log the failure. Return 200 with the booking's current state. The deposit link can be regenerated manually; emails can be retried.

### Anti-Pattern 4: Removing nightlife-mcp Admin Code Before Production Verification

**What people do:** Delete `src/admin/` from nightlife-mcp at the same time as deploying nlt-admin.

**Why it's wrong:** If nlt-admin has an undetected bug (side effects not firing, auth edge case), there is no fallback. The Express dashboard, while ugly, is functional and handles real bookings.

**Do this instead:** Keep nightlife-mcp admin code intact until nlt-admin has been verified in production — specifically: at least one successful status change with Stripe deposit creation and confirmation email.

## Scaling Considerations

This is an internal ops tool used by 1-3 admins. Scaling is not a design constraint.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 admins | Current design is sufficient. |
| 5-50 admins | Same design. Next.js + Supabase handles this trivially. |
| 50+ admins | Not a realistic scenario for this tool. |

## Sources

- Direct source read: `/Users/alcylu/Apps/nightlife-mcp/src/admin/vipAdminRouter.ts`
- Direct source read: `/Users/alcylu/Apps/nightlife-mcp/src/admin/dashboardAuth.ts`
- Direct source read: `/Users/alcylu/Apps/nightlife-mcp/src/services/vipAdmin.ts`
- Direct source read: `/Users/alcylu/Apps/nightlife-mcp/src/services/deposits.ts`
- Direct source read: `/Users/alcylu/Apps/nightlife-mcp/src/services/email.ts`
- Direct source read: `/Users/alcylu/Apps/nlt-admin/src/app/(admin)/layout.tsx`
- Direct source read: `/Users/alcylu/Apps/nlt-admin/src/components/auth/ProtectedRoute.tsx`
- Direct source read: `/Users/alcylu/Apps/nlt-admin/src/hooks/useAdminAuth.ts`
- Direct source read: `/Users/alcylu/Apps/nlt-admin/src/lib/supabase/service-client.ts`
- Direct source read: `/Users/alcylu/Apps/nlt-admin/src/lib/supabase/server.ts`
- Direct source read: `/Users/alcylu/Apps/nlt-admin/src/app/api/admin/users/route.ts`
- Direct source read: `/Users/alcylu/Apps/nlt-admin/src/components/layout/AdminNavConfig.ts`
- Direct source read: `/Users/alcylu/Apps/nlt-admin/src/components/layout/AdminShell.tsx`
- `.planning/PROJECT.md` (v2.0 milestone context)
- `CLAUDE.md` (nightlife-mcp technical spec)
- `CLAUDE.md` (nlt-admin project spec)

---
*Architecture research for: VIP Dashboard Migration — nightlife-mcp to nlt-admin*
*Researched: 2026-03-11*
