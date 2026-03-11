# Phase 8: Status Update with Stripe and Resend - Research

**Researched:** 2026-03-11
**Domain:** nlt-admin Next.js 15 — PATCH API route, Stripe Checkout Session creation, Resend email dispatch, status update UI on booking detail page
**Confidence:** HIGH

## Summary

Phase 8 is the most complex mutation in the VIP dashboard. It wires together four concerns that must be choreographed correctly: (1) the `admin_update_vip_booking_request` Supabase RPC, (2) Stripe checkout session creation on `deposit_required` transitions, (3) Resend email dispatch on `deposit_required`, `confirmed`, and `rejected` transitions, and (4) a React UI (status update panel + dialog on the booking detail page) that exposes all pipeline transitions to the admin.

The full server-side implementation for all four concerns already exists in nightlife-mcp's `updateVipAdminBooking()` (verified at `/Users/alcylu/Apps/nightlife-mcp/src/services/vipAdmin.ts`). The `admin_update_vip_booking_request` RPC is `SECURITY DEFINER` (confirmed in the latest migration at `20260306_add_deposit_required_status.sql`). The Stripe Checkout Session pattern, `createDepositForBooking()`, and all three email functions are battle-tested in nightlife-mcp's `deposits.ts` and `email.ts`. Phase 8 ports these to nlt-admin.

The critical new concern for nlt-admin: Stripe (`stripe@^20.4.0`) and Resend (`resend@^4.8.0`) are NOT installed in nlt-admin yet. These must be added. Railway env vars `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, and `NIGHTLIFE_CONSUMER_URL` (for Stripe success/cancel redirect URLs) must be set before any deployment. Both side effects are explicitly non-blocking per the success criteria — a Stripe or Resend failure must never block the status update.

The `status_message` field from the RPC becomes the customer-visible message included in `bookingRejectedContent` (as `reason`) and in `bookingConfirmedContent`. The admin sets it in the status update form alongside the new status selection. For `deposit_required`, the status_message is implicitly set to a standard "deposit required" text because the checkout URL is what matters to the customer (not the status_message).

**Primary recommendation:** Add a PATCH `/api/vip/bookings/[id]` route to nlt-admin that ports `updateVipAdminBooking()` from nightlife-mcp. Add a `VipUpdateStatusDialog` (accessible from the booking detail page header) that presents valid next-state transitions, a required status_message field, and an optional change_note. Install Stripe and Resend in nlt-admin. Keep side effects non-blocking with `try/catch`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MUTATE-01 | Admin can update booking status through full pipeline (submitted → in_review → deposit_required → confirmed/rejected/cancelled) | `admin_update_vip_booking_request` RPC is SECURITY DEFINER and handles all pipeline transitions; nlt-admin needs a PATCH route + `updateVipAdminBooking()` service function |
| MUTATE-02 | Status change to deposit_required automatically creates Stripe checkout session | `createDepositForBooking()` in nightlife-mcp deposits.ts is the reference; must be ported to nlt-admin with `stripe` npm package; non-blocking |
| MUTATE-03 | Status changes to deposit_required/confirmed/rejected automatically send email via Resend | `sendDepositRequiredEmail`, `sendBookingConfirmedEmail`, `sendBookingRejectedEmail` in nightlife-mcp email.ts are references; must be ported with `resend` npm package; non-blocking |
| MUTATE-05 | Admin can set customer-visible status message on status update | `status_message` field in the RPC patch; required in the status update form; surfaced in email templates as `statusMessage` / `reason` |
</phase_requirements>

## Standard Stack

### Core (nlt-admin — already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.5.12 | App Router + API routes | Project framework |
| React | 19.1.0 | UI components | Project framework |
| TypeScript | ^5.5.3 | Type safety | Project standard |
| @tanstack/react-query | ^5.56.2 | useMutation + cache invalidation | Already used for VIP mutations in Phase 7 |
| react-hook-form | ^7.53.0 | Form state management | Already used in VipCreateBookingDialog |
| @hookform/resolvers | ^3.9.0 | Zod integration | Already installed |
| zod | ^3.23.8 | Form validation | Already used project-wide |
| @supabase/ssr | ^0.8.0 | Cookie-based auth in API routes | Already used |
| @supabase/supabase-js | ^2.50.0 | Service role client for Supabase RPC | Already used |
| sonner | ^1.5.0 | Toast notifications | Already wired in Providers.tsx |

### NEW — Must Install
| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| stripe | ^20.4.0 | Create Stripe Checkout Session for deposit | Same version as nightlife-mcp (verified in nightlife-mcp package.json) |
| resend | ^4.8.0 | Send transactional emails (deposit required, confirmed, rejected) | Same version as nightlife-mcp (verified in nightlife-mcp package.json) |

**Installation:**
```bash
cd /Users/alcylu/Apps/nlt-admin && npm install stripe@^20.4.0 resend@^4.8.0
```

### New Environment Variables Required
| Variable | Where | Value Source |
|----------|-------|-------------|
| `STRIPE_SECRET_KEY` | nlt-admin Railway env | Stripe dashboard (same key used by nightlife-mcp) |
| `RESEND_API_KEY` | nlt-admin Railway env | Resend dashboard (same key used by nightlife-mcp) |
| `NIGHTLIFE_CONSUMER_URL` | nlt-admin Railway env | `https://nightlifetokyo.com` (for Stripe success/cancel redirect URLs) |

Note from STATE.md blocker: "nlt-admin Railway service needs STRIPE_SECRET_KEY, RESEND_API_KEY, NIGHTLIFE_CONSUMER_URL added before any code touches Stripe/Resend."

### shadcn UI Components (already installed)
| Component | Purpose |
|-----------|---------|
| `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` | Status update modal |
| `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` | Form fields |
| `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` | Status dropdown |
| `Textarea` | Status message + change note fields |
| `Button` | Submit, Cancel actions |
| `Badge` | Deposit link display on detail page |

## Architecture Patterns

### Recommended Project Structure (additions to Phase 7)
```
nlt-admin/src/
├── app/
│   └── api/
│       └── vip/
│           └── bookings/
│               └── [id]/
│                   └── route.ts          # ADD: PATCH handler alongside existing GET
├── services/
│   ├── vipAdminService.ts               # ADD: updateVipAdminBooking()
│   ├── vipDeposits.ts                   # NEW: createDepositForBooking() ported from nightlife-mcp
│   └── vipEmail.ts                      # NEW: sendDepositRequiredEmail, sendBookingConfirmedEmail, sendBookingRejectedEmail
├── lib/
│   └── stripe.ts                        # NEW: getStripe() singleton + createDepositCheckoutSession()
│   └── resend.ts                        # NEW: getResend() singleton + sendVipEmail()
├── hooks/
│   └── useVipBookingDetail.ts           # MODIFY: export useUpdateVipBookingStatus() mutation hook
├── types/
│   └── vip.ts                           # ADD: UpdateVipAdminBookingInput, VipAdminBookingUpdateResult types
└── components/
    └── vip/
        ├── VipBookingDetail.tsx          # MODIFY: add "Update Status" button + refetch after mutation
        └── VipUpdateStatusDialog.tsx     # NEW: status update form dialog
```

### Pattern 1: PATCH Route for Status Update

The existing GET route at `/api/vip/bookings/[id]/route.ts` exports only GET. Add a PATCH handler in the same file.

**What:** PATCH `/api/vip/bookings/[id]` validates the body with Zod, calls `updateVipAdminBooking()`, returns 200 with updated booking summary.
**When to use:** Admin submits the status update dialog.

```typescript
// Source: Pattern from existing GET handler at /api/vip/bookings/[id]/route.ts (verified)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: callerRoles } = await supabase
      .from('user_roles').select('role').eq('user_id', caller.id);
    const isAdmin = callerRoles?.some(r => r.role === 'super_admin' || r.role === 'admin');
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = updateVipBookingStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 },
      );
    }

    const editorUsername = caller.email ?? caller.id.slice(0, 8);
    const serviceClient = createServiceRoleClient();
    const result = await updateVipAdminBooking(serviceClient, {
      booking_request_id: id,
      editor_username: editorUsername,
      patch: {
        status: parsed.data.status,
        status_message: parsed.data.status_message,
      },
      note: parsed.data.change_note,
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      nightlifeBaseUrl: process.env.NIGHTLIFE_CONSUMER_URL ?? 'https://nightlifetokyo.com',
      resendApiKey: process.env.RESEND_API_KEY,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Unexpected error in PATCH /api/vip/bookings/[id]:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

### Pattern 2: updateVipAdminBooking Service Function

Port the `updateVipAdminBooking()` from nightlife-mcp's `vipAdmin.ts` to nlt-admin's `vipAdminService.ts`. Key differences from nightlife-mcp version:

- Throws plain `Error` (not `NightlifeError`) — consistent with nlt-admin convention established in Phase 6
- Calls `admin_update_vip_booking_request` Supabase RPC (same)
- Calls `createDepositForBooking()` from `vipDeposits.ts` (ported, not imported from nightlife-mcp)
- Calls email functions from `vipEmail.ts` (ported)
- Side effects wrapped in `try/catch` — failures are non-blocking

```typescript
// From nightlife-mcp vipAdmin.ts updateVipAdminBooking() (verified — lines 675-763)
// Adapted for nlt-admin: plain Error, separate import for email/deposit helpers

export async function updateVipAdminBooking(
  supabase: SupabaseClient,
  input: UpdateVipAdminBookingServiceInput,
): Promise<VipAdminBookingUpdateResult> {
  const bookingRequestId = ensureUuid(input.booking_request_id, 'booking_request_id');
  const editorUsername = normalizeActor(input.editor_username);
  const patch = normalizePatch(input.patch);
  const note = normalizeOptionalText(input.note ?? null, 'note', 400);

  const { data, error } = await supabase.rpc('admin_update_vip_booking_request', {
    p_booking_request_id: bookingRequestId,
    p_editor_username: editorUsername,
    p_patch: patch,
    p_note: note,
  });

  if (error) {
    const message = String(error.message || '');
    if (message.toLowerCase().includes('not found')) {
      throw new Error('VIP booking request not found.');
    }
    if (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('must') || message.toLowerCase().includes('cannot') || message.toLowerCase().includes('patch')) {
      throw new Error(message || 'Invalid booking update payload.');
    }
    throw new Error(`Failed to update VIP booking: ${message}`);
  }

  const rpcRow = Array.isArray(data) ? data[0] : undefined;
  if (!rpcRow) {
    throw new Error('Failed to update VIP booking: no data returned from RPC.');
  }

  const changedFields = Array.isArray(rpcRow.changed_fields) ? rpcRow.changed_fields : [];

  // Side effects: non-blocking
  if (changedFields.includes('status') && input.patch.status) {
    const newStatus = input.patch.status;

    if (newStatus === 'deposit_required' && input.stripeSecretKey && input.nightlifeBaseUrl) {
      try {
        await createDepositForBooking(supabase, input.stripeSecretKey, bookingRequestId, input.nightlifeBaseUrl);
      } catch { /* non-blocking */ }
    }

    if (input.resendApiKey) {
      try {
        if (newStatus === 'deposit_required') {
          const deposit = await getDepositForBooking(supabase, bookingRequestId);
          if (deposit?.stripe_checkout_url && deposit.checkout_expires_at) {
            await sendDepositRequiredEmail(supabase, input.resendApiKey, bookingRequestId, deposit.amount_jpy, deposit.stripe_checkout_url, deposit.checkout_expires_at);
          }
        } else if (newStatus === 'confirmed') {
          await sendBookingConfirmedEmail(supabase, input.resendApiKey, bookingRequestId, false);
        } else if (newStatus === 'rejected') {
          await sendBookingRejectedEmail(supabase, input.resendApiKey, bookingRequestId);
        }
      } catch { /* non-blocking */ }
    }
  }

  const detail = await getVipAdminBookingDetail(supabase, bookingRequestId);
  return {
    booking: detail.booking,
    changed_fields: changedFields,
    audit_id: rpcRow.audit_id,
    updated_at: rpcRow.updated_at,
  };
}
```

### Pattern 3: Stripe Helper (lib/stripe.ts)

Ported from nightlife-mcp `services/stripe.ts`. Keeps a module-level singleton to avoid creating a new Stripe instance on every request.

```typescript
// Source: nightlife-mcp src/services/stripe.ts (verified)
import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export function getStripe(secretKey: string): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(secretKey);
  }
  return stripeInstance;
}

export interface CreateCheckoutSessionInput {
  amountJpy: number;
  customerEmail: string;
  bookingRequestId: string;
  venueName: string;
  bookingDate: string;
  expiryMinutes: number;
  successUrl: string;
  cancelUrl: string;
}

export async function createDepositCheckoutSession(
  stripe: Stripe,
  input: CreateCheckoutSessionInput,
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: input.customerEmail,
    line_items: [{
      price_data: {
        currency: 'jpy',
        unit_amount: input.amountJpy,
        product_data: {
          name: `VIP Table Deposit — ${input.venueName}`,
          description: `Booking date: ${input.bookingDate}`,
        },
      },
      quantity: 1,
    }],
    metadata: { booking_request_id: input.bookingRequestId },
    expires_at: Math.floor(Date.now() / 1000) + input.expiryMinutes * 60,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
}
```

### Pattern 4: Resend Helper (lib/resend.ts)

Ported from nightlife-mcp `services/email.ts`. Keeps a module-level singleton.

```typescript
// Source: nightlife-mcp src/services/email.ts (verified)
import { Resend } from 'resend';

let resendInstance: Resend | null = null;

function getResend(apiKey: string): Resend {
  if (!resendInstance) {
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

const FROM_ADDRESS = 'Nightlife Tokyo VIP <vip@nightlifetokyo.com>';

export async function sendVipEmail(
  resendApiKey: string,
  options: { to: string; subject: string; html: string },
): Promise<void> {
  if (!resendApiKey) return;
  try {
    const resend = getResend(resendApiKey);
    await resend.emails.send({ from: FROM_ADDRESS, to: options.to, subject: options.subject, html: options.html });
  } catch { /* swallow — caller handles non-blocking */ }
}
```

### Pattern 5: VipUpdateStatusDialog

A 'use client' Dialog component that:
1. Presents a `Select` for the next valid status (constrained by current status — see transition map below)
2. Requires a `status_message` field (the customer-visible message that goes into the email)
3. Has an optional `change_note` field (internal ops note; stored as the status event `note`)
4. On submit, calls `useUpdateVipBookingStatus()` mutation hook

**Transition map** (what the UI should present as valid options based on current status):

| Current | Valid Next States |
|---------|-----------------|
| submitted | in_review, rejected, cancelled |
| in_review | deposit_required, confirmed, rejected, cancelled |
| deposit_required | confirmed, rejected, cancelled |
| confirmed | (terminal — no transitions shown, button disabled) |
| rejected | (terminal — no transitions shown, button disabled) |
| cancelled | (terminal — no transitions shown, button disabled) |

Note: The RPC enforces no explicit transition rules — it accepts any valid status value. The UI is the gatekeeper for sensible transitions. The deposit_required → confirmed transition is also handled automatically when the Stripe webhook fires (auto-confirm), but the admin can also manually confirm.

### Anti-Patterns to Avoid

- **Blocking the status update on Stripe/Resend failure:** If `createDepositForBooking()` throws, the RPC has already committed the status change. Never roll back the status update because of a Stripe failure. Use `try/catch` around all side effects.
- **Calling nightlife-mcp's REST API from nlt-admin:** All data access is Supabase-direct. The `admin_update_vip_booking_request` RPC runs in Supabase, not in nightlife-mcp.
- **Using nightlife-mcp's NightlifeError in nlt-admin:** nlt-admin uses plain `Error` objects everywhere. The API route translates to HTTP status codes.
- **Sending email before confirming the RPC succeeded:** Always check that `rpcRow` is present before dispatching side effects. Side effects happen after the RPC commit.
- **Showing all 6 statuses in the dropdown:** Only show valid transitions for the current status. Submitting `status: "submitted"` when already in that status will cause the RPC to throw "Patch does not modify any editable field".
- **Missing `status_message` on status update:** The RPC requires `status_message` to be non-blank if included in the patch. Always include it — the customer expects a visible message with any status change.
- **Singleton Stripe/Resend instances across test and production:** The module-level singleton pattern works in production but can cause test pollution. Not a concern for nlt-admin (no unit tests for these services); just be aware.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe Checkout creation | Custom payment form | `stripe.checkout.sessions.create()` (already exists in nightlife-mcp stripe.ts) | PCI compliance, hosted page, webhook completion |
| Email HTML templates | Custom HTML builder | Port `emailLayout()`, `depositRequiredContent()`, etc. from nightlife-mcp emails/templates.ts | All templates already written and battle-tested |
| RPC error parsing | String contains checks | Port the error message normalizer from nightlife-mcp vipAdmin.ts updateVipAdminBooking() | The RPC raises PostgreSQL exceptions with predictable strings |
| Status transition validation | Custom state machine | Client-side transition map + RPC server validation | The RPC is the source of truth; UI just helps the admin pick sensible transitions |
| Deposit amount calculation | Custom math | Port `createDepositForBooking()` from nightlife-mcp deposits.ts | Handles all edge cases: no config, no min_spend, below Stripe minimum |

**Key insight:** Phase 8 is a port, not a build. All business logic exists in nightlife-mcp. The task is faithful translation to nlt-admin's conventions (plain Error, no NightlifeError; separate service files; env vars from `process.env`).

## Common Pitfalls

### Pitfall 1: Stripe and Resend Not Installed
**What goes wrong:** `npm run build` fails at `import Stripe from 'stripe'` and `import { Resend } from 'resend'` — modules not found.
**Why it happens:** nlt-admin's package.json does not include stripe or resend (verified — only 3 env keys in .env.local, no stripe/resend).
**How to avoid:** Install both packages first: `npm install stripe@^20.4.0 resend@^4.8.0`. Add env var stubs to `.env.example`.
**Warning signs:** Build fails immediately with "Cannot find module 'stripe'" or "Cannot find module 'resend'".

### Pitfall 2: Railway Env Vars Not Set Before Deploy
**What goes wrong:** `STRIPE_SECRET_KEY` is undefined at runtime. `getStripe(undefined)` throws because the Stripe constructor rejects an empty key.
**Why it happens:** nlt-admin Railway service currently has only 3 env vars; Stripe/Resend keys were never added.
**How to avoid:** Both keys must be set in Railway before pushing any PATCH route code that calls them. Use optional chaining in the route: only pass `stripeSecretKey` if `process.env.STRIPE_SECRET_KEY` is set. The `createDepositForBooking` side effect is already non-blocking so a missing key just silently skips it.
**Warning signs:** 500 errors on status update in staging; Stripe error in Railway logs.

### Pitfall 3: RPC Returns "Patch Does Not Modify Any Editable Field"
**What goes wrong:** Admin selects the same status the booking is already in, submits — RPC throws and the route returns 500.
**Why it happens:** The UI dropdown shows the current status as a valid option, or the form re-submits without user changing the status.
**How to avoid:** UI transition map (see Pattern 5) should exclude the current status from the dropdown options entirely. Additionally, handle this specific RPC exception message in the service and return a 400 to the client.
**Warning signs:** Admin gets an unexpected error toast when submitting the same status.

### Pitfall 4: `deposit_required` Email Sent Before Deposit Record Exists
**What goes wrong:** Email is dispatched before `createDepositForBooking()` completes, so `getDepositForBooking()` returns null and the email is silently skipped.
**Why it happens:** Executing Stripe creation and email dispatch in parallel.
**How to avoid:** Always `await createDepositForBooking()` before `await getDepositForBooking()`. The order in nightlife-mcp's `updateVipAdminBooking()` is: create deposit → read deposit → send email. Follow this order exactly.
**Warning signs:** deposit_required email never arrives even though Stripe session was created.

### Pitfall 5: Stripe Session `expires_at` Below Minimum
**What goes wrong:** Stripe rejects the checkout session creation with "expires_at must be at least 30 minutes in the future."
**Why it happens:** `checkout_expiry_minutes` in `vip_venue_deposit_config` is set to a value less than 30.
**How to avoid:** The `createDepositForBooking()` function reads `config.checkout_expiry_minutes`. The default in nightlife-mcp is 30 minutes. Don't override it below 30. Note: Stripe requires minimum 30 minutes for `expires_at`.
**Warning signs:** 500 from Stripe API on deposit_required transition.

### Pitfall 6: Deposit Link Not Visible on Booking Detail After Transition
**What goes wrong:** Admin transitions to `deposit_required`, the Stripe session is created, but the detail page doesn't show the deposit link.
**Why it happens:** (a) The `VipAdminBookingSummary` type doesn't include deposit fields — they're in the separate `vip_booking_deposits` table. (b) `useVipBookingDetail` cache isn't invalidated after the mutation.
**How to avoid:** After a successful PATCH, the `useUpdateVipBookingStatus` hook must invalidate `['vip-booking-detail', bookingId]` as well as `['vip-bookings']`. The detail refetch via `getVipAdminBookingDetail` in the service function returns the updated booking. For the deposit link specifically, the response should include `deposit_checkout_url` if status is `deposit_required`. This requires either: (a) adding `deposit_checkout_url` to `VipAdminBookingUpdateResult` (by querying `vip_booking_deposits` in the service), or (b) the detail page doing its own `useVipBookingDetail` refetch. Option (b) is simpler — invalidate the detail cache key in the mutation hook.
**Warning signs:** Deposit link never appears on detail page even after successful transition.

### Pitfall 7: TypeScript Error — Stripe Types Not Found
**What goes wrong:** `import Stripe from 'stripe'` works at runtime but TypeScript can't find Stripe types.
**Why it happens:** The `stripe` package includes its own types (no `@types/stripe` needed). If an older version is installed, types may differ.
**How to avoid:** Use `stripe@^20.4.0` (same as nightlife-mcp). The package ships its own `index.d.ts`. No separate `@types/stripe` install needed.
**Warning signs:** TypeScript error "Cannot find module 'stripe' or its corresponding type declarations."

### Pitfall 8: Zod optional-field TypeScript mismatch in PATCH route
**What goes wrong:** Spreading `parsed.data` into `updateVipAdminBooking` input causes TypeScript to reject because Zod infers optional fields as `string | undefined`.
**Why it happens:** Same issue as Phase 7 — Zod's safeParse returns a type where optional fields are `string | undefined` even when the schema marks them as `.optional()`.
**How to avoid:** Destructure `parsed.data` into explicit named fields in the PATCH route handler. Do NOT use spread operator on Zod parsed output.
**Warning signs:** TypeScript error about type mismatch when passing parsed.data to service function.

## Code Examples

### admin_update_vip_booking_request RPC Signature (verified SECURITY DEFINER)
```sql
-- Source: nightlife-mcp supabase/migrations/20260306_add_deposit_required_status.sql (verified)
CREATE OR REPLACE FUNCTION public.admin_update_vip_booking_request(
  p_booking_request_id uuid,
  p_editor_username text,
  p_patch jsonb,
  p_note text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  booking_request_id uuid,
  changed_fields text[],
  audit_id uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
-- Accepts status IN ('submitted','in_review','deposit_required','confirmed','rejected','cancelled')
-- Inserts vip_booking_status_events with actor_type 'ops'
-- Settles vip_agent_tasks on terminal status (confirmed, rejected, cancelled)
-- Inserts vip_booking_edit_audits
```

### Supabase RPC Call Pattern
```typescript
// Source: nightlife-mcp src/services/vipAdmin.ts updateVipAdminBooking() (verified)
const { data, error } = await supabase.rpc('admin_update_vip_booking_request', {
  p_booking_request_id: bookingRequestId,
  p_editor_username: editorUsername,
  p_patch: patch,   // plain JS object — Supabase client serializes to jsonb
  p_note: note,
});

const rpcRow = Array.isArray(data) ? data[0] : undefined;
// rpcRow.changed_fields: string[]
// rpcRow.audit_id: string (UUID)
// rpcRow.updated_at: string (ISO timestamp)
```

### createDepositForBooking Signature (ported from nightlife-mcp)
```typescript
// Source: nightlife-mcp src/services/deposits.ts createDepositForBooking() (verified)
// Note: argument order changed slightly from the vipAdmin.ts call (see deposits.ts line 123)
async function createDepositForBooking(
  supabase: SupabaseClient,
  stripeSecretKey: string,     // NOTE: nightlife-mcp's vipAdmin.ts passes (supabase, bookingRequestId, stripeSecretKey, nightlifeBaseUrl)
  bookingRequestId: string,    // but deposits.ts defines (supabase, stripeSecretKey, bookingRequestId, nightlifeBaseUrl)
  nightlifeBaseUrl: string,
): Promise<VipDepositRecord | null>
```

**IMPORTANT:** The call in nightlife-mcp `vipAdmin.ts` line 724 passes:
```typescript
await createDepositForBooking(supabase, bookingRequestId, options.stripeSecretKey, options.nightlifeBaseUrl);
```
But `deposits.ts` line 123 defines the signature as:
```typescript
export async function createDepositForBooking(supabase, stripeSecretKey, bookingRequestId, nightlifeBaseUrl)
```
This is an **argument order mismatch** in the existing nightlife-mcp code. Verify actual deposits.ts parameter order before porting. The deposits.ts definition is authoritative — port that signature directly.

### Deposit Record Schema (for getDepositForBooking)
```typescript
// Source: nightlife-mcp src/services/deposits.ts getDepositForBooking() (verified)
// Returns from vip_booking_deposits table:
type VipDepositRecord = {
  id: string;
  booking_request_id: string;
  venue_id: string;
  status: 'pending' | 'paid' | 'expired' | 'refunded' | 'partially_refunded' | 'forfeited';
  amount_jpy: number;
  deposit_percentage: number;
  min_spend_jpy: number;
  stripe_checkout_session_id: string;
  stripe_checkout_url: string;
  checkout_expires_at: string | null;
  // ... other fields
};
```

### Email Template Signatures (to port)
```typescript
// Source: nightlife-mcp src/services/email.ts (verified)
sendDepositRequiredEmail(supabase, resendApiKey, bookingRequestId, depositAmountJpy, checkoutUrl, expiresAt)
sendBookingConfirmedEmail(supabase, resendApiKey, bookingRequestId, depositPaid?: boolean)
sendBookingRejectedEmail(supabase, resendApiKey, bookingRequestId)
// All fetch booking data internally via fetchBookingEmailData() — no pre-fetching needed
// statusMessage (from vip_booking_requests.status_message) is passed as `reason` to bookingRejectedContent
```

### useUpdateVipBookingStatus Hook Pattern
```typescript
// Source: Pattern from useCreateVipBooking() in nlt-admin useVipBookings.ts (verified)
export function useUpdateVipBookingStatus(bookingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateVipAdminBookingInput): Promise<VipAdminBookingUpdateResult> => {
      const response = await fetch(`/api/vip/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error((err as { error?: string }).error ?? `HTTP ${response.status}`);
      }
      return response.json() as Promise<VipAdminBookingUpdateResult>;
    },
    onSuccess: () => {
      // Invalidate both list and detail queries
      queryClient.invalidateQueries({ queryKey: ['vip-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['vip-booking-detail', bookingId] });
      toast.success('Booking status updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update booking: ${error.message}`);
    },
  });
}
```

### VipUpdateStatusDialog Component Structure
```typescript
// 'use client' component following VipCreateBookingDialog.tsx pattern
const updateStatusSchema = z.object({
  status: z.enum(['submitted', 'in_review', 'deposit_required', 'confirmed', 'rejected', 'cancelled']),
  status_message: z.string().min(1, 'Status message is required').max(400),
  change_note: z.string().max(400).optional(),
});

type VipUpdateStatusDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  currentStatus: VipBookingStatus;
};

// Transition map determines which options to show in the Select
const VALID_TRANSITIONS: Record<VipBookingStatus, VipBookingStatus[]> = {
  submitted:         ['in_review', 'rejected', 'cancelled'],
  in_review:         ['deposit_required', 'confirmed', 'rejected', 'cancelled'],
  deposit_required:  ['confirmed', 'rejected', 'cancelled'],
  confirmed:         [],
  rejected:          [],
  cancelled:         [],
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express dashboard status update form (nightlife-mcp vipDashboardPage.ts) | React Dialog + react-hook-form + useMutation (nlt-admin) | v2.0 migration | Client-side validation, proper UX, TypeScript types |
| Stripe + Resend side effects in nightlife-mcp Express handler | Same side effects ported to nlt-admin API route | Phase 8 | nlt-admin becomes self-contained for VIP ops |
| admin_update_vip_booking_request without deposit_required status | RPC updated in migration 20260306 to include deposit_required | 2026-03-06 | Deposit flow is now fully in the DB pipeline |

**Deprecated/outdated:**
- Express dashboard status update at `/api/v1/admin/vip-bookings/:id` PATCH (nightlife-mcp): still functional but to be removed in Phase 9.

## Open Questions

1. **Argument order mismatch in createDepositForBooking (LOW confidence risk)**
   - What we know: nightlife-mcp vipAdmin.ts line 724 calls `createDepositForBooking(supabase, bookingRequestId, stripeSecretKey, nightlifeBaseUrl)` but deposits.ts signature starts with `stripeSecretKey` as second arg.
   - What's unclear: Which is the actual correct call order — vipAdmin.ts has a bug, or deposits.ts was updated without updating the call site.
   - Recommendation: Before porting, read deposits.ts line 123 carefully and trace the argument names. Port the deposits.ts signature (the definition), not the call site in vipAdmin.ts. Write a clear comment noting the parameter order.

2. **Should the deposit checkout URL be returned in the PATCH response?**
   - What we know: `VipAdminBookingUpdateResult.booking` is a `VipAdminBookingSummary` which doesn't include deposit fields. The deposit URL is in `vip_booking_deposits`.
   - What's unclear: Whether the booking detail page should show the deposit link, and if so, where it comes from.
   - Recommendation: After PATCH succeeds, the booking detail page refetches via `useVipBookingDetail`. To show the deposit link, add a `deposit_checkout_url: string | null` and `deposit_status: string | null` field to `VipAdminBookingSummary` (requires adding a join to `vip_booking_deposits` in `buildBookingSummaries`). This is the cleanest path — the detail page already shows the booking summary. Alternatively, skip showing the deposit link in the admin (the customer gets the link by email) — this is also acceptable for MVP.
   - Recommendation: For MVP (Phase 8), add `deposit_checkout_url` and `deposit_status` to `VipAdminBookingSummary` by joining `vip_booking_deposits` in `buildBookingSummaries`. This gives ops visibility into the deposit link without opening a separate Stripe dashboard.

3. **Should the status_message have sensible defaults per status?**
   - What we know: The form requires `status_message` for every status update. Different statuses have natural default messages.
   - What's unclear: Whether to pre-fill the status_message input based on selected status.
   - Recommendation: Pre-fill with suggested defaults in the form, let admin override. For `deposit_required`: "A deposit is required to confirm your VIP table. Please complete payment using the link provided." For `confirmed`: "Your VIP table is confirmed. See you soon!" For `rejected`: "Unfortunately we are unable to accommodate your request at this time."

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
| MUTATE-01 | Admin transitions submitted → in_review | manual | Navigate to booking detail, click Update Status, select in_review, submit | N/A |
| MUTATE-01 | Admin transitions in_review → deposit_required | manual | Same flow, select deposit_required | N/A |
| MUTATE-01 | Admin transitions deposit_required → confirmed | manual | Same flow, select confirmed | N/A |
| MUTATE-01 | Admin transitions in_review → rejected | manual | Same flow, select rejected | N/A |
| MUTATE-01 | PATCH /api/vip/bookings/[id] returns 401 for unauthenticated | smoke | `curl -X PATCH /api/vip/bookings/<id> -d '{}'` → expect 401 | N/A |
| MUTATE-01 | PATCH /api/vip/bookings/[id] returns 403 for non-admin | smoke | Requires a non-admin JWT | N/A |
| MUTATE-01 | Terminal status buttons disabled on detail page | manual | Open confirmed booking, verify no Update Status button | N/A |
| MUTATE-02 | deposit_required transition creates Stripe checkout session | manual | Transition to deposit_required, check Railway logs for Stripe session ID | N/A |
| MUTATE-02 | Deposit link visible on booking detail after deposit_required | manual | After transition, verify deposit_checkout_url shows on detail page | N/A |
| MUTATE-02 | Stripe failure doesn't block status update | manual | Use invalid STRIPE_SECRET_KEY, verify status still updates | N/A |
| MUTATE-03 | customer receives email on deposit_required | manual | Transition to deposit_required with real customer email, verify email arrives | N/A |
| MUTATE-03 | customer receives email on confirmed | manual | Transition to confirmed, verify email arrives | N/A |
| MUTATE-03 | customer receives email on rejected | manual | Transition to rejected with reason in status_message, verify email content | N/A |
| MUTATE-03 | Resend failure doesn't block status update | manual | Use invalid RESEND_API_KEY, verify status still updates | N/A |
| MUTATE-05 | status_message appears in rejection email | manual | Set status_message "Sorry, venue full tonight", reject booking, verify email content | N/A |
| MUTATE-05 | status_message visible on detail page | manual | After update, verify status_message shown in booking detail | N/A |

### Sampling Rate
- **Per task commit:** `cd /Users/alcylu/Apps/nlt-admin && npm run build` (TypeScript compilation)
- **Per wave merge:** Manual smoke test — transition one booking through submitted → in_review → confirmed, verify no errors
- **Phase gate:** All 4 success criteria verified in browser before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Install `stripe@^20.4.0` and `resend@^4.8.0` in nlt-admin package.json
- [ ] Add `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `NIGHTLIFE_CONSUMER_URL` to `.env.example` (comment-only, no values)
- [ ] Add `UpdateVipAdminBookingInput` and `VipAdminBookingUpdateResult` types to `src/types/vip.ts`
- [ ] Add `deposit_checkout_url: string | null` and `deposit_status: string | null` to `VipAdminBookingSummary` type

## Sources

### Primary (HIGH confidence)
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/services/vipAdmin.ts` — `updateVipAdminBooking()` full implementation (lines 675-763)
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/services/deposits.ts` — `createDepositForBooking()`, `getDepositForBooking()` full implementations
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/services/email.ts` — `sendDepositRequiredEmail()`, `sendBookingConfirmedEmail()`, `sendBookingRejectedEmail()` full implementations
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/services/stripe.ts` — `getStripe()`, `createDepositCheckoutSession()` full implementations
- Verified: `/Users/alcylu/Apps/nightlife-mcp/src/emails/templates.ts` — `emailLayout()`, `depositRequiredContent()`, `bookingConfirmedContent()`, `bookingRejectedContent()`
- Verified: `/Users/alcylu/Apps/nightlife-mcp/supabase/migrations/20260306_add_deposit_required_status.sql` — `admin_update_vip_booking_request` RPC is SECURITY DEFINER, accepts all 6 statuses including deposit_required
- Verified: `/Users/alcylu/Apps/nlt-admin/src/services/vipAdminService.ts` — Plain Error pattern, existing validation helpers (ensureUuid, normalizeOptionalText, etc.) available for reuse
- Verified: `/Users/alcylu/Apps/nlt-admin/src/hooks/useVipBookings.ts` — `useCreateVipBooking()` pattern to extend with `useUpdateVipBookingStatus()`
- Verified: `/Users/alcylu/Apps/nlt-admin/src/components/vip/VipCreateBookingDialog.tsx` — Dialog + react-hook-form + zodResolver pattern for VipUpdateStatusDialog
- Verified: `/Users/alcylu/Apps/nlt-admin/src/app/api/vip/bookings/[id]/route.ts` — existing GET handler to extend with PATCH
- Verified: `/Users/alcylu/Apps/nlt-admin/src/types/vip.ts` — types to extend with UpdateVipAdminBookingInput, VipAdminBookingUpdateResult
- Verified: `/Users/alcylu/Apps/nightlife-mcp/package.json` — `stripe@^20.4.0`, `resend@^4.8.0` installed versions
- Verified: `/Users/alcylu/Apps/nlt-admin/package.json` — stripe and resend NOT installed (confirmed by searching dependencies)

### Secondary (MEDIUM confidence)
- STATE.md blocker note: "nlt-admin Railway service needs STRIPE_SECRET_KEY, RESEND_API_KEY, NIGHTLIFE_CONSUMER_URL added before any code touches Stripe/Resend" — confirmed as a known concern requiring manual setup

### Tertiary (LOW confidence)
- Argument order mismatch in `createDepositForBooking` call site vs. definition — needs manual verification before porting (flagged in Open Questions)
- Whether to show deposit_checkout_url on booking detail — architectural decision, not yet made

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all new dependencies verified in nightlife-mcp; all existing nlt-admin deps confirmed in package.json
- Architecture: HIGH — PATCH route pattern, RPC signature, and all side-effect functions verified in source code
- Pitfalls: HIGH — most identified from reading actual code + STATE.md historical decisions
- Validation: MEDIUM — test patterns verified but Phase 8 has no automated tests; all validation is manual

**Research date:** 2026-03-11
**Valid until:** 2026-04-10 (Stripe Checkout API is stable; Resend API is stable; Supabase RPC is production-applied)
