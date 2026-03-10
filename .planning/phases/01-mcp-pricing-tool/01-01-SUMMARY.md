---
phase: 01-mcp-pricing-tool
plan: "01"
subsystem: vip-pricing-service
tags: [service-layer, vip-pricing, tdd, types]
dependency_graph:
  requires: []
  provides: [getVipPricing, VipPricingResult, VipZonePricingSummary]
  affects: [src/types.ts, src/services/vipPricing.ts]
tech_stack:
  added: []
  patterns:
    - "TDD: RED (test) → GREEN (impl) → verify (no refactor needed)"
    - "Self-contained helper replication from vipTables.ts (ensureUuid, objectOrEmpty, extractLayoutImageUrl, resolveClosedDates pattern)"
    - "Supabase stub factory pattern with Partial<StubOverrides> for test isolation"
key_files:
  created:
    - src/services/vipPricing.ts
    - src/services/vipPricing.test.ts
  modified:
    - src/types.ts
decisions:
  - "Replicated resolveClosedDates logic (not imported) — function is unexported; replication is cleaner than modifying vipTables.ts API surface"
  - "Weekend = Fri/Sat (day_of_week 5/6); Weekday = Sun-Thu (0-4) — matches seeded data (CÉ LA VI, Zouk patterns)"
  - "pricing_configured checks both day-defaults AND vip_default_min_spend — avoids false negatives for venues using venue-level fallback"
  - "event_pricing_note set when vip_table_availability has rows with non-null min_spend for the requested date"
metrics:
  duration_min: 3
  completed_date: "2026-03-10"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 1
  tests_added: 13
  tests_passing: 75
---

# Phase 01 Plan 01: VIP Pricing Service Layer Summary

**One-liner:** `getVipPricing` service aggregating weekday/weekend min-spend ranges from `vip_table_day_defaults`, with open-day gate, zone summaries, layout image URL, per-date event override note, and booking affordance.

## What Was Built

### `src/types.ts` (modified)

Added two new exported interfaces at the end of the file:

- `VipZonePricingSummary` — zone name, capacity range, weekday/weekend min spend, currency
- `VipPricingResult` — complete pricing result including venue open/closed state, pricing ranges, zones array, layout image URL, booking fields, service date, and event pricing note

### `src/services/vipPricing.ts` (created, 313 lines)

Single exported function `getVipPricing(supabase, input)` that:

1. Validates UUID via local `ensureUuid` (replicated from vipTables.ts)
2. Resolves venue from `venues` table — no `vip_booking_enabled` requirement (pricing works for all venues)
3. Resolves city context (timezone + cutoff) with `Asia/Tokyo` / `06:00` defaults
4. Determines service date: `"tonight"` → `getCurrentServiceDate()`, YYYY-MM-DD → direct, absent → current service date
5. Runs open-day check via replicated `resolvePricingClosedDates()` — event-backed + operating hours + zero-hours edge case
6. Returns early with `venue_open: false` + `venue_closed_message` if closed
7. Fetches active `vip_venue_tables` (id, zone, capacity, metadata)
8. Fetches all `vip_table_day_defaults` for venue (no date filter — aggregate all days)
9. Checks `vip_table_availability` for per-date overrides — sets `event_pricing_note` if rows with non-null min_spend exist
10. Aggregates weekday/weekend pricing ranges and zone summaries via `aggregatePricing()`
11. Determines `pricing_configured` = day-defaults.length > 0 OR venue.vip_default_min_spend != null
12. Extracts `layout_image_url` from first table metadata with valid http URL
13. Returns complete `VipPricingResult`

### `src/services/vipPricing.test.ts` (created, 494 lines)

13 test cases covering all VPRC requirements:

| Test | Requirement |
|------|------------|
| Aggregates weekday and weekend min spend | VPRC-01 |
| Returns venue_open false for closed venue | VPRC-02 |
| Zone summary contains capacity range and per-zone pricing | VPRC-03 |
| Returns layout_image_url when present | VPRC-04 |
| Returns null layout_image_url when absent | VPRC-04 |
| Returns pricing_configured false when no day-defaults and no default_min_spend | VPRC-05 |
| Returns pricing_configured true when only vip_default_min_spend exists | VPRC-05 edge |
| Returns booking_supported from vip_booking_enabled (true/false/null) | VPRC-06 |
| Resolves tonight via service date | VPRC-09 |
| Includes event_pricing_note when per-date overrides exist | Blocker fix |
| Has null event_pricing_note when no per-date overrides | Blocker fix |
| Does not block venue with zero operating-hours rows | Edge case |
| Throws VENUE_NOT_FOUND for unknown venue | Error case |
| Throws INVALID_REQUEST for non-UUID | Error case |

## Commits

| Hash | Message |
|------|---------|
| 6939c74 | test(01-01): add failing tests for getVipPricing service |
| 212d05f | feat(01-01): implement getVipPricing service and VipPricingResult types |

## Deviations from Plan

None — plan executed exactly as written.

The `resolveClosedDates` replication was anticipated in the plan (noted as "copy the logic into services/vipPricing.ts — acceptable since it's self-contained").

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Replicated `resolveClosedDates` locally | Function is unexported from vipTables.ts; replication avoids modifying that file's API surface |
| Weekend = Fri/Sat (days 5-6) | Matches seeded data patterns (CÉ LA VI: Sun-Thu weekday, Fri-Sat weekend; Zouk: same) |
| `pricing_configured` checks both sources | Avoids false negative for venues using venue-level `vip_default_min_spend` only (VPRC-05 edge case) |
| `event_pricing_note` on non-null overrides only | Overrides with null min_spend shouldn't trigger the note — only explicit pricing rows matter |

## Self-Check

- `src/types.ts` contains `VipPricingResult`: FOUND
- `src/services/vipPricing.ts` contains `getVipPricing`: FOUND
- `src/services/vipPricing.test.ts` exists: FOUND
- All 75 tests pass (13 new + 62 existing): PASS
- Full suite clean: PASS

## Self-Check: PASSED
