---
phase: 2
slug: ember-prompt-update
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification — SKILL.md is a behavioral prompt, no automated test runner |
| **Config file** | None |
| **Quick run command** | `grep -c "get_vip_table_availability\|get_vip_table_chart" /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` (must be 0) |
| **Full suite command** | `diff /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md /Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md` (must be empty) |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `grep -c "get_vip_table_availability\|get_vip_table_chart" SKILL.md` (must be 0)
- **After every plan wave:** Run full diff check between ember and mamad instances
- **Before `/gsd:verify-work`:** Full suite must be green + manual live test in Ember
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | EMBR-01 | automated | `grep -n "get_vip_table_availability\|get_vip_table_chart" .../ember/.../SKILL.md` (must return empty) | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | EMBR-01 | automated | `grep -c "get_vip_pricing" .../ember/.../SKILL.md` (must be >= 3) | ✅ | ⬜ pending |
| 02-01-03 | 01 | 1 | EMBR-02 | automated | `grep -i "confirmation gate\|explicitly confirms\|would you like me to submit" .../ember/.../SKILL.md` (must have match) | ✅ | ⬜ pending |
| 02-01-04 | 01 | 1 | EMBR-03 | automated | `grep -i "layout reference only\|do not infer" .../ember/.../SKILL.md` (must have match) | ✅ | ⬜ pending |
| 02-01-05 | 01 | 1 | All | automated | `diff .../ember/.../SKILL.md .../mamad/.../SKILL.md` (must be empty) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* No test framework setup needed — all validation uses grep/diff commands against existing SKILL.md files.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Ember responds with `get_vip_pricing` call on VIP inquiry | EMBR-01 | Requires live agent session on LINE/Discord | Send "What are the VIP options at Zouk?" in Ember chat |
| Live Ember asks for confirmation before submitting booking | EMBR-02 | Requires live multi-turn conversation | Walk through booking flow to final step — verify Ember pauses for confirmation |
| Ember does not say "Table X appears available" based on chart | EMBR-03 | Requires live agent response to chart question | Ask "Can you show me the table layout for CE LA VI?" — verify no availability inference |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
