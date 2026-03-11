# Roadmap: Nightlife MCP — VIP Operations

## Milestones

- ✅ **v1.0 VIP Pricing Redesign** - Phases 1-5 (shipped 2026-03-11)
- 🚧 **v2.0 VIP Dashboard Migration** - Phases 6-9 (in progress)

## Phases

<details>
<summary>✅ v1.0 VIP Pricing Redesign (Phases 1-5) - SHIPPED 2026-03-11</summary>

### Phase 1: MCP Pricing Tool
**Goal**: The new `get_vip_pricing` tool is live in production and returns honest weekday/weekend pricing ranges, venue open status, zone summaries, table chart URLs, and booking affordance fields. Old tools remain registered and functional.
**Depends on**: Nothing (first phase)
**Requirements**: VPRC-01, VPRC-02, VPRC-03, VPRC-04, VPRC-05, VPRC-06, VPRC-09, REST-01, REST-02, LIFE-02
**Success Criteria** (what must be TRUE):
  1. Calling `get_vip_pricing` with a valid venue ID and date returns weekday and weekend minimum spend ranges aggregated from day-default rows
  2. Calling `get_vip_pricing` for a closed venue returns `venue_open: false` with an explanatory message and no pricing rows
  3. Calling `get_vip_pricing` for a venue with no pricing data returns `pricing_configured: false` with a message
  4. GET `/api/v1/venues/:id/vip-pricing` returns the same shape as the MCP tool response
  5. The old `get_vip_table_availability` and `get_vip_table_chart` tools still respond (not yet removed)
**Plans**: 3/3 plans complete

Plans:
- [x] 01-01-PLAN.md — Build vipPricing.ts service (types, operating hours gate, day-defaults aggregation, zone summary, chart URL, booking affordance, tests)
- [x] 01-02-PLAN.md — Register get_vip_pricing MCP tool with output schema and behavioral description; wire into server; deprecation notes on old tools
- [x] 01-03-PLAN.md — Add REST endpoint GET /api/v1/venues/:id/vip-pricing and OpenAPI spec entry

### Phase 2: Ember Prompt Update
**Goal**: Ember uses `get_vip_pricing` for all VIP inquiries, presents pricing conversationally, and enforces the mandatory user confirmation gate before submitting any booking request.
**Depends on**: Phase 1
**Requirements**: EMBR-01, EMBR-02, EMBR-03
**Success Criteria** (what must be TRUE):
  1. Asking Ember about VIP table options triggers a `get_vip_pricing` call, not the old two-tool flow
  2. Ember presents weekday/weekend pricing ranges in natural conversation without raw field names or JSON
  3. Ember always asks "Would you like me to submit an inquiry?" before calling `create_vip_booking_request` — it never auto-submits
  4. Ember states the table chart is a layout reference only and does not infer availability from it
**Plans**: 1/1 plans complete

Plans:
- [x] 02-01-PLAN.md — Rewrite VIP sections of SKILL.md

### Phase 3: Cleanup and Event Context
**Goal**: Old VIP tools are removed from the MCP server, and `get_vip_pricing` responses include event context (busy night signal) and a `pricing_approximate` flag.
**Depends on**: Phase 2
**Requirements**: VPRC-07, VPRC-08, LIFE-01
**Success Criteria** (what must be TRUE):
  1. Calling `get_vip_table_availability` or `get_vip_table_chart` returns a tool-not-found error
  2. Calling `get_vip_pricing` for a date with an event returns the event name and `busy_night: true` in the response
  3. When pricing comes from approximate sources, `pricing_approximate: true` is present in the response
**Plans**: 1/1 plans complete

Plans:
- [x] 03-01-PLAN.md — Fix failing test, add event context + pricing_approximate, commit old tool removal, update OpenAPI spec

### Phase 4: Phase 2 Verification and Metadata Hygiene
**Goal**: Phase 2 (Ember Prompt Update) is formally verified with a VERIFICATION.md, closing the orphaned status of EMBR-01/02/03.
**Depends on**: Phase 2, Phase 3
**Requirements**: EMBR-01, EMBR-02, EMBR-03
**Success Criteria** (what must be TRUE):
  1. Phase 2 has a VERIFICATION.md that confirms EMBR-01, EMBR-02, EMBR-03 are satisfied
  2. All phase SUMMARY files list their verified requirements in `requirements-completed` frontmatter
  3. Re-audit shows 0 orphaned requirements
**Plans**: 1/1 plans complete

Plans:
- [x] 04-01-PLAN.md — Verify Phase 2 work and fix SUMMARY frontmatter across all phases

### Phase 5: Agent Workspace Sync
**Goal**: AGENTS.md files in ember/mamad/lisa no longer reference removed tools, SKILL.md includes guidance for busy_night and pricing_approximate fields.
**Depends on**: Phase 4
**Requirements**: (no new requirements — closes integration risks and tech debt)
**Success Criteria** (what must be TRUE):
  1. AGENTS.md in ember, mamad, and lisa workspaces no longer list `get_vip_table_availability` or `get_vip_table_chart`
  2. SKILL.md VIP Presentation Rule includes instructions for `busy_night` and `pricing_approximate` fields
  3. lisa Railway container serves the current SKILL.md
**Plans**: 1/1 plans complete

Plans:
- [x] 05-01-PLAN.md — Update AGENTS.md in 3 workspaces, add field guidance to SKILL.md, deploy to lisa

</details>

---

### v2.0 VIP Dashboard Migration (In Progress)

**Milestone Goal:** Move the VIP booking admin dashboard from nightlife-mcp into nlt-admin (Next.js), with full feature parity, Supabase-direct queries, and Stripe/email side effects via Next.js API routes. Remove all dashboard code from nightlife-mcp.

**Phase Numbering:**
- Integer phases (6, 7, 8, 9): Planned milestone work
- Decimal phases: Urgent insertions (marked with INSERTED)

- [x] **Phase 6: Foundation and Read-Only Dashboard** - Types, service layer, API routes, and read-only list + detail UI in nlt-admin with role guard (completed 2026-03-11)
- [ ] **Phase 7: Create Booking Mutation** - Ops can create bookings on behalf of customers; Resend email on submit
- [ ] **Phase 8: Status Update with Stripe and Resend** - Full status pipeline with Stripe deposit creation and email dispatch on transitions
- [ ] **Phase 9: Cleanup** - Remove all admin dashboard code from nightlife-mcp after 48h production verification gate

## Phase Details

### Phase 6: Foundation and Read-Only Dashboard
**Goal**: Authorized ops staff can browse the complete VIP booking list and detail pages in nlt-admin — with filters, status history, and audit log — while role enforcement blocks all non-admin access at both UI and API layers. No mutation UI yet.
**Depends on**: Nothing (first v2.0 phase; both repos remain untouched until this ships)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, DETAIL-01, DETAIL-02, DETAIL-03, DETAIL-04
**Success Criteria** (what must be TRUE):
  1. An admin user visiting `/vip` in nlt-admin sees a paginated booking list with status badges, agent task indicators, and working filters for status, date range, venue, and name/email/phone search
  2. An admin user clicking a booking row opens the detail page with full customer info, status history timeline (actor, timestamp, notes), and field-level edit audit log
  3. A non-admin user (event_organizer, unauthenticated) receives a 403 response from every `/api/vip/*` route and cannot access VIP pages
  4. The booking list refreshes automatically every 60 seconds without a page reload
  5. When filters produce no results, an empty state with a clear-filters call to action is shown rather than a blank list
**Plans**: 3 plans

Plans:
- [ ] 06-01-PLAN.md — VIP types, service layer, API routes with admin role guard, nav config
- [ ] 06-02-PLAN.md — Booking list page with filters, badges, pagination, empty state, auto-refresh
- [ ] 06-03-PLAN.md — Booking detail page with status timeline, audit log, agent task badge

### Phase 7: Create Booking Mutation
**Goal**: Ops can create VIP booking requests on behalf of walk-in, phone, and LINE customers directly from nlt-admin, including internal notes and a change note explaining the creation context.
**Depends on**: Phase 6 (service layer and auth guard must exist before adding mutations)
**Requirements**: MUTATE-04, MUTATE-06, MUTATE-07
**Success Criteria** (what must be TRUE):
  1. An admin user can fill a create-booking form with customer info, venue selector, table code, min spend, and special requests, and submit it successfully
  2. A submitted booking appears immediately in the booking list with `submitted` status
  3. Admin can add an internal note (not customer-visible) and a change note when creating a booking
**Plans**: TBD

### Phase 8: Status Update with Stripe and Resend
**Goal**: Ops can move bookings through the complete status pipeline, with Stripe checkout sessions created automatically on `deposit_required` transitions and Resend emails dispatched on `deposit_required`, `confirmed`, and `rejected` transitions.
**Depends on**: Phase 7 (create mutation must be proven before adding complex side effects)
**Requirements**: MUTATE-01, MUTATE-02, MUTATE-03, MUTATE-05
**Success Criteria** (what must be TRUE):
  1. An admin user can update a booking status from the detail page through any valid pipeline transition (submitted → in_review → deposit_required → confirmed/rejected/cancelled)
  2. Transitioning a booking to `deposit_required` automatically creates a Stripe checkout session and the deposit link is visible on the booking detail
  3. The customer receives an email at the appropriate transitions (deposit_required, confirmed, rejected) and the admin can set a customer-visible status message that appears in that email
  4. A failed Stripe or Resend call does not block the status update — the admin's action succeeds and the failure is surfaced separately
**Plans**: TBD

### Phase 9: Cleanup
**Goal**: All Express admin dashboard code is removed from nightlife-mcp, leaving only MCP tools and REST API. nlt-admin is the sole interface for VIP booking management.
**Depends on**: Phase 8 (nlt-admin must be production-proven for 48h with at least one verified full deposit + confirm cycle before this phase begins)
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03
**Gate criteria (all must be met before this phase begins)**:
  - nlt-admin VIP dashboard has been in production for at least 48 hours
  - At least one full deposit creation and Stripe session verified in Stripe dashboard
  - At least one confirmation email confirmed received at a customer test address
  - nightlife-mcp Express admin routes confirmed still responding before the cleanup PR is merged
**Success Criteria** (what must be TRUE):
  1. `src/admin/` directory no longer exists in nightlife-mcp
  2. All `/ops/*` Express routes are removed from nightlife-mcp's HTTP server and return 404
  3. Dashboard auth middleware (`VIP_DASHBOARD_ADMINS`) and related config are removed from nightlife-mcp
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 6 → 7 → 8 → 9 (Phase 9 gated: 48h production verification required)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. MCP Pricing Tool | v1.0 | 3/3 | Complete | 2026-03-10 |
| 2. Ember Prompt Update | v1.0 | 1/1 | Complete | 2026-03-11 |
| 3. Cleanup and Event Context | v1.0 | 1/1 | Complete | 2026-03-11 |
| 4. Phase 2 Verification and Metadata Hygiene | v1.0 | 1/1 | Complete | 2026-03-11 |
| 5. Agent Workspace Sync | v1.0 | 1/1 | Complete | 2026-03-11 |
| 6. Foundation and Read-Only Dashboard | 3/3 | Complete   | 2026-03-11 | - |
| 7. Create Booking Mutation | v2.0 | 0/TBD | Not started | - |
| 8. Status Update with Stripe and Resend | v2.0 | 0/TBD | Not started | - |
| 9. Cleanup | v2.0 | 0/TBD | Not started | - |
