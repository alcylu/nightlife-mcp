# Feature Research

**Domain:** Internal ops booking management dashboard (VIP table booking admin — migration to Next.js)
**Researched:** 2026-03-11
**Confidence:** HIGH (existing dashboard read directly from source; nlt-admin codebase inspected; domain patterns from hospitality/nightlife SaaS)

---

## Context

This research covers **what features matter** when moving the VIP booking dashboard from a server-rendered Express app (`nightlife-mcp/src/admin/`) into **nlt-admin** (Next.js 15, React 19, Supabase auth, shadcn-ui). The audience is 2 internal ops team members. Volume is low (few dozen bookings, not hundreds). The goal is ops efficiency, not scale.

**Existing features (already built — must migrate with full parity):**

- Booking list with status/date/search filters, pagination
- Booking detail with status history timeline + edit audit log
- Status update workflow: submitted → in_review → deposit_required → confirmed/rejected/cancelled
- Side effects on status change: Stripe deposit session creation (deposit_required), Resend emails (deposit_required, confirmed, rejected)
- Manual booking creation (admin on behalf of customer)
- Cookie-based auth (to be replaced by nlt-admin's Supabase role-based auth)

**What this research answers:** For an internal nightlife VIP ops dashboard, which features are table stakes vs. differentiators vs. anti-features, with complexity annotations and dependency links to existing code.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features ops will immediately notice missing. Not having them makes the dashboard feel broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Booking list with status badges | First screen. Ops needs a scannable queue at a glance. Without it, there's no dashboard. | LOW | Already: `listVipAdminBookings()` in `vipAdmin.ts`. Re-implement with React Query fetch from a Next.js API route or direct Supabase client call. |
| Status filter (multi-select) | Ops works queues by status (e.g., "show me all submitted"). Filtering by status is the primary navigation pattern. | LOW | Already: `statuses` param in list query. Render as checkbox group or multi-select combobox using shadcn. |
| Date range filter | Ops needs to find bookings "for this Saturday" or "last two weeks". Without dates, the list is noise. | LOW | Already: `booking_date_from` / `booking_date_to` in list query. Use a date range picker or two date inputs. |
| Customer search | When a customer calls in, ops searches by name/email/phone. Missing search = ops manually scans a list. | LOW | Already: `search` param queries `customer_name`, `customer_email`, `customer_phone` via Supabase `.or()`. |
| Booking detail view | Ops needs to see the full record — customer info, venue, table code, min spend, special requests — before taking action. | LOW | Already: `getVipAdminBookingDetail()`. Re-implement as a detail page with the same fields. |
| Status history timeline | Ops needs to see what happened: who changed the status, when, and what note they left. Without it, there's no accountability. | LOW | Already: `vip_booking_status_events` table, populated via `admin_update_vip_booking_request` RPC. Render as a vertical timeline. |
| Status update action | Core ops workflow. Moving a booking from submitted → in_review → confirmed is the primary job to be done. | MEDIUM | Already: `updateVipAdminBooking()` which calls `admin_update_vip_booking_request` RPC. nlt-admin must use the same RPC for atomic updates + audit trail. |
| Deposit trigger on status change | When moving to deposit_required, a Stripe checkout session must be created automatically. Ops won't manually create deposits. | MEDIUM | Already: `createDepositForBooking()` called inside `updateVipAdminBooking()`. Must be replicated in a Next.js API route (needs `STRIPE_SECRET_KEY`). |
| Email dispatch on key transitions | Ops expects the customer to receive an email when status changes to deposit_required, confirmed, or rejected. No manual emailing. | MEDIUM | Already: `sendDepositRequiredEmail()`, `sendBookingConfirmedEmail()`, `sendBookingRejectedEmail()` via Resend. Must run in nlt-admin API route (needs `RESEND_API_KEY`). |
| Pagination | Without pagination, a long list becomes unscrollable. Not glamorous, but mandatory. | LOW | Already: `limit`/`offset` in list query, `total_count` in response. Standard shadcn pagination or "load more" pattern. |
| Edit audit log on booking detail | When multiple ops members work a booking, they need to see who edited what fields, when, and what they changed. Without this, debugging disputes is impossible. | LOW | Already: `vip_booking_edit_audits` table populated by RPC. Render on detail page below status history. |
| Role-based access guard | Only super_admin and admin should reach this dashboard. Without the guard, any authenticated user can access customer PII and take ops actions. | LOW | nlt-admin already has `ProtectedRoute` + role checks. Wrap VIP pages in a role guard that checks for super_admin or admin. Replaces the old cookie-based auth. |
| Manual booking creation | Ops creates bookings for customers who call in directly (phone, LINE). Without this, ops has no way to enter a booking without going through the MCP/API. | MEDIUM | Already: `createVipAdminBooking()` which delegates to `createVipBookingRequest()`. Re-implement as a form in nlt-admin with venue selector (VIP-enabled venues only). |

### Differentiators (Competitive Advantage)

Features not found in a generic ops dashboard but valuable for this specific domain and team size.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Agent task status indicator on list | `vip_agent_tasks` tracks async ops tasks (email sends, deposit creation). Showing task status on the booking row catches failures before the customer complains. | LOW | Already fetched in `buildBookingSummaries()`. Surface as a small badge (pending/claimed/done/failed) on the list row. Especially useful for catching failed deposit or email sends. |
| Status-message field with customer-visible text | The `status_message` field is shown to customers. Ops can write a custom note (e.g., "Your table is confirmed at 23:00, mention this booking ID at the door.") that goes out with emails. | LOW | Already: `status_message` in the patch schema. Expose as a textarea in the status update form with a label indicating it's customer-facing. |
| Internal note field (not customer-visible) | Ops often needs to record internal context ("venue said they have a VIP event, double-check table assignment") that shouldn't appear in customer emails. | LOW | Already: `agent_internal_note` in patch schema. Expose as a separate textarea in the detail edit form with a clear "internal only" label. |
| Change note on each edit | Forcing ops to write a brief note when changing booking fields ("corrected party size per customer callback") creates a searchable audit trail without overhead. | LOW | Already: `p_note` param in `admin_update_vip_booking_request` RPC. Expose as an optional "reason for change" field on the edit form. |
| Preferred table code + min spend display | Shows which table the customer requested and the system-computed min spend. Ops can see immediately if the table code is valid or if it triggered a `table_warning`. | LOW | Already in booking row: `preferred_table_code`, `min_spend`, `min_spend_currency`, `table_warning`. Display on both list (abbreviated) and detail view. |
| Venue-scoped list filter | When ops works with a specific venue partner (e.g., 1 Oak's contact called about a booking), filtering the list by venue speeds triage. | LOW | Not currently implemented in the Express dashboard. Add `venue_id` as an optional filter on `listVipAdminBookings()`. Render as a dropdown of VIP-enabled venues (already have `listVipAdminVenues()`). |
| Empty state with clear call to action | Internal dashboards often show blank screens when filters return no results. An explicit "No bookings match these filters. Clear filters to see all bookings." avoids confusion. | LOW | Standard UX pattern. Implement as a shadcn `Card` with icon and reset-filters button. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time auto-refresh / websocket push | "I want to see new bookings appear without refreshing the page" | At 2 ops users and low booking volume, the complexity of websocket infra (or Supabase Realtime subscriptions) far outweighs the benefit. Polling or manual refresh is entirely sufficient. | React Query `refetchInterval: 60000` (1-minute background refetch) + a "Refresh" button on the list page. |
| Bulk status update | "Select multiple bookings and approve them all at once" | Each status change has side effects (Stripe, email). Bulk actions risk partial failures with no clear rollback. For 2 ops users and low volume, one-at-a-time is safe and auditable. | Single-booking workflow with fast navigation (list → detail → back to list). If volume grows, add bulk later. |
| CSV / data export | "Export all bookings for monthly reporting" | Scope creep for a migration milestone. Not used in the Express dashboard. Adds complexity (streaming, file generation) that should only be built when explicitly needed. | Ops can query Supabase Studio directly for bulk data. Add export as a future P3 feature if ops requests it. |
| Email template editing UI | "I want to edit the confirmation email from the dashboard" | Template editing introduces a WYSIWYG editor, versioning, and preview complexity. Email templates are stable and rarely change — this is a solution looking for a problem. | Keep Resend templates in code (`src/emails/templates.ts`). Change via deploy. |
| In-app Stripe dashboard / payment management | "Show payment status and refund from the dashboard" | Stripe has a full-featured dashboard. Duplicating payment management creates a maintenance burden and security surface. Ops can open Stripe directly for payment details. | Link to Stripe dashboard from the booking detail page when a deposit session exists. |
| Rich text / markdown in status message | "Let me format the confirmation message with bold and line breaks" | Customer emails are sent as HTML via Resend templates. The `status_message` is injected as-is. Markdown would appear as raw syntax in emails unless parsed, which adds rendering complexity. | Plain text textarea. Ops writes readable prose. Email template wraps it in the correct HTML context. |
| Notification / alert system | "Send me a Slack/email alert when a new booking arrives" | At 2 ops users, alert fatigue is a real risk. The `vip_agent_tasks` table already handles background alert dispatch. Building a push notification system for the dashboard UI is premature. | Ops checks the dashboard on their normal cadence. Booking volume is low enough that this is sustainable. |

---

## Feature Dependencies

```
[Booking list page]
    └──requires──> [Supabase client in nlt-admin]         (already exists — same project)
    └──requires──> [Role guard: super_admin or admin]     (nlt-admin ProtectedRoute pattern)
    └──requires──> [Next.js API route: GET /api/vip/bookings]  (or direct Supabase query)
    └──enhances──> [Venue filter dropdown]                (requires listVipAdminVenues())
    └──enhances──> [Agent task badge]                     (data already in list response)

[Booking detail page]
    └──requires──> [Booking list page]                    (navigation entry point)
    └──requires──> [Next.js API route: GET /api/vip/bookings/[id]]
    └──enhances──> [Status history timeline]              (vip_booking_status_events)
    └──enhances──> [Edit audit log]                       (vip_booking_edit_audits)

[Status update action]
    └──requires──> [Booking detail page]                  (context for what's being updated)
    └──requires──> [Next.js API route: PATCH /api/vip/bookings/[id]]
    └──requires──> [admin_update_vip_booking_request RPC] (atomic update + audit trail)
    └──triggers──> [Stripe deposit creation]              (when → deposit_required)
    └──triggers──> [Resend email dispatch]                (when → deposit_required, confirmed, rejected)

[Stripe deposit creation]
    └──requires──> [Status update action with deposit_required]
    └──requires──> [STRIPE_SECRET_KEY env var on Railway]
    └──requires──> [deposits.ts service logic ported or imported]

[Resend email dispatch]
    └──requires──> [Status update action]
    └──requires──> [RESEND_API_KEY env var on Railway]
    └──requires──> [email.ts service logic ported or imported]
    └──requires──> [Stripe deposit creation]              (for deposit_required email — needs checkout URL)

[Manual booking creation form]
    └──requires──> [Venue selector]                       (listVipAdminVenues() data)
    └──requires──> [Next.js API route: POST /api/vip/bookings]
    └──requires──> [createVipBookingRequest() logic]      (ported or imported from nightlife-mcp)
    └──triggers──> [Resend acknowledgment email]          (same as MCP flow)

[Admin code removal from nightlife-mcp]
    └──requires──> [Booking list page]                    (full parity before removal)
    └──requires──> [Booking detail page]                  (full parity before removal)
    └──requires──> [Status update action]                 (full parity before removal)
    └──requires──> [Manual booking creation form]         (full parity before removal)
    └──requires──> [Role guard]                           (auth replaced before removal)
```

### Dependency Notes

- **Stripe and Resend are hard dependencies for status update:** The PATCH route cannot be a thin proxy — it must run the side-effect logic itself. `STRIPE_SECRET_KEY` and `RESEND_API_KEY` must be added to nlt-admin Railway env vars before this route can go live.
- **Email for deposit_required requires deposit URL:** `sendDepositRequiredEmail()` needs the Stripe checkout URL from `createDepositForBooking()`. The two side effects must run in sequence, not in parallel.
- **RPC is non-negotiable:** `admin_update_vip_booking_request` provides atomicity + audit trail. nlt-admin must call the same RPC. Do not reimplement the update logic with raw `.update()` calls.
- **nlt-admin removal is the last step:** The Express dashboard must remain live until every feature is validated in nlt-admin. Two codebases run simultaneously during the migration window.

---

## MVP Definition

This is a migration milestone — MVP means **full feature parity with the Express dashboard** before removing the old code.

### Launch With (v1 — migration complete)

- [ ] Booking list page with status/date/search filters and pagination — ops primary view
- [ ] Booking detail page with status history timeline and edit audit log — ops action context
- [ ] Status update (PATCH) API route with Stripe deposit creation and Resend email side effects — core workflow
- [ ] Manual booking creation (POST) API route with venue selector — ops creates on behalf of customers
- [ ] Role guard: super_admin and admin only — replaces cookie-based auth
- [ ] Nav entry point added to nlt-admin admin navigation — ops can navigate to VIP section

### Add After Validation (v1.x)

Features not in the Express dashboard but low-effort improvements worth adding once parity is confirmed:

- [ ] Venue filter on booking list — trigger: ops asks for it, or booking volume grows beyond one venue
- [ ] Agent task status badge on list rows — trigger: a failed email/deposit goes unnoticed for the first time
- [ ] 1-minute background refetch on list page — trigger: ops misses a new booking because they didn't refresh

### Future Consideration (v2+)

Defer until there is explicit demand:

- [ ] CSV export — defer until ops needs monthly reporting
- [ ] Bulk status update — defer until booking volume justifies it
- [ ] Stripe deposit link on detail page — defer until ops asks for quick payment lookup

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Booking list with filters + pagination | HIGH | LOW | P1 |
| Role guard (super_admin + admin) | HIGH | LOW | P1 |
| Booking detail view | HIGH | LOW | P1 |
| Status history timeline | HIGH | LOW | P1 |
| Edit audit log | HIGH | LOW | P1 |
| Status update with Stripe + email side effects | HIGH | MEDIUM | P1 |
| Manual booking creation form | HIGH | MEDIUM | P1 |
| Nav entry point in nlt-admin | HIGH | LOW | P1 |
| Admin code removal from nightlife-mcp | HIGH | LOW | P1 (last step) |
| Agent task badge on list rows | MEDIUM | LOW | P2 |
| Venue filter on list | MEDIUM | LOW | P2 |
| Background refetch (React Query interval) | MEDIUM | LOW | P2 |
| Empty state + clear-filters button | MEDIUM | LOW | P2 |
| CSV export | LOW | MEDIUM | P3 |
| Stripe dashboard link on detail | LOW | LOW | P3 |
| Bulk status update | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have — migration is incomplete without these
- P2: Should have — add alongside P1 or immediately after
- P3: Nice to have — only if ops requests it

---

## Competitor Feature Analysis

Context: Internal ops dashboards from analogous booking management SaaS tools.

| Feature | TablelistPro / Resy for Nightlife | Generic reservation tools (OpenTable admin) | Our Approach |
|---------|----------------------------------|----------------------------------------------|--------------|
| Booking queue with status filters | Yes — primary view | Yes — reservation status pipeline | Same: status tabs/filters on list page |
| Status workflow with ops actions | Yes — move between stages manually | Limited — mostly auto-status from customer actions | Same: explicit manual status transitions with required status_message |
| Side-effect automation (deposits, emails) | Partial — some tools automate deposit links | No — manual email workflow | Same as Express: fully automated via Stripe + Resend on status change |
| Audit trail per booking | Minimal — notes only | None in most | Stronger: full field-level diff in `vip_booking_edit_audits` |
| Internal notes vs customer-visible messages | Rare — most tools have one notes field | No | Explicit separation: `agent_internal_note` vs `status_message` |
| Manual booking creation by ops | Yes — standard | Yes | Same: form with venue selector, reuses existing `createVipBookingRequest()` |
| Role-based access | Yes — manager/staff roles | Yes | Same: super_admin + admin only via nlt-admin Supabase auth |
| Multi-venue support | Yes — core feature | Yes | Partial: venue filter on list, all venues in same Supabase project |

---

## Sources

- Existing codebase read directly: `/Users/alcylu/Apps/nightlife-mcp/src/admin/vipAdminRouter.ts`, `src/admin/vipDashboardPage.ts`, `src/services/vipAdmin.ts`
- nlt-admin codebase inspected: `/Users/alcylu/Apps/nlt-admin/CLAUDE.md`, app structure and existing patterns
- Project context: `/Users/alcylu/Apps/nightlife-mcp/.planning/PROJECT.md`
- Domain reference: TablelistPro (nightclub SaaS), Resy for Operators (restaurant/bar reservation management), Discotech Ops (nightlife booking platform)
- Pattern reference: nlt-admin invoicing system (similar admin CRUD + status workflow pattern at `/invoices`)

---
*Feature research for: VIP booking admin dashboard migration (nightlife-mcp → nlt-admin)*
*Researched: 2026-03-11*
