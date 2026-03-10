# Roadmap: VIP Generic Pricing Redesign

## Overview

Replace the two-tool VIP availability flow (`get_vip_table_availability` + `get_vip_table_chart`) with a single honest pricing tool (`get_vip_pricing`) that surfaces weekday/weekend minimum spend ranges, venue open status, and table chart URLs. Deliver in three sequenced phases: MCP server first (must deploy before Ember changes), Ember prompt second (activate the new flow), cleanup and enhancements third (remove old tools, add event context).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: MCP Pricing Tool** - Build and deploy `get_vip_pricing` with REST endpoint; old tools stay registered (completed 2026-03-10)
- [ ] **Phase 2: Ember Prompt Update** - Rewrite VIP flow in SKILL.md to use new tool with mandatory confirmation gate
- [ ] **Phase 3: Cleanup and Event Context** - Remove old tools; add event context and pricing_approximate signal

## Phase Details

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
**Plans:** 3/3 plans complete

Plans:
- [x] 01-01-PLAN.md — Build vipPricing.ts service (types, operating hours gate, day-defaults aggregation, zone summary, chart URL, booking affordance, tests)
- [x] 01-02-PLAN.md — Register get_vip_pricing MCP tool with output schema and behavioral description; wire into server; deprecation notes on old tools
- [x] 01-03-PLAN.md — Add REST endpoint GET /api/v1/venues/:id/vip-pricing and OpenAPI spec entry

### Phase 2: Ember Prompt Update
**Goal**: Ember uses `get_vip_pricing` for all VIP inquiries, presents pricing conversationally, and enforces the mandatory user confirmation gate before submitting any booking request.
**Depends on**: Phase 1 (new tool must be deployed and verified before Ember prompt changes)
**Requirements**: EMBR-01, EMBR-02, EMBR-03
**Success Criteria** (what must be TRUE):
  1. Asking Ember about VIP table options triggers a `get_vip_pricing` call, not the old two-tool flow
  2. Ember presents weekday/weekend pricing ranges in natural conversation without raw field names or JSON
  3. Ember always asks "Would you like me to submit an inquiry?" before calling `create_vip_booking_request` — it never auto-submits
  4. Ember states the table chart is a layout reference only and does not infer availability from it
**Plans:** 1 plan

Plans:
- [ ] 02-01-PLAN.md — Rewrite VIP sections of SKILL.md (Tool Contract, Booking Flow, Freshness Rule, Table Chart, Presentation Rule, Venue Lookup/Knowledge); add confirmation gate and chart guardrail; sync to all generic instances; deploy via oc-sync

### Phase 3: Cleanup and Event Context
**Goal**: Old VIP tools are removed from the MCP server, and `get_vip_pricing` responses include event context (busy night signal) and a `pricing_approximate` flag that lets Ember modulate confidence language.
**Depends on**: Phase 2 (Ember must be confirmed using new tool before old tools are removed)
**Requirements**: VPRC-07, VPRC-08, LIFE-01
**Success Criteria** (what must be TRUE):
  1. Calling `get_vip_table_availability` or `get_vip_table_chart` returns a tool-not-found error (tools removed from server registration)
  2. Calling `get_vip_pricing` for a date with an event returns the event name and `busy_night: true` in the response
  3. When pricing comes from approximate sources (venue-level default), `pricing_approximate: true` is present in the response
**Plans**: TBD

Plans:
- [ ] 03-01: Add event context lookup to `vipPricing.ts` service (query event_occurrences for the requested date, attach event_name + busy_night flag)
- [ ] 03-02: Add `pricing_approximate` flag to service output based on fallback level; remove old tool registrations from `server.ts`; deploy and verify old tool names are gone

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. MCP Pricing Tool | 3/3 | Complete   | 2026-03-10 |
| 2. Ember Prompt Update | 0/1 | Not started | - |
| 3. Cleanup and Event Context | 0/2 | Not started | - |
