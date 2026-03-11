# Stack Research

**Domain:** Admin dashboard migration — VIP booking management in Next.js 15 with Stripe and Resend
**Researched:** 2026-03-11
**Confidence:** HIGH (all versions confirmed via npm registry; patterns verified against existing nlt-admin codebase)

---

## The Core Question

What stack additions does nlt-admin need to implement:
1. A VIP booking admin dashboard (list, filter, detail, status update, create)
2. Stripe checkout session creation from Next.js API routes (server-side only, no client-side Stripe.js)
3. Stripe webhook handling in Next.js API routes (raw body + signature verification)
4. Resend email sending from Next.js API routes

nlt-admin already has: Next.js 15, React 19, TypeScript, Tailwind, Radix UI/shadcn, TanStack Query v5, React Hook Form + Zod, Sonner (toasts), Supabase SSR auth with role-based access. The answer is **two new packages only**.

---

## Recommended Stack

### New Dependencies (add to nlt-admin)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `stripe` | `^20.4.1` | Server-side Stripe API — checkout session creation, refunds, webhook verification | Same version already in nightlife-mcp. Matches the Stripe API version `2026-02-25.clover`. Server-only; never imported client-side. The existing `createDepositCheckoutSession()` logic ports directly. |
| `resend` | `^6.9.3` | Email sending via Resend API | Same package already in nightlife-mcp. Plain HTML string approach (nightlife-mcp already has tested templates) — no new templating dependency needed. |

### Existing nlt-admin Capabilities (already there, no additions needed)

| Technology | Version | How It's Used in the Dashboard |
|------------|---------|-------------------------------|
| `@supabase/ssr` | `^0.8.0` | `createSupabaseServerClient()` for auth in API routes; `createServiceRoleClient()` for RPC calls requiring service role |
| `@tanstack/react-query` | `^5.56.2` | `useQuery` for booking list + detail; `useMutation` for status update + create |
| `react-hook-form` + `zod` | `^7.53.0` / `^3.23.8` | Booking create form validation; status update form |
| Radix UI + shadcn components | various | `Table`, `Badge`, `Select`, `Dialog`, `Button`, `Card`, `Input`, `Textarea`, `Skeleton` — all already installed |
| `sonner` | `^1.5.0` | Toast notifications for status update success/failure — already used project-wide |
| `lucide-react` | `^0.462.0` | Icons for status badges, action buttons |
| `date-fns` | `^3.6.0` | Booking date display formatting |

---

## Installation

```bash
# In nlt-admin/ — two new packages only
npm install stripe@^20.4.1 resend@^6.9.3
```

No `@types/*` needed — both packages ship their own TypeScript declarations.

---

## Integration Points with Existing nlt-admin Patterns

### Auth in API Routes (follow the existing admin user endpoint pattern)

The existing `src/app/api/admin/users/route.ts` establishes the pattern: verify caller with `createSupabaseServerClient()`, check `user_roles` table for `super_admin`/`admin`, then proceed. VIP API routes must use the same pattern.

```typescript
// src/app/api/admin/vip-bookings/route.ts
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-client';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // role check: super_admin or admin only
  // then use createServiceRoleClient() for the RPC call
}
```

The service role client (`SUPABASE_SERVICE_ROLE_KEY`) is needed for `admin_update_vip_booking_request` RPC — that RPC performs privilege-escalated operations that the anon key cannot do.

### Data Fetching (follow the hook pattern)

All admin pages use the pattern: service function (direct Supabase query) → hook (`useQuery`/`useMutation`) → page component. Create:

- `src/services/vipBookingService.ts` — direct Supabase queries for list, detail, update, create (port from nightlife-mcp `src/services/vipAdmin.ts`)
- `src/hooks/useVipBookings.ts` — `useQuery`/`useMutation` wrappers (follow `src/hooks/useClientFinancials.ts` pattern)

Status updates with side effects (Stripe, email) go through Next.js API routes, not direct Supabase — the API route calls the RPC, then triggers Stripe/email.

### Stripe — Server-Only, API Routes Only

Stripe must never be imported in client components (`'use client'` files). The `stripe` package is Node.js only. Pattern:

```typescript
// src/lib/stripe.ts (server-only utility)
import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripeInstance;
}
```

The checkout session creation logic from `nightlife-mcp/src/services/stripe.ts` ports without modification — same API calls, same metadata shape.

### Stripe Webhook — Raw Body via `request.text()`

Next.js 15 App Router: use `request.text()` (not `request.json()`) to get the raw body for Stripe signature verification. This is the confirmed pattern for Next.js 15:

```typescript
// src/app/api/webhooks/stripe/route.ts
export async function POST(request: Request) {
  const body = await request.text();  // NOT request.json()
  const sig = request.headers.get('stripe-signature')!;
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  // ...
}
```

**Important:** Next.js 15 does not pre-parse the body for webhook routes when you call `.text()` — this is working and confirmed by community sources. No `bodyParser: false` config needed (that was Pages Router).

### Resend — Same HTML Template Approach

Port the HTML string templates from `nightlife-mcp/src/emails/templates.ts` directly — they produce tested, styled HTML already in use. Do not add `react-email` or `@react-email/components` for this migration. The templates are self-contained functions with no dependencies; copy them to `src/lib/email/templates.ts` in nlt-admin.

```typescript
// src/lib/email/resend.ts (server-only utility)
import { Resend } from 'resend';

export function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY!);
}
```

### Page Route Access Guard (follow existing ProtectedRoute pattern)

VIP dashboard pages must be restricted to `super_admin` and `admin` roles. The existing `ProtectedRoute` component checks `isAdmin` from `useAdminAuth`, which includes both roles. Place VIP pages under `src/app/(admin)/ops/vip/` to inherit the `(admin)/layout.tsx` protection automatically.

For extra safety, add an explicit role check inside the hook/service: the Supabase RLS on `vip_booking_requests` already restricts to authenticated users with admin roles — confirm this before removing application-layer checks.

---

## New Environment Variables for nlt-admin (Railway)

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `STRIPE_SECRET_KEY` | Stripe secret key for checkout creation | Stripe dashboard — same key as nightlife-mcp |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for nlt-admin's endpoint | Create a new webhook endpoint in Stripe dashboard pointing to nlt-admin's Railway URL |
| `RESEND_API_KEY` | Resend API key for email sending | Resend dashboard — same key as nightlife-mcp |
| `NIGHTLIFE_BASE_URL` | Used in deposit email success/cancel URLs | Already in nightlife-mcp; set to `https://nightlifetokyo.com` |

Note: `STRIPE_WEBHOOK_SECRET` must be a **new** endpoint registration in Stripe — the nightlife-mcp webhook secret will not work for nlt-admin's different URL.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `stripe@^20.4.1` (server SDK) | `@stripe/stripe-js` (client SDK) | Only when building customer-facing payment UIs with Stripe Elements. Admin dashboard only creates sessions server-side — never needs client SDK. |
| HTML string templates (port from nightlife-mcp) | `react-email` + `@react-email/components` | When building new email templates from scratch in a React-native codebase. Migrating existing working HTML templates is faster and avoids a new dependency. |
| Next.js API routes for Stripe/email side effects | Server Actions | Server Actions work but lack native webhook support (Stripe webhooks require a POST endpoint, not a form action). API routes are the correct primitive for webhook handling. |
| `createServiceRoleClient()` for RPC | anon client with RLS | When the RPC requires elevated privileges (writing to audit tables, bypassing row-level restrictions). `admin_update_vip_booking_request` RPC needs service role. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@stripe/stripe-js` | Client-side Stripe SDK for payment UIs — not needed. Dashboard only creates sessions, never renders Stripe Elements | `stripe` (server SDK) only |
| `react-email` / `@react-email/components` | Adds build complexity and a new mental model for templates that already work as plain HTML functions | Port existing HTML template functions from nightlife-mcp |
| `stripe-webhook` or third-party webhook libraries | Unnecessary — `stripe.webhooks.constructEvent()` in the Node SDK handles verification | Built-in `stripe` SDK method |
| `nodemailer` or `sendgrid` | Different email providers; Resend is already in nightlife-mcp and tested | `resend` |
| `@tanstack/react-table` | The VIP list is a bounded dataset (~50 rows per page). Using TanStack Table adds significant setup for a simple admin table. Radix `Table` component is sufficient. | `@radix-ui/react-table` (already available via shadcn `table.tsx`) |

---

## Stack Patterns by Variant

**For the booking list page:**
- Use `useQuery` with `queryKey: ['vip-bookings', filters]` and `staleTime: 30_000`
- No infinite scroll needed — ops will page through 50 bookings at a time
- Client-side filter state (status, date range, search) triggers a new query key, not client-side filtering of cached data

**For the booking detail page:**
- Use `useQuery` with `queryKey: ['vip-booking', id]`
- Status history + edit audits fetched in the same query as the booking detail (follow `getVipAdminBookingDetail()` from nightlife-mcp which already joins these)
- Status update is a `useMutation` that calls the nlt-admin API route (which calls the RPC + triggers Stripe/email)

**For the booking create form:**
- React Hook Form + Zod (matching the `CreateVipAdminBookingInput` shape from nightlife-mcp)
- Venue selector fetches from `listVipAdminVenues()` (port the service function)
- On submit: POST to `/api/admin/vip-bookings`, invalidate the list query on success

**For Stripe webhook route (deposit paid/expired):**
- `export const dynamic = 'force-dynamic'` at the top of the route — prevents Next.js static optimization from breaking webhook handling
- Route at `src/app/api/webhooks/stripe/route.ts` (separate from admin API routes — no auth middleware, verified by Stripe signature instead)

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `stripe@^20.4.1` | Node.js 18+, TypeScript 5+ | Ships own types. Pins Stripe API version `2026-02-25.clover`. Works with Next.js 15 standalone output. |
| `resend@^6.9.3` | Node.js 18+, TypeScript 5+ | Ships own types. `html` prop for string templates, `react` prop for React Email components — use `html` prop only. |
| Both | `@supabase/supabase-js@^2.50.0` | No conflict — they operate on different systems (Stripe API, Resend API) independently of Supabase |
| Both | Next.js 15.5 / React 19 | Server-only packages; never imported in client components. No React version dependency. |

---

## Sources

- npm registry (live query 2026-03-11): `stripe@20.4.1`, `resend@6.9.3` — HIGH confidence
- [Stripe Node SDK changelog](https://github.com/stripe/stripe-node/blob/master/CHANGELOG.md) — v20.4.x pins API version `2026-02-25.clover` — HIGH confidence
- [Stripe webhooks Next.js 15 — Medium (John Gragson, 2025)](https://medium.com/@gragson.john/stripe-checkout-and-webhook-in-a-next-js-15-2025-925d7529855e) — `request.text()` for raw body in App Router — MEDIUM confidence (community, not official docs)
- [Stripe webhook docs](https://docs.stripe.com/webhooks/signature) — signature verification requirements — HIGH confidence
- [Resend docs — Send with Next.js](https://resend.com/docs/send-with-nextjs) — `html` prop for HTML string emails — HIGH confidence
- Existing nightlife-mcp codebase (`src/services/stripe.ts`, `src/services/email.ts`, `src/services/deposits.ts`) — exact API shape and logic to port — HIGH confidence (live code)
- Existing nlt-admin codebase (`src/app/api/admin/users/route.ts`, `src/lib/supabase/server.ts`, `src/hooks/useClientFinancials.ts`) — auth pattern, hook pattern, service pattern — HIGH confidence (live code)

---

*Stack research for: VIP dashboard migration — Next.js 15 admin dashboard with Stripe + Resend*
*Researched: 2026-03-11*
