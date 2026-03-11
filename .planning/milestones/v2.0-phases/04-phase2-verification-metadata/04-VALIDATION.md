---
phase: 04
slug: phase2-verification-metadata
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual grep/diff — documentation-only phase, no test runner |
| **Config file** | none |
| **Quick run command** | `grep -c "get_vip_table_availability\|get_vip_table_chart" /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` |
| **Full suite command** | All 7 grep/diff checks from 02-VALIDATION.md verification commands |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick grep check on modified file
- **After every plan wave:** Run full 7-command verification suite
- **Before `/gsd:verify-work`:** Full suite must be green + re-audit shows 0 orphaned reqs
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | EMBR-01 | automated | `grep -c "get_vip_table_availability\|get_vip_table_chart" .../ember/.../SKILL.md` = 0 | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | EMBR-01 | automated | `grep -c "get_vip_pricing" .../ember/.../SKILL.md` >= 3 | ✅ | ⬜ pending |
| 04-01-03 | 01 | 1 | EMBR-02 | automated | `grep -i "MANDATORY CONFIRMATION GATE" .../ember/.../SKILL.md` | ✅ | ⬜ pending |
| 04-01-04 | 01 | 1 | EMBR-03 | automated | `grep -i "LAYOUT REFERENCE ONLY" .../ember/.../SKILL.md` | ✅ | ⬜ pending |
| 04-01-05 | 01 | 1 | EMBR-01/02/03 | file existence | `ls .planning/phases/02-ember-prompt-update/02-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| 04-01-06 | 01 | 2 | EMBR-01/02/03 | automated | `grep -c "\[x\].*EMBR-0[123]" .planning/REQUIREMENTS.md` = 3 | ✅ | ⬜ pending |
| 04-01-07 | 01 | 2 | Metadata | automated | `grep "requirements-completed" .planning/phases/01-mcp-pricing-tool/01-01-SUMMARY.md` | ✅ | ⬜ pending |
| 04-01-08 | 01 | 2 | Metadata | automated | `grep "requirements-completed" .planning/phases/03-cleanup-and-event-context/03-01-SUMMARY.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `.planning/phases/02-ember-prompt-update/02-VERIFICATION.md` — must be created (primary deliverable)

*This is the only Wave 0 gap. All other verification targets are existing files that will be edited.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| lisa Railway container serves current SKILL.md | EMBR-01 (deployment) | Requires Railway API or SSH check | Attempt `oc-sync push lisa workspace/skills/nightlife-concierge/SKILL.md`; document outcome |
| Re-audit shows 0 orphaned requirements | Success Criteria 3 | Requires holistic review of all planning files | Run `/gsd:audit-milestone` or manual audit comparison after all edits |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
