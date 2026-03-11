# Phase 6: Foundation and Read-Only Dashboard - Research

**Researched:** 2026-03-11
**Domain:** Next.js 15 App Router (nlt-admin) — VIP dashboard, Supabase-direct queries, role-based API protection
**Confidence:** HIGH

## Summary

Phase 6 builds the VIP booking dashboard inside nlt-admin (Next.js 15 App Router). The service logic already exists in nightlife-mcp's `src/services/vipAdmin.ts` — it is a complete, tested reference implementation for all queries this phase needs. The migration is fundamentally a port: translate the Express service layer into nlt-admin's patterns (TanStack Query hooks + Next.js API routes + Supabase SSR client), then build UI pages using the existing shadcn component library.

Auth enforcement is the most critical new work. The existing `ProtectedRoute` component gates the entire `(admin)` layout group but allows `event_organizer` and `venue_organizer` roles through — VIP pages need a tighter guard (`admin || super_admin` only) at both the UI layer and every API route. The API route pattern for role checking already exists in `/api/admin/users/route.ts`.

Auto-refresh (DASH-08, 60-second polling) is straightforward with TanStack Query's `refetchInterval` — already used in `useOpsHealth` (30-second interval). The booking list is the only polling target; detail pages refresh on navigation.

**Primary recommendation:** Port vipAdmin.ts service logic into nlt-admin as a Next.js API route layer + TanStack Query hooks. Use `createSupabaseServerClient()` in API routes for auth-verified Supabase access. Never expose VIP data via client-side Supabase — always route through `/api/vip/*`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | VIP dashboard pages accessible only to super_admin and admin roles | AdminShell nav config supports `adminOnly` flag; page-level guard needed beyond ProtectedRoute |
| AUTH-02 | VIP API routes verify role server-side (not just UI-gated) | Pattern in `/api/admin/users/route.ts`: `createSupabaseServerClient()` + `user_roles` table check |
| AUTH-03 | VIP section appears in nlt-admin navigation for authorized users | `AdminNavConfig.ts` `adminOnly: true` flag on nav items; add VIP section |
| DASH-01 | Admin can view paginated list of VIP bookings with status badges | `listVipAdminBookings()` service logic maps directly; Badge component in shadcn |
| DASH-02 | Admin can filter bookings by status (multi-select) | Status filter already in service layer; Checkbox multi-select UI needed |
| DASH-03 | Admin can filter bookings by date range | `booking_date_from`/`booking_date_to` params in existing service |
| DASH-04 | Admin can search bookings by customer name, email, or phone | `search` param in existing service; ilike query already implemented |
| DASH-05 | Admin can filter bookings by venue | `venue_id` filter NOT in current service — must add; `listVipAdminVenues()` already exists |
| DASH-06 | Admin sees agent task status badge on booking list rows | `latest_task` field on `VipAdminBookingSummary`; badge UI needed |
| DASH-07 | Admin sees empty state with clear-filters CTA when no results match | Pure UI — no data changes needed |
| DASH-08 | Admin booking list auto-refreshes in background every 60 seconds | TanStack Query `refetchInterval: 60_000` |
| DETAIL-01 | Admin can view full booking detail (customer info, venue, table code, min spend) | `getVipAdminBookingDetail()` returns all fields |
| DETAIL-02 | Admin can view status history timeline with actor, timestamp, and notes | `VipAdminBookingHistoryEntry[]` already in detail response |
| DETAIL-03 | Admin can view edit audit log with field-level before/after values | `VipBookingEditAuditEntry[]` already in detail response |
| DETAIL-04 | Admin can see agent task status on booking detail | `latest_task` on `VipAdminBookingSummary` in detail response |
</phase_requirements>

## Standard Stack

### Core (nlt-admin — already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.5.12 | App Router pages + API routes | This is nlt-admin's framework |
| React | 19.1.0 | UI components | Already in project |
| TypeScript | ^5.5.3 | Type safety | Already in project |
| @supabase/ssr | ^0.8.0 | Cookie-based auth for server components | Already in project |
| @supabase/supabase-js | ^2.50.0 | Supabase client | Already in project |
| @tanstack/react-query | ^5.56.2 | Data fetching + polling | Already in project; used everywhere |
| Tailwind CSS | ^3.4.11 | Styling | Already in project |
| lucide-react | ^0.462.0 | Icons | Already in project |
| sonner | ^1.5.0 | Toast notifications | Already in project |
| zod | ^3.23.8 | Request validation | Already in project |

### shadcn UI Components (already installed)
| Component | Purpose |
|-----------|---------|
| `Badge` | Status indicators, agent task badges |
| `Button` | Filter actions, clear filters CTA |
| `Card` | Detail page sections |
| `Input` | Search field |
| `Select` | Single-select filters (venue) |
| `Checkbox` | Multi-select status filter |
| `Skeleton` | Loading states |
| `Table` | Booking list |
| `Separator` | Detail page section dividers |
| `Tabs` | Detail page (history / audits) |
| `Pagination` | Booking list pagination |

**Installation:** Nothing to install — all dependencies already exist in nlt-admin.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── (admin)/
│   │   └── vip/                        # VIP section (AUTH-01: admin layout applies)
│   │       ├── page.tsx                # /vip → VIP booking list (DASH-01 thru DASH-08)
│   │       └── [id]/
│   │           └── page.tsx            # /vip/[id] → Booking detail (DETAIL-01 thru DETAIL-04)
│   └── api/
│       └── vip/
│           ├── bookings/
│           │   └── route.ts            # GET /api/vip/bookings (AUTH-02)
│           └── bookings/
│               └── [id]/
│                   └── route.ts        # GET /api/vip/bookings/[id] (AUTH-02)
├── services/
│   └── vipAdminService.ts              # Supabase query functions (ported from nightlife-mcp)
├── hooks/
│   └── useVipBookings.ts               # TanStack Query: list + detail + refetchInterval
├── types/
│   └── vip.ts                          # VipBookingStatus, VipAdminBookingSummary, etc.
└── components/
    └── vip/
        ├── VipBookingList.tsx           # Table + filters + pagination (DASH-01 thru DASH-07)
        ├── VipBookingRow.tsx            # Single table row with badges
        ├── VipStatusBadge.tsx           # Colored status badge component
        ├── VipAgentTaskBadge.tsx        # Agent task status indicator (DASH-06, DETAIL-04)
        ├── VipBookingFilters.tsx        # Filter bar (status, date, venue, search)
        ├── VipBookingDetail.tsx         # Detail page container (DETAIL-01 thru DETAIL-04)
        ├── VipStatusTimeline.tsx        # Status history timeline (DETAIL-02)
        └── VipAuditLog.tsx             # Edit audit log table (DETAIL-03)
```

### Pattern 1: Server-Side Role Check in API Routes (AUTH-02)

Every `/api/vip/*` route must verify `admin` or `super_admin` role before returning data.

**What:** Two-step auth check — first verify Supabase session, then verify role from `user_roles` table.
**When to use:** Every single API route in `/api/vip/`.
**Example:**
```typescript
// src/app/api/vip/bookings/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  // 1. Verify session
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Verify admin/super_admin role
  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const isAdmin = roles?.some(r => r.role === 'admin' || r.role === 'super_admin');
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 });
  }

  // 3. Query data (use service role client for VIP data — bypasses RLS)
  // ...
}
```
Source: Pattern established in `/api/admin/users/route.ts` (existing code, verified).

### Pattern 2: TanStack Query Hook with Auto-Refresh (DASH-08)

**What:** Client hook that fetches from `/api/vip/bookings` and auto-refreshes every 60 seconds.
**When to use:** Booking list page only (detail page refreshes on navigation).
**Example:**
```typescript
// src/hooks/useVipBookings.ts
import { useQuery } from '@tanstack/react-query';

export function useVipBookingList(filters: VipBookingListFilters) {
  return useQuery({
    queryKey: ['vip-bookings', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      // append filter params...
      const res = await fetch(`/api/vip/bookings?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<VipAdminBookingListResult>;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,  // DASH-08: 60-second background refresh
  });
}
```
Source: Pattern from `useOpsHealth.ts` (staleTime: 30_000, refetchInterval: 30_000) — verified in codebase.

### Pattern 3: VIP-Only Page Guard (AUTH-01)

The `(admin)` layout already wraps everything in `ProtectedRoute`, but `ProtectedRoute` allows `event_organizer` and `venue_organizer` through. VIP pages need an additional admin-only check.

**What:** A lightweight `VipProtectedRoute` wrapper (or inline check) that redirects non-admins.
**When to use:** `/vip/page.tsx` and `/vip/[id]/page.tsx`.
**Example:**
```typescript
// Pattern: inline guard inside page component
'use client';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function VipPage() {
  const { isAdmin, isLoading } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.replace('/');
    }
  }, [isAdmin, isLoading, router]);

  if (isLoading || !isAdmin) return <LoadingSpinner />;
  return <VipBookingList />;
}
```
Source: Pattern from `ProtectedRoute.tsx` — verified in codebase.

### Pattern 4: Navigation Entry with adminOnly Flag (AUTH-03)

**What:** Add a VIP section to `AdminNavConfig.ts` with `adminOnly: true`.
**When to use:** Any nav item that should only appear for admin/super_admin roles.
**Example:**
```typescript
// In AdminNavConfig.ts — add new section
{
  id: 'vip',
  dividerBefore: true,
  labelEn: 'VIP Bookings',
  labelJa: 'VIP予約',
  items: [
    {
      path: '/vip',
      icon: Crown,  // or another relevant lucide icon
      labelEn: 'Bookings',
      labelJa: '予約管理',
      adminOnly: true,  // filtered out for non-admins in AdminShell
    },
  ],
},
```
Source: `AdminNavConfig.ts` and `AdminShell.tsx` — verified filtering logic present.

### Pattern 5: Service Layer for Supabase Queries

**What:** Port vipAdmin.ts query logic into nlt-admin as plain async functions.
**When to use:** Called from API routes (server-side), never from client components directly.

The existing service uses `SupabaseClient` directly. In nlt-admin, use `createServiceRoleClient()` inside API routes to bypass RLS — VIP booking data is admin-only so RLS bypass is appropriate.

Key queries to port:
- `listVipAdminBookings()` — paginated list with filters (add `venue_id` filter for DASH-05)
- `getVipAdminBookingDetail()` — booking + history + audits
- `listVipAdminVenues()` — venue dropdown for filters

### Anti-Patterns to Avoid
- **Supabase client-side VIP queries:** Never call VIP tables from browser Supabase client. Always go through `/api/vip/*` so the server enforces role.
- **UI-only auth gating:** `ProtectedRoute` and `useAdminAuth` are client-side. Non-admin users who bypass UI still hit API routes — server-side role check is mandatory (AUTH-02).
- **Copying nightlife-mcp types verbatim:** Port types to `src/types/vip.ts` in nlt-admin — don't import from nightlife-mcp.
- **Venue filter not in current service:** DASH-05 requires filtering by `venue_id`. The existing `listVipAdminBookings()` in nightlife-mcp does NOT have a venue filter. Must add it when porting.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth cookie handling | Custom cookie parser | `createSupabaseServerClient()` | Handles rotation, refresh, edge cases |
| Toast notifications | Custom alert system | `toast` from `sonner` | Already wired up in Providers.tsx |
| Table UI | Custom HTML table | `Table` from `@/components/ui/table` | Consistent with rest of admin |
| Status color logic | Inline style maps | `VipStatusBadge` component (to build) | Centralized, reusable across list + detail |
| Date formatting | Custom date string logic | `date-fns` (already installed) | Timezone-aware formatting |
| Pagination | Custom prev/next | `Pagination` from `@/components/ui/pagination` | Already in shadcn library |
| Loading state | Custom spinner | `Skeleton` from `@/components/ui/skeleton` | Consistent with rest of admin |

**Key insight:** The query logic for this phase is fully implemented in nightlife-mcp's `vipAdmin.ts`. This phase is a port, not a rewrite — don't invent new query patterns.

## Common Pitfalls

### Pitfall 1: Missing Venue Filter on DASH-05
**What goes wrong:** The existing `listVipAdminBookings()` in nightlife-mcp has no `venue_id` filter parameter. Developer ports the function as-is, DASH-05 is not satisfied.
**Why it happens:** Requirements include a venue filter (DASH-05) that wasn't needed in the original Express dashboard (it used a different filter set).
**How to avoid:** When porting the service function, add `venue_id?: string` to the input type and `.eq('venue_id', venueId)` to the Supabase query when provided.
**Warning signs:** Filter dropdown is present but doesn't change results.

### Pitfall 2: ProtectedRoute Isn't Enough for AUTH-01
**What goes wrong:** Developer relies on `ProtectedRoute` and assumes only admins access nlt-admin. `event_organizer` and `venue_organizer` users can access `/vip` pages.
**Why it happens:** `ProtectedRoute` checks `isAdmin || isEventOrganizer || isVenueOrganizer`. VIP requires `isAdmin` only.
**How to avoid:** Add a secondary guard inside VIP page components (or a dedicated `VipProtectedRoute` wrapper) that checks `isAdmin` specifically.
**Warning signs:** EO/VO test users can navigate to `/vip` URL directly.

### Pitfall 3: API Route Returns 200 to Unauthorized Client
**What goes wrong:** API route validates session but not role. Authenticated non-admin users get VIP data.
**Why it happens:** Developer only checks `user !== null`, not role.
**How to avoid:** Every API route must check `user_roles` table for `admin` or `super_admin` before returning any data. Return 403 for wrong role.
**Warning signs:** Postman/curl with an EO user's token returns 200 from `/api/vip/bookings`.

### Pitfall 4: Auto-Refresh During Filter Changes (DASH-08)
**What goes wrong:** `refetchInterval` fires while user is typing in the search box, resetting the list unexpectedly.
**Why it happens:** TanStack Query refetches based on `queryKey` changes AND on interval. If `queryKey` includes filter state, every keystroke creates a new subscription.
**How to avoid:** Debounce the search input (300-500ms) before updating query key. Use `keepPreviousData: true` (TanStack v5: `placeholderData: keepPreviousData`) so the old list shows while new results load.
**Warning signs:** List flickers or resets while typing.

### Pitfall 5: `createServiceRoleClient()` Missing Env Var on Railway
**What goes wrong:** API routes work locally but fail in production because `SUPABASE_SERVICE_ROLE_KEY` is not set on nlt-admin's Railway service.
**Why it happens:** nlt-admin already uses the service role client (for user management) but VIP routes are the first to depend on it for regular data reads.
**How to avoid:** Verify `SUPABASE_SERVICE_ROLE_KEY` is set on both dev and prod Railway environments before deploying. Check STATE.md — this is flagged as a known concern.
**Warning signs:** 500 errors on all `/api/vip/*` routes in staging.

### Pitfall 6: i18n Missing from VIP Pages
**What goes wrong:** VIP pages show English-only labels while the rest of admin has EN/JA support.
**Why it happens:** New pages skip the `useLanguage()` pattern used everywhere else.
**How to avoid:** Follow the `TEXT = { en: {...}, ja: {...} }` pattern seen in `ops/page.tsx`. At minimum add the key VIP labels in both languages.
**Warning signs:** JA users see raw English strings.

## Code Examples

Verified patterns from existing nlt-admin codebase:

### Supabase Server Client (for API routes)
```typescript
// Source: src/lib/supabase/server.ts (verified)
import { createSupabaseServerClient } from '@/lib/supabase/server';

const supabase = await createSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();
```

### Service Role Client (for admin data reads that bypass RLS)
```typescript
// Source: src/lib/supabase/service-client.ts (verified)
import { createServiceRoleClient } from '@/lib/supabase/service-client';

const serviceClient = createServiceRoleClient();
// Use serviceClient for VIP queries — bypasses RLS, requires SUPABASE_SERVICE_ROLE_KEY
```

### Role Check Pattern (from /api/admin/users/route.ts — verified)
```typescript
const { data: callerRoles } = await supabase
  .from('user_roles')
  .select('role')
  .eq('user_id', caller.id);

const isAdmin = callerRoles?.some(r => r.role === 'super_admin' || r.role === 'admin');
if (!isAdmin) {
  return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 });
}
```

### TanStack Query with Auto-Refresh (from useOpsHealth.ts — verified)
```typescript
// Source: src/hooks/useOpsHealth.ts
return useQuery<OpsHealthSnapshot>({
  queryKey: ['ops-health-snapshot'],
  queryFn: async () => { /* fetch */ },
  staleTime: 30 * 1000,
  refetchInterval: 30 * 1000,  // adapt to 60_000 for VIP
});
```

### Toast Notifications (from CLAUDE.md — verified)
```typescript
import { toast } from 'sonner';
toast.success('Bookings refreshed');
toast.error('Failed to load bookings: ' + error.message);
```

### Status Badge Color Map (to build, based on VipBookingStatus)
```typescript
// VipBookingStatus values (from nightlife-mcp types.ts — verified):
// "submitted" | "in_review" | "deposit_required" | "confirmed" | "rejected" | "cancelled"
const STATUS_COLORS: Record<VipBookingStatus, string> = {
  submitted:         'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_review:         'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  deposit_required:  'bg-orange-500/20 text-orange-400 border-orange-500/30',
  confirmed:         'bg-green-500/20 text-green-400 border-green-500/30',
  rejected:          'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled:         'bg-gray-500/20 text-gray-400 border-gray-500/30',
};
```

### Existing VIP Query Data Shapes (from nightlife-mcp — port these types)

Key types to replicate in `src/types/vip.ts`:
- `VipBookingStatus` — the six status string literals
- `VipAdminBookingSummary` — complete booking row with latest task
- `VipAdminBookingListResult` — `{ now, total_count, count, limit, offset, statuses, bookings }`
- `VipAdminBookingDetailResult` — `{ now, booking, history, audits }`
- `VipAdminBookingHistoryEntry` — `{ status, at, actor_type, note }`
- `VipBookingEditAuditEntry` — `{ audit_id, editor_username, change_note, changed_fields, before_values, after_values, created_at }`
- `VipReservationLatestTask` — nested in summary for DASH-06/DETAIL-04

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express cookie-based auth (nightlife-mcp) | Supabase session-based auth (nlt-admin) | v2.0 migration | Role stored in `user_roles` table, checked server-side |
| Server-rendered HTML (vipDashboardPage.ts) | React client components + API routes | v2.0 migration | Full SPA behavior, TanStack Query polling |
| Env-var credentials (VIP_DASHBOARD_ADMINS) | Supabase `user_roles` table | v2.0 migration | Role changes without redeploy |

**Note:** `@supabase/ssr` v0.8.0 uses `getAll`/`setAll` cookie methods. The older `get`/`set`/`remove` pattern from older versions is not used in this project.

## DB Tables Reference (Supabase — same project)

All tables exist in the shared Supabase project (`nqwyhdfwcaedtycojslb`):

| Table | Purpose | Used By |
|-------|---------|---------|
| `vip_booking_requests` | Primary booking data | List + detail |
| `vip_booking_status_events` | Status history timeline | DETAIL-02 |
| `vip_booking_edit_audits` | Field-level edit audit | DETAIL-03 |
| `vip_agent_tasks` | Agent task status | DASH-06, DETAIL-04 |
| `venues` | Venue names for filter dropdown + display | DASH-05, list |
| `user_roles` | Role verification | AUTH-02 |

The `venue_id` column on `vip_booking_requests` is a plain UUID — join to `venues.id` for display name. No FK join in PostgREST — must do a separate `.in()` query for venue names (same pattern as existing service).

## Open Questions

1. **venue_id filter (DASH-05) — query approach**
   - What we know: Existing service has no venue filter. Service queries all bookings then enriches with venue names separately.
   - What's unclear: Whether to filter at the `vip_booking_requests` level or post-filter in application code.
   - Recommendation: Filter at DB level (`.eq('venue_id', venueId)` on the `vip_booking_requests` query) — simpler and more performant than post-filtering.

2. **SUPABASE_SERVICE_ROLE_KEY on nlt-admin Railway**
   - What we know: Already flagged in STATE.md as a concern. User management already works in production, so the key IS set.
   - What's unclear: Whether it's set on both dev and prod Railway environments, or only prod.
   - Recommendation: Verify at the start of Wave 1 by checking Railway variables: `RAILWAY_TOKEN=$RAILWAY_TOKEN_NLT_ADMIN_PROD railway variables --json`.

3. **Crown/ticket icon for VIP nav item**
   - What we know: lucide-react ^0.462.0 is installed.
   - What's unclear: Whether `Crown` icon is available in this version.
   - Recommendation: Use `Star` or `Diamond` as fallback — both are definitely present.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | None — run via `tsx --test` |
| Quick run command | `cd /Users/alcylu/Apps/nlt-admin && npm run test:alerts` (example existing test) |
| Full suite command | `cd /Users/alcylu/Apps/nlt-admin && npm run test:regressions` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | VIP pages redirect non-admins | manual | Navigate to /vip as event_organizer user | N/A |
| AUTH-02 | API routes return 403 for non-admin | smoke | `curl -H "Authorization: Bearer <eo-token>" /api/vip/bookings` | ❌ Wave 0 |
| AUTH-03 | VIP nav item hidden for non-admins | manual | Log in as event_organizer, verify no VIP nav | N/A |
| DASH-01 | Booking list renders with status badges | manual | Visit /vip as admin | N/A |
| DASH-02 | Status filter narrows list | manual | Select "confirmed" filter, verify results | N/A |
| DASH-03 | Date range filter narrows list | manual | Set date range filter, verify results | N/A |
| DASH-04 | Name/email/phone search works | manual | Search for customer name, verify results | N/A |
| DASH-05 | Venue filter narrows list | manual | Select venue from dropdown, verify results | N/A |
| DASH-06 | Agent task badge on list rows | manual | Verify task status badges visible on rows | N/A |
| DASH-07 | Empty state shows clear-filters CTA | manual | Set filters with no matches, verify empty state | N/A |
| DASH-08 | List auto-refreshes every 60s | manual | Wait 60s, verify new data (no page reload) | N/A |
| DETAIL-01 | Full booking info on detail page | manual | Click row, verify all fields shown | N/A |
| DETAIL-02 | Status history timeline | manual | Verify timeline shows actor, timestamp, notes | N/A |
| DETAIL-03 | Edit audit log | manual | Verify before/after values in audit log | N/A |
| DETAIL-04 | Agent task on detail page | manual | Verify task status visible on detail page | N/A |

### Sampling Rate
- **Per task commit:** `cd /Users/alcylu/Apps/nlt-admin && npm run build` (catches TypeScript errors)
- **Per wave merge:** Manual smoke test — auth check + list + detail as admin user
- **Phase gate:** Full manual walkthrough against all 5 success criteria before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/types/vip.ts` — VIP type definitions (AUTH-02 test depends on correct types)
- [ ] Smoke test script for API auth (manual curl instructions suffice given project test patterns)

*Note: nlt-admin uses Node.js built-in test runner for unit tests, but the VIP dashboard phase is UI-heavy with no pure-logic functions that warrant unit tests. Validation is primarily manual browser testing.*

## Sources

### Primary (HIGH confidence)
- Verified: `/Users/alcylu/Apps/nlt-admin/src/app/api/admin/users/route.ts` — role check pattern
- Verified: `/Users/alcylu/Apps/nlt-admin/src/hooks/useOpsHealth.ts` — refetchInterval pattern
- Verified: `/Users/alcylu/Apps/nlt-admin/src/components/auth/ProtectedRoute.tsx` — current auth guard
- Verified: `/Users/alcylu/Apps/nlt-admin/src/components/layout/AdminNavConfig.ts` — adminOnly nav pattern
- Verified: `/Users/alcylu/Apps/nlt-admin/src/components/layout/AdminShell.tsx` — nav filtering logic
- Verified: `/Users/alcylu/Apps/nlt-admin/src/lib/supabase/server.ts` — server client factory
- Verified: `/Users/alcylu/Apps/nlt-admin/src/lib/supabase/service-client.ts` — service role client
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/services/vipAdmin.ts` — complete service logic to port
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/types.ts` — all VIP type definitions
- Verified: `/Users/alcylu/Apps/nlt-admin/CLAUDE.md` — project conventions, UX requirements
- Verified: `/Users/alcylu/Apps/nlt-admin/package.json` — installed dependencies and versions

### Secondary (MEDIUM confidence)
- nlt-admin pattern: pages under `(admin)/` use `'use client'` even though they delegate to view components — consistent throughout codebase

### Tertiary (LOW confidence)
- Crown icon availability in lucide-react 0.462 — not verified against icon list

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies verified in package.json
- Architecture: HIGH — patterns verified in existing codebase files
- Pitfalls: HIGH — most identified from reading actual code (ProtectedRoute scope, missing venue filter, service role key requirement)
- Validation: MEDIUM — test patterns verified but VIP-specific test files don't exist yet

**Research date:** 2026-03-11
**Valid until:** 2026-04-10 (stable Next.js + Supabase versions; TanStack Query API stable)
