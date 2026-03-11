# Phase 7: Create Booking Mutation - Research

**Researched:** 2026-03-11
**Domain:** Next.js 15 App Router (nlt-admin) — VIP booking creation form, API route mutation, TanStack Query useMutation
**Confidence:** HIGH

## Summary

Phase 7 adds a single mutation to nlt-admin: an admin-initiated VIP booking creation form. The underlying service logic already exists in nightlife-mcp's `createVipBookingRequest()` and is already wired to `createVipAdminBooking()` in `vipAdmin.ts`. Phase 7 is a port of that creation path into nlt-admin's architecture: a new POST API route, a `useMutation` hook, and a dialog-based form UI.

Two requirements (MUTATE-06, MUTATE-07) add admin-only fields that the base customer-facing create flow does NOT include: `agent_internal_note` (internal ops note, never customer-visible) and `change_note` (reason for the booking being created, captured in the audit trail). The service layer in nightlife-mcp's `createVipBookingRequest` already accepts `agent_internal_note` on the `CreateVipBookingRequestInput` type (optional field, applied via `normalizePatch` in a follow-up update after insert). The `change_note` field must be handled via a separate mechanism — it is currently only used by `updateVipAdminBooking()` via the `admin_update_vip_booking_request` RPC's `p_note` parameter. For the create flow, `change_note` is a creation context note that should be stored in `vip_booking_status_events` as the `note` on the initial "submitted" event.

**Primary recommendation:** Add a POST `/api/vip/bookings` route to nlt-admin that calls a new `createVipAdminBooking()` function in `vipAdminService.ts`. The function calls the existing `createVipBookingRequest` logic (ported from nightlife-mcp) plus a follow-up `UPDATE` for `agent_internal_note` and updates the initial status event `note` field with the `change_note`. Expose via a Dialog form on the booking list page, using `useMutation` + `queryClient.invalidateQueries`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MUTATE-04 | Admin can create a booking on behalf of a customer with venue selector | `createVipBookingRequest` in nightlife-mcp is the reference implementation; port to nlt-admin service + POST API route |
| MUTATE-06 | Admin can write internal notes (not customer-visible) on booking | `agent_internal_note` field accepted by `CreateVipBookingRequestInput` (nightlife-mcp line 54) — must be passed through nlt-admin form → API route → service function |
| MUTATE-07 | Admin can add a change note explaining edits | `change_note` field used by audit trail; for create flow, pass as the `note` on the initial `vip_booking_status_events` insert |
</phase_requirements>

## Standard Stack

### Core (nlt-admin — already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.5.12 | App Router + API routes | Project framework |
| React | 19.1.0 | UI components | Project framework |
| TypeScript | ^5.5.3 | Type safety | Project standard |
| @tanstack/react-query | ^5.56.2 | useMutation + cache invalidation | Already used for VIP reads in Phase 6 |
| react-hook-form | ^7.53.0 | Form state management | Already used in CollectiveFormDialog, AdminAuth, etc. |
| @hookform/resolvers | ^3.9.0 | Zod integration with react-hook-form | Already installed |
| zod | ^3.23.8 | Form validation schema | Already used project-wide |
| @supabase/ssr | ^0.8.0 | Cookie-based auth in API routes | Required for server-side role check |
| @supabase/supabase-js | ^2.50.0 | Service role client for data writes | Already used in VIP API routes |
| sonner | ^1.5.0 | Toast notifications for success/error | Already wired in Providers.tsx |
| date-fns | (already in package.json) | Date formatting in form | Already used in Phase 6 VIP components |

### shadcn UI Components (already installed)
| Component | Purpose |
|-----------|---------|
| `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` | Create booking modal (`/components/ui/dialog.tsx` — verified) |
| `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` | Form field wrappers with validation (`/components/ui/form.tsx` — verified) |
| `Input` | Text fields (customer name, email, phone, table code) |
| `Textarea` | Multi-line fields (special requests, internal note) |
| `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` | Venue selector dropdown |
| `Button` | Submit and Cancel actions |

**Installation:** Nothing to install — all dependencies already exist in nlt-admin.

## Architecture Patterns

### Recommended Project Structure (additions to Phase 6)
```
src/
├── app/
│   └── api/
│       └── vip/
│           └── bookings/
│               └── route.ts            # ADD: POST handler alongside existing GET
├── services/
│   └── vipAdminService.ts              # ADD: createVipAdminBooking() function
├── hooks/
│   └── useVipBookings.ts               # ADD: useCreateVipBooking() mutation hook
├── types/
│   └── vip.ts                          # ADD: CreateVipAdminBookingInput, VipBookingCreateResult types
└── components/
    └── vip/
        ├── VipBookingList.tsx           # MODIFY: add "New Booking" button that opens dialog
        └── VipCreateBookingDialog.tsx   # NEW: create booking form dialog
```

### Pattern 1: POST API Route for Mutation

The existing GET route at `/api/vip/bookings/route.ts` can be extended with a POST handler in the same file. This is standard Next.js App Router convention: multiple HTTP methods in one route file.

**What:** POST `/api/vip/bookings` authenticates the caller, validates the JSON body, calls `createVipAdminBooking()`, returns 201 with the result.
**When to use:** The single entry point for admin-created bookings from nlt-admin.
**Example:**
```typescript
// src/app/api/vip/bookings/route.ts — ADD alongside existing GET
export async function POST(request: Request) {
  try {
    // 1. Auth (same pattern as GET)
    const supabase = await createSupabaseServerClient();
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Role check (same pattern as GET)
    const { data: callerRoles } = await supabase
      .from('user_roles').select('role').eq('user_id', caller.id);
    const isAdmin = callerRoles?.some(r => r.role === 'super_admin' || r.role === 'admin');
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 });
    }

    // 3. Parse + validate body with Zod
    const body = await request.json();
    const parsed = createVipAdminBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }

    // 4. Derive editor_username from Supabase user
    const editorUsername = caller.email ?? caller.id.slice(0, 8);

    // 5. Call service with service role client
    const serviceClient = createServiceRoleClient();
    const result = await createVipAdminBooking(serviceClient, {
      ...parsed.data,
      editor_username: editorUsername,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Unexpected error in POST /api/vip/bookings:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```
Source: Pattern from existing GET handler at `/api/vip/bookings/route.ts` (verified).

### Pattern 2: useMutation Hook with Cache Invalidation

TanStack Query's `useMutation` is already used throughout nlt-admin (e.g., `useBillingProfile.ts`, `useBillTos.ts`, `VenueOrganizerManagement.tsx`). The VIP mutation follows the same pattern.

**What:** Client-side hook that POSTs to `/api/vip/bookings`, invalidates the `['vip-bookings']` query cache on success.
**When to use:** `VipCreateBookingDialog` triggers this hook on form submit.
**Example:**
```typescript
// src/hooks/useVipBookings.ts — ADD alongside existing useVipBookingList and useVipVenues
export function useCreateVipBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateVipAdminBookingInput): Promise<VipBookingCreateResult> => {
      const response = await fetch('/api/vip/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vip-bookings'] });
      toast.success('Booking created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create booking: ${error.message}`);
    },
  });
}
```
Source: Pattern from `useBillingProfile.ts` `useCreateBillingProfile()` (verified in codebase).

### Pattern 3: Dialog Form with react-hook-form + Zod

`CollectiveFormDialog.tsx` is the canonical example in nlt-admin: a Dialog containing a Form from react-hook-form with zodResolver. All VIP form validation should follow this pattern.

**What:** A controlled Dialog component that renders a multi-field form.
**When to use:** "New Booking" button on the VIP list page opens this dialog.
**Example:**
```typescript
// src/components/vip/VipCreateBookingDialog.tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useCreateVipBooking } from '@/hooks/useVipBookings';
import { useVipVenues } from '@/hooks/useVipBookings';

const createBookingSchema = z.object({
  venue_id: z.string().uuid('Select a venue'),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
  arrival_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:MM format'),
  party_size: z.number().int().min(1).max(30),
  customer_name: z.string().min(1),
  customer_email: z.string().email(),
  customer_phone: z.string().min(1),
  preferred_table_code: z.string().optional(),
  special_requests: z.string().optional(),
  agent_internal_note: z.string().optional(),  // MUTATE-06
  change_note: z.string().optional(),          // MUTATE-07
});
```
Source: `CollectiveFormDialog.tsx` pattern (verified in codebase); Zod regex patterns from nightlife-mcp validation (verified).

### Pattern 4: editor_username Derivation

For audit trail entries, nlt-admin needs to pass an `editor_username`. The `useAdminAuth()` hook exposes `user.email` (string | undefined). The API route has access to `caller.email` from Supabase's auth.getUser(). Use `caller.email ?? caller.id.slice(0, 8)` as a safe fallback.

**What:** API route derives `editor_username` from the authenticated Supabase user.
**When to use:** Every mutation that goes through `createVipAdminBooking()`.
Source: `useAdminAuth.ts` (verified — exposes `user.email`); `dashboardAuth.ts` from nightlife-mcp (uses `req.dashboardAdminUsername`).

### Pattern 5: createVipAdminBooking Service Function

The nightlife-mcp `vipAdmin.ts` `createVipAdminBooking()` delegates to `createVipBookingRequest()`. The nlt-admin service needs its own implementation that:
1. Calls `createVipBookingRequest` logic (port from nightlife-mcp — already done for the MCP tool flow)
2. After insert, if `agent_internal_note` is provided, update the booking row
3. If `change_note` is provided, update the initial status event's `note` field, OR insert it as a separate audit entry

**Recommended approach for `change_note`:** The `change_note` on the create flow captures "why was this created by ops." Since `createVipBookingRequest` inserts a `vip_booking_status_events` row with `actor_type: "customer"` and a hardcoded note, the cleanest approach for admin-created bookings is to use `actor_type: "ops"` and pass the `change_note` as the event note. This requires a small extension to the create logic. Alternatively, update the status event note after insert.

**Simplest implementation:** Add a new `createVipAdminBooking()` to `vipAdminService.ts` that:
1. Inserts into `vip_booking_requests` (same fields as MCP flow)
2. Inserts into `vip_booking_status_events` with `actor_type: "ops"` and `note: change_note ?? "Booking created by ops."`
3. Inserts into `vip_agent_tasks`
4. If `agent_internal_note`, immediately updates the booking row
5. Handles min_spend lookup from `vip_table_day_defaults` using the same pricing fallback

**Important:** The booking date validation (`resolveBookingWindow`) in `createVipBookingRequest` restricts dates to the service window (current service date + X days). Admin-created bookings should skip this window check or use a relaxed validation, since ops creates bookings for any future date.

### Anti-Patterns to Avoid
- **Calling nightlife-mcp's API from nlt-admin:** Never add an HTTP call from nlt-admin back to nightlife-mcp's Express server. All VIP data access is Supabase-direct.
- **Client-side Supabase write for bookings:** Never write to `vip_booking_requests` from browser. Always route through `/api/vip/bookings` POST.
- **Sending customer confirmation email on admin-created bookings:** `createVipBookingRequest` has optional `resendApiKey` — do NOT pass it for admin-created bookings. Ops controls when to notify the customer.
- **Using `booking_date` window validation:** The `resolveBookingWindow` check in `createVipBookingRequest` (current service date to maxServiceDate) is designed for customer-submitted bookings. Admin-created bookings can be for any future date — skip or override this check in the admin service function.
- **Mutating bookings list query key granularly:** Use broad `queryClient.invalidateQueries({ queryKey: ['vip-bookings'] })` to bust all pages/filters — simpler and correct.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form validation | Custom validation logic | `zod` + `zodResolver` | Already established pattern in nlt-admin; handles all edge cases |
| Modal/dialog UI | Custom overlay component | `Dialog` from `@/components/ui/dialog` | Already in shadcn library; handles focus trap, escape key, scroll lock |
| Form state | `useState` per field | `useForm` from `react-hook-form` | Handles dirty state, touched state, validation triggers, reset |
| Toast on success/error | Custom alert UI | `toast` from `sonner` | Already wired in Providers.tsx |
| Pricing lookup | Custom table lookup query | Port `lookupTablePricing()` from nightlife-mcp or call via direct Supabase query | Complex 4-level fallback — don't rewrite |
| Venue list | Re-fetch inline | `useVipVenues()` hook | Already exists from Phase 6; 5-minute stale time |

**Key insight:** The create flow for admin bookings is largely the same as the customer-facing MCP flow. The admin-specific additions are: actor_type "ops" on the status event, `agent_internal_note` on the booking row, and `change_note` as the status event note.

## Common Pitfalls

### Pitfall 1: Booking Date Window Validation Rejects Admin Dates
**What goes wrong:** `createVipBookingRequest` calls `resolveBookingWindow()` which restricts `booking_date` to a service-day window. Admin bookings for dates outside that window throw `INVALID_BOOKING_REQUEST`.
**Why it happens:** The window check is designed for customer-submitted bookings (restrict to foreseeable future), not admin operations.
**How to avoid:** The new `createVipAdminBooking()` in nlt-admin's `vipAdminService.ts` should skip the `resolveBookingWindow` check, or implement its own permissive validation (must be a valid ISO date, must be in the future or today). Validate format only, not against a service window.
**Warning signs:** Submitting a booking for 3 months out returns 400.

### Pitfall 2: agent_internal_note Not on CreateVipBookingRequestInput (Customer MCP Path)
**What goes wrong:** Developer reads `CreateVipBookingRequestInput` type and doesn't see `agent_internal_note`. Assumes it can't be set on create. Leaves it for a follow-up PATCH.
**Why it happens:** The original `CreateVipBookingRequestInput` type (the customer-facing path for the MCP tool) does NOT include `agent_internal_note`. But the admin-extended input type does (verified at line 54 of vipBookings.ts).
**How to avoid:** Define a new `CreateVipAdminBookingInput` type in nlt-admin's `vip.ts` that extends the base fields with `agent_internal_note?: string` and `change_note?: string`. The service function handles both fields internally.
**Warning signs:** Internal note field in the form has no effect on the saved booking.

### Pitfall 3: change_note Has No Direct Column
**What goes wrong:** Developer looks for a `change_note` column on `vip_booking_requests` and doesn't find one. Tries to add it to the insert.
**Why it happens:** `change_note` is an audit/history concept, not a booking field. It lives in `vip_booking_edit_audits` (for updates via RPC) and in `vip_booking_status_events.note` (for creation context).
**How to avoid:** Store `change_note` as the `note` field on the initial `vip_booking_status_events` INSERT. Use `actor_type: "ops"` to distinguish admin-created bookings from customer-submitted ones.
**Warning signs:** `change_note` submitted via form but never shows up in Status History timeline.

### Pitfall 4: Sending Confirmation Email on Admin-Created Bookings
**What goes wrong:** Developer passes `RESEND_API_KEY` to the create service function. Customer receives a "Booking Submitted" email for a booking that ops just created internally on their behalf.
**Why it happens:** The `createVipBookingRequest` has optional `resendApiKey` — if set, sends a confirmation email.
**How to avoid:** Do NOT pass `resendApiKey` to the create service function in nlt-admin. Ops controls when to notify the customer (this is Phase 8 — status-change emails).
**Warning signs:** Customer receives automated email immediately after ops creates the booking.

### Pitfall 5: Form Reset After Successful Submit
**What goes wrong:** Dialog closes but form retains previous values on next open.
**Why it happens:** `react-hook-form`'s `useForm` state persists unless explicitly reset.
**How to avoid:** Call `form.reset()` inside `useMutation`'s `onSuccess` callback (or inside the Dialog's `onOpenChange` handler when `open` goes false).
**Warning signs:** Opening the dialog a second time shows the previous customer's details.

### Pitfall 6: Venue Selector Has Stale Data
**What goes wrong:** Venue list shows outdated data or doesn't include a newly VIP-enabled venue.
**Why it happens:** `useVipVenues()` has a 5-minute `staleTime`. After adding a venue, the dropdown won't update for up to 5 minutes.
**How to avoid:** This is acceptable for an admin tool — ops can close and reopen the dialog to refresh. Document in the form's help text if needed. Do not reduce staleTime.
**Warning signs:** Not actually a bug — expected behavior.

### Pitfall 7: party_size as String from Input[type=number]
**What goes wrong:** HTML `<input type="number">` returns a string in form values. Zod validation with `z.number()` fails.
**Why it happens:** react-hook-form registers values as strings by default for DOM inputs.
**How to avoid:** Use `z.coerce.number().int().min(1).max(30)` in the Zod schema for `party_size`. This coerces the string "4" to number 4.
**Warning signs:** Zod validation error on party_size even when value appears valid.

## Code Examples

Verified patterns from existing nlt-admin codebase:

### useMutation Pattern (from useBillingProfile.ts)
```typescript
// Source: /Users/alcylu/Apps/nlt-admin/src/hooks/useBillingProfile.ts (verified)
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function useCreateBillingProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data) => { /* fetch POST */ },
    onSuccess: () => {
      toast.success('...');
      queryClient.invalidateQueries({ queryKey: ['billing-profile'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed: ${error.message}`);
    }
  });
}
```

### react-hook-form + zodResolver + Dialog (from CollectiveFormDialog.tsx)
```typescript
// Source: /Users/alcylu/Apps/nlt-admin/src/components/collective/CollectiveFormDialog.tsx (verified)
const form = useForm<FormValues>({
  resolver: zodResolver(schema),
  defaultValues: { ... },
});

async function onSubmit(values: FormValues) {
  await mutation.mutateAsync(values);
  onOpenChange(false);
}
```

### Zod coerce for number inputs
```typescript
// Pattern: coerce string from input[type=number] to number
party_size: z.coerce.number().int().min(1, 'Min 1').max(30, 'Max 30'),
```

### Role Check + editor_username from Supabase User (from existing VIP API routes)
```typescript
// Source: /Users/alcylu/Apps/nlt-admin/src/app/api/vip/bookings/route.ts (verified)
const { data: { user: caller } } = await supabase.auth.getUser();
const editorUsername = caller.email ?? caller.id.slice(0, 8);
```

### Status Event Row Shape for Admin-Created Booking
```typescript
// Source: nightlife-mcp src/services/vipBookings.ts createVipBookingRequest() (verified)
// Adapted for admin creation: actor_type "ops" instead of "customer"
await serviceClient
  .from('vip_booking_status_events')
  .insert({
    booking_request_id: created.id,
    from_status: null,
    to_status: 'submitted',
    actor_type: 'ops',              // admin-created, not customer self-serve
    note: changeNote ?? 'Booking created by ops on behalf of customer.',
  });
```

### Cache Invalidation After Mutation
```typescript
// After successful create, invalidate the list query so it refreshes
queryClient.invalidateQueries({ queryKey: ['vip-bookings'] });
// Do NOT invalidate individual booking queries — new booking has no cache entry yet
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express form-based create (nightlife-mcp vipDashboardPage.ts) | React Dialog + react-hook-form + useMutation (nlt-admin) | v2.0 migration | Proper client-side validation, optimistic UX, TypeScript types |
| actor_type: "customer" for all creates | actor_type: "ops" for admin-initiated creates | Phase 7 | Distinguishes channel in status history timeline |
| booking_date window restricted to service window | Admin creates skip window check | Phase 7 | Ops can create bookings for any future date |

**Deprecated/outdated:**
- Express dashboard create booking at `/api/v1/admin/vip-bookings` POST (nightlife-mcp): still functional but to be removed in Phase 9.

## Open Questions

1. **Should admin-created bookings trigger the agent task (vip_agent_tasks insert)?**
   - What we know: `createVipBookingRequest` always inserts a `vip_agent_tasks` row with `status: "pending"`. This triggers alerting.
   - What's unclear: Should an ops-created booking alert the Ember agent? If ops created it, they already know about it.
   - Recommendation: Skip the agent task insert for admin-created bookings. Ops can manually trigger agent tasks if needed. This avoids spurious agent notifications for bookings ops already owns.

2. **Dialog placement: booking list header or floating action button?**
   - What we know: Express dashboard puts "Submit New" as a button in the panel header. VipBookingList currently has no action button.
   - What's unclear: Best placement for the CTA in the nlt-admin list page.
   - Recommendation: Add a "New Booking" Button in the VipBookingList header area, aligned right, above the table. Opens VipCreateBookingDialog. No modal within a modal risk since the list has no existing dialogs.

3. **Pricing lookup (min_spend) in admin create flow?**
   - What we know: `createVipBookingRequest` runs `lookupTablePricing()` if `preferred_table_code` is provided. This queries `vip_table_day_defaults` and `vip_table_availability`.
   - What's unclear: Whether to port the full `lookupTablePricing` function to nlt-admin or simplify.
   - Recommendation: Port the pricing lookup. The tables are already in Supabase and the service role client has access. Show a `table_warning` toast if the table code is not found, exactly as the Express dashboard did.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) + manual browser testing |
| Config file | None — run via `tsx --test` |
| Quick run command | `cd /Users/alcylu/Apps/nlt-admin && npm run build` |
| Full suite command | Manual browser walkthrough per success criteria |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MUTATE-04 | Admin can submit create form with all required fields | manual | Navigate to /vip, click "New Booking", fill form, submit | N/A |
| MUTATE-04 | Submitted booking appears in list with "submitted" status | manual | After submit, verify row appears in list | N/A |
| MUTATE-04 | POST /api/vip/bookings returns 401 for unauthenticated | smoke | `curl -X POST /api/vip/bookings -d '{}'` → expect 401 | ❌ Wave 0 |
| MUTATE-04 | POST /api/vip/bookings returns 403 for non-admin | smoke | `curl -X POST ... -H "auth: <eo-token>"` → expect 403 | ❌ Wave 0 |
| MUTATE-06 | Internal note field saves to agent_internal_note column | manual | Fill internal note, submit, verify it shows in booking detail | N/A |
| MUTATE-07 | Change note appears in Status History timeline | manual | Fill change note, submit, verify it shows in status history | N/A |

### Sampling Rate
- **Per task commit:** `cd /Users/alcylu/Apps/nlt-admin && npm run build` (catches TypeScript errors)
- **Per wave merge:** Manual smoke test — create booking form submit + verify list shows new booking
- **Phase gate:** All 3 success criteria verified in browser before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Add `CreateVipAdminBookingInput` and `VipBookingCreateResult` types to `src/types/vip.ts`
- [ ] Smoke test script for POST auth (manual curl instructions)

*Note: Phase 7 is mutation-only with no pure-logic functions suitable for unit testing. Validation is primarily manual browser testing + TypeScript build check.*

## Sources

### Primary (HIGH confidence)
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/services/vipAdmin.ts` — `createVipAdminBooking()`, `updateVipAdminBooking()`, audit pattern
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/services/vipBookings.ts` — `createVipBookingRequest()` full implementation
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/admin/vipDashboardPage.ts` — Express create form fields (reference for form UX)
- Verified: `/Users/alcylu/Apps/nlt-admin/src/app/api/vip/bookings/route.ts` — existing GET handler pattern to extend with POST
- Verified: `/Users/alcylu/Apps/nlt-admin/src/hooks/useVipBookings.ts` — existing hook to extend with `useCreateVipBooking`
- Verified: `/Users/alcylu/Apps/nlt-admin/src/hooks/useBillingProfile.ts` — `useMutation` + `useQueryClient` + toast pattern
- Verified: `/Users/alcylu/Apps/nlt-admin/src/components/collective/CollectiveFormDialog.tsx` — react-hook-form + zodResolver + Dialog pattern
- Verified: `/Users/alcylu/Apps/nlt-admin/src/hooks/useAdminAuth.ts` — `user.email` available for editor_username
- Verified: `/Users/alcylu/Apps/nlt-admin/src/types/vip.ts` — existing VIP types; new types to add here
- Verified: `/Users/alcylu/Apps/nlt-admin/src/components/ui/dialog.tsx` — Dialog component available
- Verified: `/Users/alcylu/Apps/nlt-admin/src/components/ui/form.tsx` — Form + FormField components available
- Verified: `/Users/alcylu/Apps/nlt-admin/package.json` — react-hook-form 7.53, @hookform/resolvers 3.9, zod 3.23 all installed

### Secondary (MEDIUM confidence)
- nightlife-mcp `CreateVipBookingRequestInput` line 54: `agent_internal_note?: string` — field exists on input type but not used in the base create flow; admin service handles it post-insert

### Tertiary (LOW confidence)
- Whether `vip_agent_tasks` insert should be skipped for admin-created bookings — not verified against business requirements; flagged as open question

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies verified in package.json
- Architecture: HIGH — POST route pattern, useMutation pattern, Dialog+form pattern all verified in existing codebase
- Pitfalls: HIGH — most identified from reading actual nightlife-mcp create flow code and nlt-admin patterns
- Validation: MEDIUM — test patterns verified but VIP mutation-specific test files don't exist yet

**Research date:** 2026-03-11
**Valid until:** 2026-04-10 (stable Next.js + Supabase versions; TanStack Query API stable)
