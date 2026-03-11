---
phase: 05
slug: agent-workspace-sync
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-11
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | No test framework — documentation/deployment phase |
| **Config file** | n/a |
| **Quick run command** | `grep -c "get_vip_table_chart\|get_vip_table_availability" ~/Apps/openclaw-ember/workspace/AGENTS.md ~/Apps/openclaw-mamad/workspace/AGENTS.md ~/Apps/openclaw-lisa/workspace/AGENTS.md` |
| **Full suite command** | Quick run + `grep -c "busy_night\|pricing_approximate" ~/Apps/openclaw-ember/workspace/SKILL.md` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command (grep checks)
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must show 0 stale refs, field guidance present
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SC-1 (AGENTS.md stale refs) | structural | `grep -c "get_vip_table_chart\|get_vip_table_availability" <AGENTS.md files>` → must be 0 | ✅ | ⬜ pending |
| 05-01-02 | 01 | 1 | SC-2 (SKILL.md field guidance) | structural | `grep -c "busy_night\|pricing_approximate" <SKILL.md>` → must be > 0 | ✅ | ⬜ pending |
| 05-01-03 | 01 | 1 | SC-3 (lisa deploy) | manual | `oc-sync status lisa` or Railway dashboard | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No test framework install needed — all verification is structural (grep) and manual (deployment check).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| lisa Railway container serves current SKILL.md | SC-3 | Requires live container + network | 1. Check lisa container status, 2. Deploy if online, 3. Verify SKILL.md content via SSH or oc-sync |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-11
