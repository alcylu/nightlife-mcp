---
phase: 02-ember-prompt-update
plan: 01
subsystem: infra
tags: [openclaw, skill, prompt, mcp, ember, mamad, lisa]

# Dependency graph
requires:
  - phase: 01-mcp-pricing-tool
    provides: get_vip_pricing MCP tool (registered, deployed to production)
provides:
  - Updated nightlife-concierge SKILL.md with get_vip_pricing replacing old two-tool flow
  - Mandatory confirmation gate before create_vip_booking_request
  - CRITICAL layout-only guardrail in VIP Table Chart section
  - Updated YAML description and all references across 4 generic openclaw instances
  - Live deployment to ember and mamad Railway containers via oc-sync push
affects: [phase-03-cleanup, openclaw-skill-updates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - oc-sync push for deploying skill files to Railway containers
    - Single-tool VIP pricing flow (get_vip_pricing replaces get_vip_table_availability + get_vip_table_chart)

key-files:
  created: []
  modified:
    - /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md
    - /Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md
    - /Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md
    - /Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md

key-decisions:
  - "date parameter in get_vip_pricing call is optional — pass only if user mentioned a specific date, omit for general inquiries"
  - "MANDATORY CONFIRMATION GATE phrased as CRITICAL rule with explicit 'Do NOT call create_vip_booking_request until you have explicit confirmation'"
  - "VIP Table Chart guardrail uses LAYOUT REFERENCE ONLY wording and adds 'Never infer table availability from the image'"
  - "lisa Railway container was offline at deploy time — local files updated, deploy deferred to next online moment"

patterns-established:
  - "Pattern 1: Generic nightlife concierge instances (ember, mamad, lisa) always kept byte-for-byte identical. oneoak variant is intentionally different and never updated from ember."
  - "Pattern 2: When deploying via oc-sync, confirm stale-pull warning with y, then confirm push diff with y"

requirements-completed: [EMBR-01, EMBR-02, EMBR-03]

# Metrics
duration: 3min
completed: 2026-03-11
---

# Phase 2 Plan 01: Ember Prompt Update Summary

**nightlife-concierge SKILL.md rewritten to use single get_vip_pricing tool with mandatory booking confirmation gate and CRITICAL chart layout-only guardrail, deployed to ember and mamad Railway containers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T15:24:40Z
- **Completed:** 2026-03-10T15:27:40Z
- **Tasks:** 1 of 2 complete (Task 2 is a blocking human-verify checkpoint)
- **Files modified:** 4

## Accomplishments
- Rewrote 9 sections of nightlife-concierge SKILL.md: Tool Contract, VIP Booking Flow, VIP Pricing Freshness Rule, VIP Table Chart, VIP Presentation Rule, Booking Tone, Venue Lookup, Venue Knowledge, and YAML frontmatter description
- Added MANDATORY CONFIRMATION GATE at step 7 of the VIP booking flow — Ember must ask "Would you like me to submit an inquiry?" and wait for explicit YES before calling create_vip_booking_request
- Added CRITICAL LAYOUT REFERENCE ONLY guardrail to VIP Table Chart section — Ember must not infer table availability from the chart image
- Verified: 0 references to old tools, 7 references to get_vip_pricing, all 4 generic instance files byte-for-byte identical
- Deployed to ember and mamad via oc-sync push (both confirmed pushed)
- lisa container was offline at deploy time — local file updated, Railway deploy deferred

## Task Commits

1. **Task 1: Rewrite SKILL.md VIP sections and sync to all instances** - `2515ce7` (feat) — committed in openclaw/sync repo

**Plan metadata:** committed after SUMMARY creation (nightlife-mcp repo)

## Files Created/Modified
- `/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` — Primary: all 9 section rewrites applied
- `/Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md` — Byte-for-byte copy of ember
- `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md` — Byte-for-byte copy of ember
- `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md` — Byte-for-byte copy of ember

## Decisions Made
- `date` parameter in `get_vip_pricing` call is optional — pass only when user specifies a date. This matches the tool's design (date-optional) and produces accurate "venue closed" responses for specific dates.
- Confirmation gate wording uses CRITICAL marker and explicit "Do NOT call create_vip_booking_request until you have explicit confirmation" — stronger than soft suggestion per research pitfall guidance.
- lisa Railway container was offline at deploy time — flagged but not blocking. Local files updated correctly.

## Deviations from Plan

None — plan executed exactly as written. All 9 section changes applied as specified in plan interfaces and research Code Examples.

## Issues Encountered
- **lisa container offline**: `oc-sync push lisa` returned "Failed to connect: Your application is not running or in a unexpected state". Not a blocking issue — local file is updated correctly and will deploy on next push when container is online. Both ember (primary for testing) and mamad are deployed.

## User Setup Required

None — no external service configuration required beyond the live Ember tests in Task 2 (human-verify checkpoint).

## Next Phase Readiness
- Task 2 (checkpoint:human-verify) requires Allen to test live Ember behavior via LINE or Discord for three scenarios:
  1. VIP inquiry at Zouk triggers get_vip_pricing (not old tools)
  2. Booking flow pauses at confirmation gate before submission
  3. Table chart request returns layout reference without availability inference
- After human verification passes, phase 2 is complete and phase 3 (old tool removal/cleanup) can begin

---
*Phase: 02-ember-prompt-update*
*Completed: 2026-03-11*
