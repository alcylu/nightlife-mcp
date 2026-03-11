---
phase: 02-ember-prompt-update
verified: 2026-03-11T02:30:06Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 2: Ember Prompt Update -- Verification Report

**Phase Goal:** Ember's SKILL.md is updated to use `get_vip_pricing` exclusively, includes a mandatory confirmation gate before submitting booking requests, and clearly documents that table charts are layout-only references.
**Verified:** 2026-03-11
**Status:** PASSED
**Re-verification:** No -- initial verification (post-hoc)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ember SKILL.md contains zero references to `get_vip_table_availability` or `get_vip_table_chart` | VERIFIED | `grep -c "get_vip_table_availability\|get_vip_table_chart" SKILL.md` returns `0` across all 4 generic instances (ember, mamad, lisa/workspace, lisa/workspace-template) |
| 2 | ember SKILL.md references `get_vip_pricing` at least 3 times (Tool Contract, VIP Booking Flow, Freshness Rule) | VERIFIED | `grep -c "get_vip_pricing"` returns `10` in ember SKILL.md |
| 3 | VIP Booking Flow step 7 is a MANDATORY CONFIRMATION GATE — "Do NOT call `create_vip_booking_request` until you have explicit confirmation" | VERIFIED | "MANDATORY CONFIRMATION GATE" present at line 111: `7. **MANDATORY CONFIRMATION GATE:** Ask explicitly — "Would you like me to submit an inquiry?" — and wait for the user's YES before proceeding. Do NOT call \`create_vip_booking_request\` until you have explicit confirmation.` |
| 4 | VIP Table Chart section has CRITICAL guardrail: "LAYOUT REFERENCE ONLY" with "Never infer table availability from the image" | VERIFIED | Present at line 175: `**CRITICAL: The table chart is a LAYOUT REFERENCE ONLY.** It shows physical seating positions and zone names — it does NOT show which tables are available, held, or booked. Never infer table availability from the image.` |
| 5 | All four generic SKILL.md files are byte-for-byte identical (ember, mamad, lisa/workspace, lisa/workspace-template) | VERIFIED | `diff ember mamad` = empty (IDENTICAL), `diff ember lisa/workspace` = empty (IDENTICAL), `diff ember lisa/workspace-template` = empty (IDENTICAL) |
| 6 | Updated SKILL.md deployed to ember Railway container | VERIFIED | `oc-sync push ember` succeeded at Phase 2 execution time (commit 2515ce7 in openclaw/sync repo) |
| 7 | Updated SKILL.md deployed to mamad Railway container | VERIFIED | `oc-sync push mamad` succeeded at Phase 2 execution time |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` | Updated to use `get_vip_pricing`, includes confirmation gate and layout-only guardrail | VERIFIED | 10 references to `get_vip_pricing`, 0 to old tools, confirmation gate at line 111, layout guardrail at line 175 |
| `/Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md` | Byte-for-byte identical to ember | VERIFIED | `diff ember mamad` returns empty |
| `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md` | Byte-for-byte identical to ember | VERIFIED | `diff ember lisa/workspace` returns empty |
| `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md` | Byte-for-byte identical to ember | VERIFIED | `diff ember lisa/workspace-template` returns empty |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| SKILL.md VIP Booking Flow | `get_vip_pricing` | Step 2 instruction: "Call `get_vip_pricing` with the venue_id" | WIRED | 10 occurrences of `get_vip_pricing` in SKILL.md; confirmed present in Tool Contract section, VIP Booking Flow, and Freshness Rule |
| SKILL.md VIP Booking Flow step 7 | `create_vip_booking_request` | Mandatory confirmation gate — user must confirm before call | WIRED | Line 111: "Do NOT call `create_vip_booking_request` until you have explicit confirmation" |
| SKILL.md VIP Table Chart section | `layout_image_url` | Chart retrieval via single `get_vip_pricing` call (not separate tool) | WIRED | Line 181: "If `layout_image_url` is present: send the URL and note it is a seating chart for layout reference only" |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| EMBR-01 | 02-01-PLAN.md | Ember SKILL.md updated to use `get_vip_pricing` instead of old two-tool flow | SATISFIED | `grep -c "get_vip_pricing"` = 10; `grep -c "get_vip_table_availability\|get_vip_table_chart"` = 0; old two-tool flow replaced throughout |
| EMBR-02 | 02-01-PLAN.md | Ember SKILL.md includes mandatory confirmation gate before calling `create_vip_booking_request` | SATISFIED | "MANDATORY CONFIRMATION GATE" at line 111 with explicit "Do NOT call until you have explicit confirmation" |
| EMBR-03 | 02-01-PLAN.md | Ember SKILL.md explicitly states table chart is layout reference only -- do not infer availability from image | SATISFIED | "CRITICAL: The table chart is a LAYOUT REFERENCE ONLY" at line 175 with "Never infer table availability from the image" |

**All 3 Phase 2 requirements satisfied.**

---

### Residual Risks

| Risk | Status | Action |
|------|--------|--------|
| lisa Railway container deploy deferred | Pending | Container was offline at Phase 2 deploy time. Local file is correct and byte-for-byte identical to ember. Push when container is online. Phase 5 tracks this. |
| AGENTS.md stale tool references | Low-moderate | ember/mamad/lisa workspace AGENTS.md files each contain a single line referencing `get_vip_table_chart` / `get_vip_table_availability`. SKILL.md overrides for skill-specific behavior, but AGENTS.md should be updated for consistency. Phase 5 addresses this. |

Neither residual risk blocks PASSED status: the SKILL.md files driving agent behavior are correct in all local instances, and ember + mamad (the two live containers) are deployed.

---

### Gaps Summary

No gaps. All 3 requirements verified via automated grep and diff checks. The verification is post-hoc (Phase 2 completed without a VERIFICATION.md being created at the time), but the underlying work is confirmed correct by inspecting live files.

---

## Commit Verification

| Hash | Repo | Description |
|------|------|-------------|
| `2515ce7` | openclaw/sync | Phase 2 SKILL.md rewrite -- updated all 4 generic instances to use `get_vip_pricing`, added confirmation gate (EMBR-02), added layout-only guardrail (EMBR-03) |

---

_Verified: 2026-03-11_
_Verifier: Claude (gsd-executor)_
