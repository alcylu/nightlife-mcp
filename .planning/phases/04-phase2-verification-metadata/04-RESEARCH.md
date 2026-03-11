# Phase 4: Phase 2 Verification & Metadata Hygiene - Research

**Researched:** 2026-03-11
**Domain:** GSD process documentation — writing a VERIFICATION.md for a completed phase, fixing SUMMARY frontmatter gaps, re-auditing orphaned requirements
**Confidence:** HIGH — all findings from direct inspection of live planning files, SKILL.md files, and audit report

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EMBR-01 | Ember SKILL.md updated to use `get_vip_pricing` instead of old two-tool flow | VERIFIED DONE: `grep -c "get_vip_pricing"` returns 10. Zero references to `get_vip_table_availability` or `get_vip_table_chart` in SKILL.md. Needs VERIFICATION.md to formally close. |
| EMBR-02 | Ember SKILL.md includes mandatory confirmation gate before calling `create_vip_booking_request` | VERIFIED DONE: "MANDATORY CONFIRMATION GATE" present at step 7 of VIP Booking Flow. Needs VERIFICATION.md to formally close. |
| EMBR-03 | Ember SKILL.md explicitly states table chart is layout reference only — do not infer availability from image | VERIFIED DONE: "CRITICAL: The table chart is a LAYOUT REFERENCE ONLY" present in VIP Table Chart section. Needs VERIFICATION.md to formally close. |
</phase_requirements>

---

## Summary

Phase 4 is pure documentation work. There is no TypeScript code to write, no DB changes, no API work, and no SKILL.md editing. The deliverable is a VERIFICATION.md for Phase 2 and frontmatter corrections to existing SUMMARY files.

The underlying implementation work for EMBR-01/02/03 was confirmed complete during research. Direct grep inspection of the four generic openclaw SKILL.md files (ember, mamad, lisa/workspace, lisa/workspace-template) shows all three requirement criteria are satisfied: 10 references to `get_vip_pricing`, zero references to old tools, "MANDATORY CONFIRMATION GATE" present, "LAYOUT REFERENCE ONLY" present. The gap is purely process: Phase 2 ended without a VERIFICATION.md being created, so the audit correctly flags these as orphaned.

The metadata hygiene work (SUMMARY frontmatter `requirements-completed` fields) affects 4 SUMMARY files across Phases 1-3. The audit identifies 10 requirements that were verified in VERIFICATION.md but not listed in any SUMMARY's `requirements-completed` field. Fixing these is a pure frontmatter editing task.

**Primary recommendation:** Write Phase 2 VERIFICATION.md by running the grep/diff checks from 02-VALIDATION.md's verification map, document the results, and mark PASSED. Then patch the 4 SUMMARY files with missing `requirements-completed` entries. Then update REQUIREMENTS.md traceability table to mark EMBR-01/02/03 complete.

---

## Standard Stack

### Core
| Tool | Purpose | Why |
|------|---------|-----|
| GSD VERIFICATION.md format | Phase verification document | Matches existing Phase 1 and Phase 3 VERIFICATION.md patterns — planner must use identical structure |
| SUMMARY.md frontmatter `requirements-completed` field | Traceability metadata | Already used in 01-02, 01-03, 02-01 SUMMARY files — the gap is that 01-01, 01-03 (for some reqs), and 03-01 omit reqs that were actually completed |
| bash grep/diff commands | Evidence gathering for VERIFICATION.md | Phase 2 validation uses grep, not a test runner — commands documented in 02-VALIDATION.md |

### Files That Need Editing

| File | Change | Scope |
|------|--------|-------|
| `.planning/phases/02-ember-prompt-update/02-VERIFICATION.md` | CREATE new file | Phase 2 gap — the critical missing artifact |
| `.planning/phases/01-mcp-pricing-tool/01-01-SUMMARY.md` | ADD `requirements-completed: [VPRC-01, VPRC-02, VPRC-03, VPRC-04, VPRC-05, VPRC-06, VPRC-09]` to frontmatter | Currently missing; these were completed in Plan 01-01 per Phase 1 VERIFICATION.md |
| `.planning/phases/01-mcp-pricing-tool/01-03-SUMMARY.md` | Confirm `requirements-completed: [REST-01, REST-02]` already present | Already present — no change needed |
| `.planning/phases/03-cleanup-and-event-context/03-01-SUMMARY.md` | ADD `requirements-completed: [VPRC-07, VPRC-08, LIFE-01]` to frontmatter | Currently missing the `requirements-completed` key entirely |
| `.planning/REQUIREMENTS.md` | Change `[ ]` to `[x]` for EMBR-01, EMBR-02, EMBR-03; update traceability status from "Pending" to "Complete" | Currently shows `[ ]` and "Pending" for all three |

**Note:** The 01-02-SUMMARY.md already has `requirements-completed: [LIFE-02]` — no change needed. The 02-01-SUMMARY.md already has `requirements-completed: [EMBR-01, EMBR-02, EMBR-03]` — no change needed. These are the only two SUMMARY files with the field currently.

### Verification Commands Available

From `02-VALIDATION.md` (these can be run in Phase 4 to gather evidence):

```bash
EMBER="/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md"
MAMAD="/Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md"
LISA="/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md"
LISAT="/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md"

# EMBR-01: old tools absent (must return 0)
grep -c "get_vip_table_availability\|get_vip_table_chart" "$EMBER"

# EMBR-01: new tool present (must be >= 3)
grep -c "get_vip_pricing" "$EMBER"

# EMBR-02: confirmation gate present (must have match)
grep -i "MANDATORY CONFIRMATION GATE\|explicitly confirms\|Would you like me to submit" "$EMBER"

# EMBR-03: layout-only guardrail present (must have match)
grep -i "LAYOUT REFERENCE ONLY" "$EMBER"

# Byte-for-byte identity checks (all must return empty)
diff "$EMBER" "$MAMAD"
diff "$EMBER" "$LISA"
diff "$EMBER" "$LISAT"
```

**Current verified results (from research):**
- Old tool references in SKILL.md: 0 (confirmed)
- `get_vip_pricing` count in SKILL.md: 10 (confirmed)
- "MANDATORY CONFIRMATION GATE" present: yes (confirmed at line 111)
- "LAYOUT REFERENCE ONLY" present: yes (confirmed at line 175)
- ember vs mamad diff: IDENTICAL (confirmed)
- ember vs lisa/workspace diff: IDENTICAL (confirmed)

---

## Architecture Patterns

### VERIFICATION.md Structure (follow Phase 1 and Phase 3 format exactly)

```markdown
---
phase: 02-ember-prompt-update
verified: {ISO timestamp}
status: passed
score: {N}/{N} must-haves verified
re_verification: false
---

# Phase 2: Ember Prompt Update — Verification Report

**Phase Goal:** ...
**Verified:** ...
**Status:** PASSED
**Re-verification:** No — initial verification (post-hoc)

## Goal Achievement

### Observable Truths
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
...

### Required Artifacts
| Artifact | Expected | Status | Details |
...

### Key Link Verification
| From | To | Via | Status | Details |
...

### Requirements Coverage
| Requirement | Source Plan | Description | Status | Evidence |
...

### Human Verification Required
...

### Gaps Summary
...

## Commit Verification
...
```

This is the exact structure used in `01-VERIFICATION.md` (10/10 score) and `03-VERIFICATION.md` (7/7 score). Do not deviate.

### SUMMARY Frontmatter Pattern

```yaml
---
phase: 01-mcp-pricing-tool
plan: "01"
...
requirements-completed:
  - VPRC-01
  - VPRC-02
  - VPRC-03
  - VPRC-04
  - VPRC-05
  - VPRC-06
  - VPRC-09
---
```

OR inline list:

```yaml
requirements-completed: [VPRC-01, VPRC-02, VPRC-03, VPRC-04, VPRC-05, VPRC-06, VPRC-09]
```

Both formats are used in existing files. Use whichever matches the target file's existing style. The 01-01-SUMMARY.md uses no `requirements-completed` key at all — add it. The 03-01-SUMMARY.md also has no `requirements-completed` key — add it.

### Requirements-Completed Gap Map

The audit report identified 10 requirements verified in VERIFICATION.md but missing from SUMMARY `requirements-completed` fields:

| REQ-ID | Verified In | Should Be In SUMMARY |
|--------|-------------|----------------------|
| VPRC-01 | Phase 1 VERIFICATION.md | 01-01-SUMMARY.md |
| VPRC-02 | Phase 1 VERIFICATION.md | 01-01-SUMMARY.md |
| VPRC-03 | Phase 1 VERIFICATION.md | 01-01-SUMMARY.md |
| VPRC-04 | Phase 1 VERIFICATION.md | 01-01-SUMMARY.md |
| VPRC-05 | Phase 1 VERIFICATION.md | 01-01-SUMMARY.md |
| VPRC-06 | Phase 1 VERIFICATION.md | 01-01-SUMMARY.md |
| VPRC-09 | Phase 1 VERIFICATION.md | 01-01-SUMMARY.md |
| VPRC-07 | Phase 3 VERIFICATION.md | 03-01-SUMMARY.md |
| VPRC-08 | Phase 3 VERIFICATION.md | 03-01-SUMMARY.md |
| LIFE-01 | Phase 3 VERIFICATION.md | 03-01-SUMMARY.md |

Note: LIFE-02 is in 01-02-SUMMARY.md already. REST-01 and REST-02 are in 01-03-SUMMARY.md already. EMBR-01/02/03 are in 02-01-SUMMARY.md already. Only the above 10 are missing.

### Anti-Patterns to Avoid

- **Don't re-run the Phase 2 work.** The SKILL.md has already been correctly updated. VERIFICATION.md documents that it was done — it does not redo it.
- **Don't create a new VERIFICATION.md for Phases 1 or 3.** Those already exist and passed. Only Phase 2 needs one.
- **Don't omit the post-hoc note.** Because Phase 2 was completed without a VERIFICATION.md, the document should acknowledge it is "initial verification (post-hoc)" in the header. See the re_verification frontmatter field.
- **Don't change REQUIREMENTS.md checkbox from `[x]` to something else.** The audit notes REQUIREMENTS.md shows `[ ]` for EMBR-01/02/03 — these need to be changed to `[x]` in REQUIREMENTS.md (the file currently shows them unchecked because the last update reset them to Pending on 2026-03-11).
- **Don't update STATE.md.** STATE.md is managed by GSD tools, not manually edited in plan tasks.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verifying SKILL.md content | Reading file and eyeballing | grep commands from 02-VALIDATION.md | Commands already written, produce unambiguous output counts |
| Writing VERIFICATION.md structure | Inventing new format | Copy Phase 1 or Phase 3 VERIFICATION.md structure exactly | Consistent structure is required for audit tooling to parse correctly |
| Checking SUMMARY gaps | Manual audit | The gap map table above | Already computed from v1.0 audit report |

---

## Common Pitfalls

### Pitfall 1: Confusing "orphaned" with "not implemented"
**What goes wrong:** Treating EMBR-01/02/03 as requiring implementation work rather than documentation work.
**Why it happens:** Audit status "orphaned" sounds severe. In this project, it means "work is done but VERIFICATION.md is missing."
**How to avoid:** Read the audit's evidence field: "Work was done but never formally verified." The task is to write the VERIFICATION.md, not redo the implementation.
**Warning signs:** Plan tasks that involve editing SKILL.md files.

### Pitfall 2: Missing the lisa Railway deploy loose end
**What goes wrong:** VERIFICATION.md passes all checks but ignores the known issue that lisa Railway container was offline at Phase 2 deploy time.
**Why it happens:** Local files are identical (confirmed), but Railway container may still serve old SKILL.md.
**How to avoid:** VERIFICATION.md should document this as a residual risk: local files verified, Railway push to lisa deferred from Phase 2. Phase 4 should attempt to push to lisa if possible. Include in the "Human Verification Required" section rather than blocking PASSED status (ember + mamad are both live, lisa is lower-priority).
**Verification:** Run `oc-sync push lisa workspace/skills/nightlife-concierge/SKILL.md` to close the deferred deploy.

### Pitfall 3: AGENTS.md stale references remain after Phase 4
**What goes wrong:** Phase 4 closes EMBR-01/02/03 via VERIFICATION.md, but AGENTS.md files in ember/mamad/lisa workspaces still reference `get_vip_table_availability` and `get_vip_table_chart`.
**Why it happens:** The audit flagged this as a "low-moderate" severity integration risk. It was not part of the original Phase 2 plan scope.
**How to avoid:** Phase 4 is an opportunity to fix these one-liner changes. Each of the 3 AGENTS.md files (ember/workspace/AGENTS.md line 200, mamad/workspace/AGENTS.md line 186, lisa/workspace/AGENTS.md line 165) has a single line: "For table chart or availability asks, attempt `get_vip_table_chart` / `get_vip_table_availability` first, then report results." This should be updated to reference `get_vip_pricing`. Closing this now avoids a re-audit finding.
**Impact if left:** AGENTS.md and SKILL.md would give contradictory tool guidance. Low risk (SKILL.md takes precedence for skill-specific behavior), but creates confusion.

### Pitfall 4: Frontmatter key placement
**What goes wrong:** `requirements-completed` is added to the wrong section of SUMMARY frontmatter (e.g., after the closing `---`).
**Why it happens:** YAML frontmatter must be between the opening and closing `---` delimiters.
**How to avoid:** Look at the 01-02-SUMMARY.md frontmatter — `requirements-completed: [LIFE-02]` appears as a top-level key in the YAML block. Follow the same pattern.

### Pitfall 5: REQUIREMENTS.md traceability table not updated
**What goes wrong:** VERIFICATION.md is written and SUMMARY files are patched, but REQUIREMENTS.md still shows EMBR-01/02/03 with `[ ]` checkboxes and "Pending" status.
**Why it happens:** Three separate artifacts need updating for a requirement to be fully closed (REQUIREMENTS.md checkbox, REQUIREMENTS.md traceability table, VERIFICATION.md).
**How to avoid:** The last step of Phase 4 execution should be updating REQUIREMENTS.md to change `[ ]` → `[x]` for EMBR-01/02/03 and updating the traceability table status from "Pending" to "Complete."

---

## Code Examples

### Phase 2 VERIFICATION.md "Observable Truths" Table

These are the truths to verify, with evidence from current codebase state:

```markdown
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ember SKILL.md contains zero references to `get_vip_table_availability` or `get_vip_table_chart` | VERIFIED | `grep -c "get_vip_table_availability\|get_vip_table_chart" SKILL.md` returns 0 across all 4 generic instances |
| 2 | ember SKILL.md references `get_vip_pricing` at least 3 times (Tool Contract, VIP Booking Flow, Freshness Rule) | VERIFIED | `grep -c "get_vip_pricing"` returns 10 in ember SKILL.md |
| 3 | VIP Booking Flow step 7 is a MANDATORY CONFIRMATION GATE — "Do NOT call `create_vip_booking_request` until you have explicit confirmation" | VERIFIED | "MANDATORY CONFIRMATION GATE" present at line 111 of ember SKILL.md |
| 4 | VIP Table Chart section has CRITICAL guardrail: "LAYOUT REFERENCE ONLY" with "Never infer table availability from the image" | VERIFIED | "CRITICAL: The table chart is a LAYOUT REFERENCE ONLY" present at line 175 of ember SKILL.md |
| 5 | All four generic SKILL.md files are byte-for-byte identical (ember, mamad, lisa/workspace, lisa/workspace-template) | VERIFIED | `diff ember mamad` = empty, `diff ember lisa` = empty, `diff ember lisa-template` = empty |
| 6 | Updated SKILL.md is deployed to ember Railway container | VERIFIED | `oc-sync push ember` succeeded at Phase 2 execution time (commit 2515ce7 in openclaw/sync repo) |
| 7 | Updated SKILL.md is deployed to mamad Railway container | VERIFIED | `oc-sync push mamad` succeeded at Phase 2 execution time |
```

### Residual Risk to Document

```markdown
### Residual Risk (document in VERIFICATION.md, not a blocker for PASSED status)

| Risk | Status | Action |
|------|--------|--------|
| lisa Railway container deploy deferred | Pending | Container was offline at Phase 2 deploy time. Local file is correct. Push when container is online. Phase 4 plan should include this push. |
| AGENTS.md stale tool references | Low-moderate | ember/mamad/lisa workspace AGENTS.md files reference old tools in one line each. SKILL.md overrides for skill-specific behavior, but AGENTS.md should be updated for consistency. |
```

### 01-01-SUMMARY.md Frontmatter Patch

The current frontmatter (lines 1-36) has no `requirements-completed` key. Add it before the closing `---`:

```yaml
requirements-completed: [VPRC-01, VPRC-02, VPRC-03, VPRC-04, VPRC-05, VPRC-06, VPRC-09]
```

This matches the inline list style used in 01-02-SUMMARY.md and 01-03-SUMMARY.md.

### 03-01-SUMMARY.md Frontmatter Patch

The current frontmatter (lines 1-32) has no `requirements-completed` key. Add it before the closing `---`:

```yaml
requirements-completed: [VPRC-07, VPRC-08, LIFE-01]
```

### REQUIREMENTS.md Changes

Three checkboxes to update (lines 34-36):

```markdown
# Change from:
- [ ] **EMBR-01**: ...
- [ ] **EMBR-02**: ...
- [ ] **EMBR-03**: ...

# Change to:
- [x] **EMBR-01**: ...
- [x] **EMBR-02**: ...
- [x] **EMBR-03**: ...
```

And in the traceability table (lines 80-82), update Status column:

```markdown
| EMBR-01 | Phase 4 | Complete |
| EMBR-02 | Phase 4 | Complete |
| EMBR-03 | Phase 4 | Complete |
```

---

## State of the Art

| Old State | Current State | What Phase 4 Does |
|-----------|---------------|-------------------|
| Phase 2 has no VERIFICATION.md | Phase 2 work confirmed done in SKILL.md | Creates VERIFICATION.md to formally close |
| EMBR-01/02/03 orphaned (no verification file) | Implementation confirmed present | Moves to "verified complete" via VERIFICATION.md |
| 10 SUMMARY files missing `requirements-completed` | Reqs are in VERIFICATION.md but not SUMMARY | Patches 2 SUMMARY files with missing keys |
| REQUIREMENTS.md shows `[ ]` for EMBR-01/02/03 | Work done | Updates checkboxes to `[x]` |
| Re-audit shows 3 orphaned reqs | — | Re-audit after Phase 4 should show 0 orphaned reqs |

---

## Open Questions

1. **Should Phase 4 attempt the deferred lisa Railway deploy?**
   - What we know: lisa container was offline at Phase 2 deploy time. Local file is correct and identical to ember.
   - What's unclear: Whether lisa container is back online now.
   - Recommendation: Include a task to attempt `oc-sync push lisa workspace/skills/nightlife-concierge/SKILL.md`. If it succeeds, document in VERIFICATION.md. If it fails, note as still-deferred.

2. **Should Phase 4 fix the AGENTS.md stale references?**
   - What we know: 3 AGENTS.md files (ember, mamad, lisa) each have one line referencing old tools. The audit flagged this as low-moderate severity. It is a 1-line fix per file.
   - What's unclear: Whether this is in scope for "Phase 2 Verification & Metadata Hygiene."
   - Recommendation: Include it as a task. It is minimal effort (3 single-line edits), it closes the audit finding, and it prevents confusion from contradictory tool references. The alternative is leaving it as tech debt for Phase 5.

3. **Does the VERIFICATION.md need to reference the commit hash from the openclaw/sync repo?**
   - What we know: Phase 1 VERIFICATION.md references nightlife-mcp commit hashes. The Phase 2 work happened in a separate repo (openclaw/sync, commit 2515ce7).
   - Recommendation: Reference the commit hash in VERIFICATION.md as evidence. The cross-repo commit is valid evidence — it shows when the SKILL.md change was committed.

---

## Validation Architecture

Phase 4 is documentation-only. Validation is grep-based:

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Manual grep/diff — no automated test runner applies to planning documents |
| Config file | None |
| Quick run command | `grep -c "get_vip_table_availability\|get_vip_table_chart" /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` (must be 0) |
| Full suite command | All 7 grep/diff checks from the verification commands above |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EMBR-01 | No old tool refs in SKILL.md | automated | `grep -c "get_vip_table_availability\|get_vip_table_chart" .../ember/.../SKILL.md` = 0 | ✅ |
| EMBR-01 | `get_vip_pricing` used throughout SKILL.md | automated | `grep -c "get_vip_pricing" .../ember/.../SKILL.md` >= 3 | ✅ |
| EMBR-02 | Confirmation gate present in SKILL.md | automated | `grep -i "MANDATORY CONFIRMATION GATE" .../ember/.../SKILL.md` has match | ✅ |
| EMBR-03 | Layout-only guardrail present in SKILL.md | automated | `grep -i "LAYOUT REFERENCE ONLY" .../ember/.../SKILL.md` has match | ✅ |
| EMBR-01/02/03 | VERIFICATION.md exists for Phase 2 | file existence | `ls .planning/phases/02-ember-prompt-update/02-VERIFICATION.md` | ❌ Wave 0 |
| EMBR-01/02/03 | REQUIREMENTS.md shows `[x]` for all three | automated | `grep -c "\[x\].*EMBR-0[123]" .planning/REQUIREMENTS.md` = 3 | ✅ |
| Metadata hygiene | 01-01-SUMMARY.md has requirements-completed | automated | `grep "requirements-completed" .planning/phases/01-mcp-pricing-tool/01-01-SUMMARY.md` has match | ✅ will pass after edit |
| Metadata hygiene | 03-01-SUMMARY.md has requirements-completed | automated | `grep "requirements-completed" .planning/phases/03-cleanup-and-event-context/03-01-SUMMARY.md` has match | ✅ will pass after edit |

### Sampling Rate
- **Per task commit:** Check that the target file was modified correctly (grep or diff)
- **Per wave merge:** Run full grep check on REQUIREMENTS.md for `[x]` status
- **Phase gate:** Confirm re-audit shows 0 orphaned requirements

### Wave 0 Gaps
- [ ] `.planning/phases/02-ember-prompt-update/02-VERIFICATION.md` — must be created (this is the primary deliverable)

---

## Sources

### Primary (HIGH confidence)
- Direct inspection: `.planning/v1.0-MILESTONE-AUDIT.md` — audit findings, orphaned requirements, metadata gaps, AGENTS.md stale references
- Direct inspection: `.planning/REQUIREMENTS.md` — current checkbox status, traceability table
- Direct inspection: `.planning/phases/02-ember-prompt-update/02-01-SUMMARY.md` — what Phase 2 accomplished
- Direct inspection: `.planning/phases/02-ember-prompt-update/02-01-PLAN.md` — original plan must_haves and success criteria
- Direct inspection: `.planning/phases/02-ember-prompt-update/02-VALIDATION.md` — grep commands available for verification
- Direct inspection: `/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` — live state: 10 `get_vip_pricing` refs, 0 old tool refs, MANDATORY CONFIRMATION GATE present, LAYOUT REFERENCE ONLY present
- Direct inspection: Diff results — ember vs mamad vs lisa vs lisa-template: all IDENTICAL
- Direct inspection: `.planning/phases/01-mcp-pricing-tool/01-VERIFICATION.md` — reference format for VERIFICATION.md structure
- Direct inspection: `.planning/phases/03-cleanup-and-event-context/03-VERIFICATION.md` — reference format for VERIFICATION.md structure
- Direct inspection: `.planning/phases/01-mcp-pricing-tool/01-01-SUMMARY.md` — confirms no `requirements-completed` key currently
- Direct inspection: `.planning/phases/03-cleanup-and-event-context/03-01-SUMMARY.md` — confirms no `requirements-completed` key currently
- Direct grep: `ember/workspace/AGENTS.md` line 200, `mamad/workspace/AGENTS.md` line 186, `lisa/workspace/AGENTS.md` line 165 — stale old-tool references confirmed

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — Phase 2 decision log confirming lisa Railway container offline issue
- `.planning/phases/02-ember-prompt-update/02-RESEARCH.md` — original research documenting what Phase 2 changed

---

## Metadata

**Confidence breakdown:**
- EMBR-01/02/03 implementation state: HIGH — grep confirmed, diff confirmed
- VERIFICATION.md format: HIGH — two existing examples in the project
- SUMMARY frontmatter gaps: HIGH — directly inspected all 5 SUMMARY files
- lisa Railway deploy status: MEDIUM — local files correct, Railway container status unknown at research time
- AGENTS.md stale references: HIGH — grep confirmed in all 3 files

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (SKILL.md content and planning file structure are stable)
