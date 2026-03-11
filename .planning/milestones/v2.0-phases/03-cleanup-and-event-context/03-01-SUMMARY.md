---
phase: 03-cleanup-and-event-context
plan: 01
subsystem: vip-pricing
tags: [event-context, pricing-approximate, vip-pricing, tdd]
dependency_graph:
  requires: []
  provides: [VPRC-07, VPRC-08, LIFE-01]
  affects: [src/types.ts, src/services/vipPricing.ts, src/tools/vipTables.ts, src/openapi.ts]
tech_stack:
  added: []
  patterns: [PricingDateContext return type, extractEventName helper, pricing_approximate flag]
key_files:
  created: []
  modified:
    - src/types.ts
    - src/services/vipPricing.ts
    - src/services/vipPricing.test.ts
    - src/tools/vipTables.ts
    - src/tools/vipTables.test.ts
    - src/openapi.ts
decisions:
  - "extractEventName is self-contained in vipPricing.ts (not imported from events.ts) — avoids modifying events API surface"
  - "PricingDateContext returned from resolvePricingClosedDates instead of just Set<string> — collocates event lookup with closed-date check, single DB call"
  - "pricing_approximate = dayDefaults.length === 0 && venueDefaultMinSpend !== null — only approximate when venue-level fallback is the sole source"
  - "busyNight derived from eventName !== null — single source of truth, no separate boolean logic"
metrics:
  duration: 3m 27s
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_modified: 6
requirements-completed: [VPRC-07, VPRC-08, LIFE-01]
---

# Phase 03 Plan 01: Event Context and Pricing Approximate Summary

**One-liner:** Event name and busy_night from event_occurrences lookup + pricing_approximate flag when venue-level fallback is sole pricing source.

## What Was Built

Added three new fields to the `get_vip_pricing` tool output:

1. **`event_name: string | null`** — Name of the event happening on the requested date. Uses `name_en` with `name_i18n.en` fallback. Returns null if no date provided or no event found.
2. **`busy_night: boolean`** — True when `event_name` is non-null. Enables agents to tell users about special events ("there's a Friday Night Special happening — demand will be higher").
3. **`pricing_approximate: boolean`** — True when pricing comes from venue-level `vip_default_min_spend` with no per-day defaults. Enables agents to use hedging language ("around ¥100K") vs exact pricing.

## Tasks Completed

### Task 1: Fix failing test + add event context and pricing_approximate to types and service

**Files:** src/types.ts, src/services/vipPricing.ts, src/services/vipPricing.test.ts

- Added 3 fields to `VipPricingResult` interface in types.ts
- Added `PricingDateContext` type and `extractEventName` helper to vipPricing.ts
- Extended `resolvePricingClosedDates` return type from `Set<string>` to `PricingDateContext` — now returns both closed dates AND event names by date in a single DB call
- Extended `.select("start_at")` to `.select("start_at,name_en,name_i18n")` in the event_occurrences query
- Fixed VPRC-02 test: the closed-venue test had wrong expectations (expected `pricing_configured: false` and empty zones, but service correctly returns pricing regardless of venue-open status)
- Added 7 new tests: VPRC-07 (event_name/busy_night with event, without event, no date, i18n fallback) and VPRC-08 (pricing_approximate true/false/unconfigured)

**Commit:** 002e22e

### Task 2: Verify LIFE-01 removals + update Zod output schema, OpenAPI spec, tool description, and schema tests

**Files:** src/tools/vipTables.ts, src/tools/vipTables.test.ts, src/openapi.ts, src/server.ts

- Verified `registerVipTableTools` is absent from both server.ts and vipTables.ts (LIFE-01 already complete)
- Added `event_name`, `busy_night`, `pricing_approximate` to `vipPricingOutputSchema` Zod schema
- Updated `VIP_PRICING_DESCRIPTION` with guidance on `busy_night` (mention event name, demand) and `pricing_approximate` (hedging language)
- Added 3 new OpenAPI fields to `/venues/{id}/vip-pricing` response schema
- Updated schema test objects to include new fields (rejection tests for missing venue_open and venue_id)

**Commit:** 1f8d5a2

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written with one minor note:

**VPRC-02 fix applied:** The test expected `pricing_configured: false` and `zones: []` for a closed venue. The service behavior is correct — it returns pricing data regardless of venue-open status (closed-venue message is informational, not a blocker for pricing data). Only the test expectations were wrong. Fixed per plan instructions.

## Verification

- `npm test` — 84 tests pass (0 failures), including 7 new VPRC-07/VPRC-08 tests and the fixed VPRC-02 test
- `npm run build` — TypeScript compiles cleanly
- `registerVipTableTools` absent from server.ts and vipTables.ts (LIFE-01 confirmed)
- OpenAPI spec documents event_name, busy_night, pricing_approximate

## Self-Check: PASSED

- FOUND: src/types.ts
- FOUND: src/services/vipPricing.ts
- FOUND: src/services/vipPricing.test.ts
- FOUND: .planning/phases/03-cleanup-and-event-context/03-01-SUMMARY.md
- FOUND: commit 002e22e (Task 1)
- FOUND: commit 1f8d5a2 (Task 2)
