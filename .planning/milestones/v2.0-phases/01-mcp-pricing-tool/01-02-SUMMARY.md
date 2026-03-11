---
phase: 01-mcp-pricing-tool
plan: 02
subsystem: api
tags: [mcp, tools, zod, typescript, vip-pricing]

# Dependency graph
requires:
  - phase: 01-mcp-pricing-tool/01-01
    provides: getVipPricing service function and VipPricingResult/VipZonePricingSummary types
provides:
  - get_vip_pricing MCP tool registered in server with behavioral description, input/output schemas
  - vipPricingOutputSchema exported from src/tools/vipTables.ts for runtime validation
  - registerVipPricingTool exported function for server factory wiring
  - Deprecation notes on get_vip_table_availability and get_vip_table_chart tool descriptions
affects:
  - 01-03 (REST endpoint plan will expose same data via /api/v1/venues/:id/vip-pricing)
  - openclaw SKILL.md update (needs tool list to include get_vip_pricing)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tool behavioral description pattern: WHEN TO CALL / WHAT TO DO AFTER / DO NOT CALL"
    - "Zod output schema per-tool: vipZonePricingSummarySchema nested in vipPricingOutputSchema"
    - "layout_image_url uses z.string().nullable() not z.string().url().nullable() — avoids strict URL validation failures on valid stored data"

key-files:
  created: []
  modified:
    - src/tools/vipTables.ts
    - src/tools/vipTables.test.ts
    - src/server.ts

key-decisions:
  - "layout_image_url schema uses z.string().nullable() not z.string().url() — strict URL validation would break on valid stored data with non-standard URL formats"
  - "Old tools (get_vip_table_availability, get_vip_table_chart) kept registered with DEPRECATED prefix in description — removal deferred to Phase 2 after Ember confirmed"
  - "vipPricingInputSchema uses plain object with Zod fields (not z.object) — consistent with codebase inputSchema pattern for MCP registerTool"

patterns-established:
  - "Behavioral description pattern: WHEN TO CALL / WHAT TO DO AFTER / DO NOT CALL (established for agent guidance)"
  - "TDD RED/GREEN cycle: tests added to existing test file, imports fail RED, implementation makes GREEN"

requirements-completed:
  - LIFE-02

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 1 Plan 02: MCP Tool Registration Summary

**get_vip_pricing MCP tool registered with WHEN TO CALL / WHAT TO DO AFTER / DO NOT CALL behavioral description, Zod input/output schema, and server factory wiring**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T14:32:13Z
- **Completed:** 2026-03-10T14:34:32Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Registered get_vip_pricing MCP tool with full behavioral description guiding agents on when and how to use pricing data
- Defined vipPricingOutputSchema (Zod) to validate VipPricingResult at runtime, preventing malformed data from reaching clients
- Wired registerVipPricingTool into the server factory alongside existing tools
- Added deprecation prefixes to get_vip_table_availability and get_vip_table_chart descriptions

## Task Commits

Each task was committed atomically:

1. **Task 1: Register get_vip_pricing tool with output schema and behavioral description** - `cba9cff` (feat)
2. **Task 2: Wire registerVipPricingTool into server.ts** - `de05fd1` (feat)

_Note: Task 1 followed TDD — RED (import failure) confirmed before GREEN (implementation passes 79/79 tests)._

## Files Created/Modified
- `src/tools/vipTables.ts` - Added import for getVipPricing, VIP_PRICING_DESCRIPTION constant, vipZonePricingSummarySchema, vipPricingOutputSchema (exported), registerVipPricingTool (exported), deprecation prefixes on old tool descriptions
- `src/tools/vipTables.test.ts` - Added 4 tests: schema validates well-formed result, rejects missing venue_open, rejects missing venue_id, registerVipPricingTool is callable
- `src/server.ts` - Added registerVipPricingTool to import and call in createNightlifeServer factory

## Decisions Made
- `layout_image_url` schema uses `z.string().nullable()` not `z.string().url().nullable()` — strict URL validation would fail on valid stored data with non-standard URL formats or path-only values
- Old tools remain registered with DEPRECATED prefix — removal deferred until Phase 2 (Ember) is confirmed working with the new tool
- `vipPricingInputSchema` uses plain object (not `z.object()`) — consistent with existing codebase pattern for MCP `registerTool` inputSchema

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- get_vip_pricing MCP tool is live and callable by any connected MCP client
- Service layer (Plan 01-01) + tool registration (Plan 01-02) complete — pricing data flows end-to-end via MCP
- Plan 01-03: Add REST endpoint `/api/v1/venues/:id/vip-pricing` to expose same data over HTTP

## Self-Check: PASSED

- FOUND: src/tools/vipTables.ts
- FOUND: src/tools/vipTables.test.ts
- FOUND: src/server.ts
- FOUND: .planning/phases/01-mcp-pricing-tool/01-02-SUMMARY.md
- FOUND commit cba9cff: feat(01-02): register get_vip_pricing tool with output schema and behavioral description
- FOUND commit de05fd1: feat(01-02): wire registerVipPricingTool into server factory

---
*Phase: 01-mcp-pricing-tool*
*Completed: 2026-03-10*
