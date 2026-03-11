---
phase: 05-agent-workspace-sync
plan: 01
subsystem: infra
tags: [openclaw, oc-sync, agents, skill, vip-pricing, workspace]

# Dependency graph
requires:
  - phase: 03-cleanup-and-event-context
    provides: busy_night and pricing_approximate fields in get_vip_pricing responses
  - phase: 02-ember-prompt-update
    provides: get_vip_pricing tool reference in AGENTS.md (partial — stale bullets remained)
provides:
  - Updated AGENTS.md in ember, mamad, and lisa (local) replacing stale VIP tool references with get_vip_pricing
  - Updated SKILL.md in ember, mamad, lisa, and lisa-template with busy_night and pricing_approximate field guidance
  - oc-sync push to ember and mamad containers (AGENTS.md + SKILL.md)
  - lisa deployment deferred (container offline — same as Phase 2 situation)
affects: [openclaw agents reading AGENTS.md or SKILL.md nightlife-concierge skill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "oc-sync push with 'yes |' for automated interactive confirmation"
    - "Copy ember SKILL.md byte-for-byte to other instances after canonical edit"

key-files:
  created:
    - /Users/alcylu/Apps/nightlife-mcp/.planning/phases/05-agent-workspace-sync/05-01-SUMMARY.md
  modified:
    - /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/AGENTS.md
    - /Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/AGENTS.md
    - /Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/AGENTS.md
    - /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md
    - /Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md
    - /Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md
    - /Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md

key-decisions:
  - "lisa Railway container was offline — AGENTS.md and both SKILL.md copies deferred, consistent with Phase 2 precedent"
  - "AGENTS.md edited individually per instance (not copied) to preserve instance-specific content"
  - "ember SKILL.md used as canonical source; byte-for-byte copied to mamad, lisa, lisa-template"
  - "Session caches cleared on ember and mamad after SKILL.md push (required for skill changes to take effect)"

patterns-established:
  - "busy_night: true pattern: weave event_name into concierge intro before pricing"
  - "pricing_approximate: true pattern: use softer hedge words (around, approximately), not generic disclaimers"

requirements-completed: [SC-1, SC-2, SC-3]

# Metrics
duration: 8min
completed: 2026-03-11
---

# Phase 5 Plan 01: Agent Workspace Sync Summary

**Removed stale get_vip_table_chart / get_vip_table_availability references from 3 AGENTS.md files and added busy_night + pricing_approximate field guidance to all 4 SKILL.md copies, deployed to ember and mamad (lisa deferred — offline)**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-11T03:00:00Z
- **Completed:** 2026-03-11T03:08:00Z
- **Tasks:** 2 of 3 complete (Task 3 is checkpoint:human-verify)
- **Files modified:** 7 (in openclaw repo)

## Accomplishments
- Removed stale `get_vip_table_chart` / `get_vip_table_availability` references from ember, mamad, and lisa AGENTS.md
- Added "Event Context" subsection to VIP Presentation Rule in SKILL.md — agents now told to mention event_name when busy_night is true
- Added "Pricing Confidence" subsection — agents use softer language ("around", "approximately") when pricing_approximate is true
- Pushed all changes to ember and mamad Railway containers via oc-sync, cleared session caches
- lisa deferred (container offline — documented)

## Task Commits

Each task was committed atomically (in the openclaw repo):

1. **Task 1: Replace stale VIP tool references in 3 AGENTS.md files** - `d761c1f` (feat)
2. **Task 2: Add busy_night and pricing_approximate field guidance to SKILL.md** - `51998ca` (feat)
3. **Task 3: Deploy via oc-sync** - Checkpoint reached, deployment automation complete

## Files Created/Modified

In `/Users/alcylu/Apps/openclaw` repo:
- `sync/instances/ember/workspace/AGENTS.md` - Replaced stale VIP tool bullet with get_vip_pricing
- `sync/instances/mamad/workspace/AGENTS.md` - Same replacement (instance-specific content preserved)
- `sync/instances/lisa/workspace/AGENTS.md` - Same replacement (lisa-specific section preserved)
- `sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` - Added busy_night + pricing_approximate subsections (canonical)
- `sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md` - Byte-for-byte copy of ember
- `sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md` - Byte-for-byte copy of ember
- `sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md` - Byte-for-byte copy of ember

## Decisions Made

- **Individual AGENTS.md edits**: Each of the 3 AGENTS.md files edited independently, not by overwriting with a copy. Lisa's file uses different section names ("Nightlife Capability Guardrail" not "MCP-First Rule"), so only the shared stale bullet was changed.
- **Ember as canonical SKILL.md source**: Edit ember first, then copy byte-for-byte to mamad, lisa, lisa-template. All 4 verified identical via diff.
- **lisa deployment deferred**: Container has been offline since Phase 2 (last pull 2026-03-06). Local files are correct. Push when container comes back online.
- **Session cache cleared on ember and mamad**: SKILL.md changes require cache clear so agents pick up the updated skill file immediately.

## Deviations from Plan

None — plan executed exactly as written. The deployment automation (yes | oc-sync push) worked for ember and mamad. lisa offline situation was anticipated in the plan ("If lisa is offline, document the push as deferred").

## Deployment Status

| Instance | AGENTS.md | SKILL.md | Session Cache |
|----------|-----------|----------|---------------|
| ember | Pushed (d761c1f) | Pushed | Cleared |
| mamad | Pushed (d761c1f) | Pushed | Cleared |
| lisa | DEFERRED (offline) | DEFERRED (offline) | N/A |
| lisa workspace-template | N/A | DEFERRED (offline) | N/A |

## Issues Encountered

- **lisa container offline**: Same as Phase 2. All 3 lisa pushes failed with "Your application is not running or in a unexpected state". Local files are correct — push when container comes back online.

## Next Phase Readiness

- ember and mamad agents will now correctly call get_vip_pricing for VIP asks and properly handle busy_night + pricing_approximate fields
- lisa: local files are correct; push is the only remaining step when container recovers
- Phase 5 plan 01 complete pending human approval of deployment checkpoint

---
*Phase: 05-agent-workspace-sync*
*Completed: 2026-03-11*
