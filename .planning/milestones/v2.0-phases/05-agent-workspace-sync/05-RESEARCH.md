# Phase 5: Agent Workspace Sync - Research

**Researched:** 2026-03-11
**Domain:** OpenClaw workspace files, oc-sync deployment, SKILL.md agent instructions
**Confidence:** HIGH

## Summary

Phase 5 is a documentation/deployment-only phase — no TypeScript, no DB migrations, no new MCP tools. The work is three file edits and one Railway push. All source files have been located, all exact stale references have been identified, and the deployment mechanism is well-understood from Phase 2.

There are two distinct problem classes. First, three AGENTS.md files (ember, mamad, lisa) each contain one stale bullet that tells the agent to use the removed `get_vip_table_chart` / `get_vip_table_availability` tools. The replacement instruction is to use `get_vip_pricing` for both chart and pricing queries. Second, the shared SKILL.md VIP Presentation Rule section has no guidance on the `busy_night` and `pricing_approximate` response fields that were added in Phase 3. Agents receiving these fields have no instructions on how to use them, which means they are silently ignored.

The lisa Railway container was offline during Phase 2 deployment. The local SKILL.md is already correct (byte-for-byte identical to ember/mamad) but the remote container has not received the latest push. The oc-sync tool and Railway tokens are both in place.

**Primary recommendation:** Edit ember AGENTS.md, copy to mamad/lisa, then add `busy_night`/`pricing_approximate` field guidance to the shared SKILL.md (copy to mamad/lisa), then push all changed files to all three Railway containers.

---

## Standard Stack

### Core Tools

| Tool | Location | Purpose |
|------|----------|---------|
| `oc-sync` | `/Users/alcylu/Apps/openclaw/sync/oc-sync` | Push/pull files to Railway OpenClaw containers |
| Railway tokens | `~/.railway/tokens.env` | Per-project scoped tokens (no `railway link` needed) |
| SKILL.md | `sync/instances/{name}/workspace/skills/nightlife-concierge/SKILL.md` | Agent skill instructions |
| AGENTS.md | `sync/instances/{name}/workspace/AGENTS.md` | Per-instance boot sequence + capability rules |

### Instance Registry

All three target instances are registered in `instances.conf` and share the same Railway project/environment:

| Instance | Railway Project | Service ID |
|----------|----------------|-----------|
| ember | `305e5faf-f2ca-45f1-9a4a-19f9193be58b` | `d736589f-b450-4062-841b-76769a57f0e8` |
| mamad | `305e5faf-f2ca-45f1-9a4a-19f9193be58b` | `0a2f522c-dca3-4b06-a912-e0abfd3e4f1d` |
| lisa | `305e5faf-f2ca-45f1-9a4a-19f9193be58b` | `8950d37a-c458-4def-90b8-7c12700c8b86` |

All three share token `RAILWAY_TOKEN_OC_EMBER` (same project). Verified in `~/.railway/tokens.env`.

### Push Commands

```bash
cd /Users/alcylu/Apps/openclaw/sync
source ~/.railway/tokens.env

# Push AGENTS.md to each instance
./oc-sync push ember workspace/AGENTS.md
./oc-sync push mamad workspace/AGENTS.md
./oc-sync push lisa workspace/AGENTS.md

# Push SKILL.md to each instance + lisa workspace-template
./oc-sync push ember workspace/skills/nightlife-concierge/SKILL.md
./oc-sync push mamad workspace/skills/nightlife-concierge/SKILL.md
./oc-sync push lisa workspace/skills/nightlife-concierge/SKILL.md
./oc-sync push-style: lisa workspace-template/skills/nightlife-concierge/SKILL.md
```

Note: `oc-sync push` will prompt "Continue without a fresh pull? [y/N]" if last pull is stale — answer y.
It will also show a diff and prompt for confirmation — answer y.

---

## Architecture Patterns

### File Sync Pattern (from Phase 2)

The established pattern from Phase 2 is:
1. Edit the ember copy as the canonical source
2. Copy byte-for-byte to mamad and lisa (and lisa/workspace-template for SKILL.md)
3. Verify diffs are empty before pushing
4. Push each file to each instance individually via `oc-sync push <instance> <path>`

**NEVER touch `oneoak`** — it has a venue-specific variant that is intentionally different.

### Path Mapping (local to remote)

| Local path | Remote path |
|------------|-------------|
| `instances/ember/workspace/AGENTS.md` | `/data/workspace/AGENTS.md` |
| `instances/mamad/workspace/AGENTS.md` | `/data/workspace/AGENTS.md` |
| `instances/lisa/workspace/AGENTS.md` | `/data/workspace/AGENTS.md` |
| `instances/ember/workspace/skills/nightlife-concierge/SKILL.md` | `/data/workspace/skills/nightlife-concierge/SKILL.md` |
| `instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md` | `/data/workspace-template/skills/nightlife-concierge/SKILL.md` |

---

## Exact Stale References to Remove

### AGENTS.md: One Line in Each Instance

The stale content appears in the "MCP-First Rule — Quick Reference" section (ember, mamad) and "Nightlife Capability Guardrail" section (lisa). In all three files, the same bullet exists at slightly different line numbers:

```
- For table chart or availability asks, attempt `get_vip_table_chart` / `get_vip_table_availability` first, then report results.
```

**ember/workspace/AGENTS.md** — line 200 (in "MCP-First Rule — Quick Reference" section)
**mamad/workspace/AGENTS.md** — line 186 (in "MCP-First Rule — Quick Reference" section)
**lisa/workspace/AGENTS.md** — line 165 (in "Nightlife Capability Guardrail" section)

**Replacement text:**
```
- For table chart or pricing asks, call `get_vip_pricing` — it returns both pricing ranges and `layout_image_url` (the table chart) in a single response.
```

### Context around the stale line (all three files share this structure)

```
- Never say a VIP or table feature is unavailable unless an actual tool call fails in the current turn.
- For table chart or availability asks, attempt `get_vip_table_chart` / `get_vip_table_availability` first, then report results.  ← REMOVE THIS LINE
- When calling `create_vip_booking_request`, always set `OPENCLAW_CHANNEL` and `OPENCLAW_TARGET` env vars...
```

Only the middle bullet changes. The surrounding lines stay.

---

## SKILL.md: What Needs Adding

### Current State of VIP Presentation Rule

The VIP Presentation Rule section (line 186 in ember SKILL.md) currently reads:

```markdown
## VIP Presentation Rule

Always present event context alongside table info. Present per-zone pricing — never flatten zones into a single number.

**CRITICAL: Present pricing BY ZONE when zones have different prices.** The `get_vip_pricing` response includes per-zone `weekday_min_spend` and `weekend_min_spend`. Show them individually.

Good:
> "This Saturday at Warp — DJ SET with [artist], doors at 22:00. For VIP: weekday minimums from ~¥55K, weekend from ~¥110K. Want me to put in a request?"
> "Zouk has 4 zones — Premium Stage from ¥100K, Lower Dance Floor from ¥200K, Upper Dance Floor from ¥150K, Mezzanine from ¥50K. These are weekday minimums — weekends are higher."

Bad:
> "Zouk is fully open this week — all 24 tables available."
> (You do NOT know how many tables are available — only the venue knows.)
> "Pricing is ¥100,000 regardless of zone."
> (WRONG — each zone has its own minimum. Present per-zone pricing from the response. Use "from" since these are minimums, not fixed prices.)
> "Warp has 2 tables available Saturday. From ¥55K."
> (Missing: who's playing, what's the vibe; "available" implies live status that we don't have)
```

### What's Missing

The `get_vip_pricing` response includes two fields added in Phase 3 (VPRC-07, VPRC-08) that agents have no instructions for:

**`busy_night: boolean`** — `true` when an event is booked at the venue on the requested date. When `true`, the `event_name` field contains the event name. This is the signal that the agent should proactively mention who is playing.

**`pricing_approximate: boolean`** — `true` when pricing comes from venue-level default (`vip_default_min_spend`) rather than per-table day-defaults. When `true`, the agent should use softer language ("around" or "approximately") rather than stating prices as if they are precise.

### Source of Truth: vipPricing.ts

From `/Users/alcylu/Apps/nightlife-mcp/src/services/vipPricing.ts` lines 461-481:
- `busy_night = eventName !== null` — true when any event exists on that date
- `pricing_approximate = dayDefaults.length === 0 && venueDefaultMinSpend !== null` — only true when day-defaults are absent and venue-level default is the only source

From `src/types.ts` lines 580-582:
```typescript
event_name: string | null;       // name of event on requested date
busy_night: boolean;             // true when event exists on requested date
pricing_approximate: boolean;    // true when pricing from venue-level default (no day-defaults)
```

### New Content to Add to VIP Presentation Rule

Append these two subsections after the existing "Bad" examples, before the next `##` heading:

```markdown
### Event Context (`busy_night` and `event_name`)

When `busy_night: true`, the response includes `event_name`. Proactively mention who is playing when presenting pricing — this is what makes the night feel real.

Good:
> "This Saturday at Warp — Takkyu Ishino performing, doors at 22:00. For VIP: weekend tables from ¥110K."
> (busy_night: true + event_name → weave event into the intro)

Bad:
> "For VIP at Warp on Saturday: from ¥110K."
> (Ignores the event context entirely — feels like a price list, not a concierge)

If `busy_night: false` or the date is not specified, just present pricing without an event line.

### Pricing Confidence (`pricing_approximate`)

When `pricing_approximate: true`, pricing comes from a venue-level estimate rather than per-table data. Modulate your language accordingly.

- `pricing_approximate: false` → "weekday minimums from ¥100K" (precise enough to state directly)
- `pricing_approximate: true` → "weekday minimums around ¥100K" or "approximately ¥100K" (softer hedge)

Do NOT say "I'm not sure" or "pricing may vary" generically — only add the hedge word ("around", "approximately") when `pricing_approximate` is explicitly `true`.
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Pushing files to Railway | Manual SSH / railway CLI | `oc-sync push <instance> <path>` |
| Syncing 4 SKILL.md copies | Separate edits per file | Edit ember, cp to mamad/lisa/lisa-template, verify diffs |

---

## Common Pitfalls

### Pitfall 1: Editing mamad/lisa AGENTS.md Directly Without Making Them Identical

**What goes wrong:** The three AGENTS.md files are NOT byte-for-byte identical — they have instance-specific content (lisa lacks the "Known Users" table, mamad has a USER.md step, lisa uses "Lisa" not "Ember/Mamad" in the silent-startup rule). The stale bullet lives in a shared section, but the files around it differ.

**How to avoid:** Edit EACH AGENTS.md individually — target only the stale bullet line. Do NOT copy ember's AGENTS.md over mamad's or lisa's. They share only the one stale bullet; everything else is instance-specific.

**Verification:** After editing, run `grep -n "get_vip_table_chart\|get_vip_table_availability"` on each — must return 0. Then verify the surrounding lines (before and after the changed bullet) are unchanged.

### Pitfall 2: Forgetting lisa workspace-template for SKILL.md

**What goes wrong:** lisa has two local SKILL.md copies: `workspace/skills/nightlife-concierge/SKILL.md` and `workspace-template/skills/nightlife-concierge/SKILL.md`. Both must be updated. Phase 2 set a precedent: all 4 generic SKILL.md copies must be byte-for-byte identical.

**Instances directory:** `sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md`
**Remote path:** `/data/workspace-template/skills/nightlife-concierge/SKILL.md`

### Pitfall 3: lisa Container May Be Offline Again

**What goes wrong:** lisa was offline during Phase 2 push. It may be offline again.

**How to handle:** If `oc-sync push lisa` fails with "Your application is not running", document it as deferred. The local file update is the durable artifact. A follow-up push when the container is online completes the work. The success criteria for this phase requires the CURRENT SKILL.md to be served — so if lisa is offline, the plan should include a human-verify step to confirm or an explicit "retry when online" note.

**Check status first:** `./oc-sync status` shows last pull time and file counts for all instances. If lisa shows 0 files or stale data, the container may be offline.

### Pitfall 4: Session Cache Holds Stale Skill Descriptions

**What goes wrong:** OpenClaw caches skill descriptions in session snapshots. After a SKILL.md push, existing sessions may not pick up the new instructions until the session expires or is cleared.

**How to avoid:** After pushing SKILL.md changes, existing active sessions may need to be cleared or the gateway restarted. This was noted in the openclaw CLAUDE.md: "remember to clear sessions after skill file changes — the gateway caches skill descriptions in session snapshots."

**Manual clear via SSH:**
```bash
source ~/.railway/tokens.env
RAILWAY_TOKEN=$RAILWAY_TOKEN_OC_EMBER railway ssh --service d736589f-b450-4062-841b-76769a57f0e8 -- "rm -f /data/.openclaw/agents/*/sessions/*.lock"
```
(Same pattern for mamad/lisa with their service IDs.)

---

## Code Examples

### Stale Line (to remove from all three AGENTS.md files)

```
- For table chart or availability asks, attempt `get_vip_table_chart` / `get_vip_table_availability` first, then report results.
```

### Replacement Line

```
- For table chart or pricing asks, call `get_vip_pricing` — it returns both pricing ranges and `layout_image_url` (the table chart) in a single response.
```

### VIP Presentation Rule additions (append to SKILL.md section before next `##`)

```markdown
### Event Context (`busy_night` and `event_name`)

When `busy_night: true`, the response includes `event_name`. Proactively mention who is playing when presenting pricing — this is what makes the night feel real.

Good:
> "This Saturday at Warp — Takkyu Ishino performing, doors at 22:00. For VIP: weekend tables from ¥110K."
> (busy_night: true + event_name → weave event into the intro)

Bad:
> "For VIP at Warp on Saturday: from ¥110K."
> (Ignores the event context entirely — feels like a price list, not a concierge)

If `busy_night: false` or the date is not specified, just present pricing without an event line.

### Pricing Confidence (`pricing_approximate`)

When `pricing_approximate: true`, pricing comes from a venue-level estimate rather than per-table data. Modulate your language accordingly.

- `pricing_approximate: false` → "weekday minimums from ¥100K" (precise enough to state directly)
- `pricing_approximate: true` → "weekday minimums around ¥100K" or "approximately ¥100K" (softer hedge)

Do NOT say "I'm not sure" or "pricing may vary" generically — only add the hedge word ("around", "approximately") when `pricing_approximate` is explicitly `true`.
```

### oc-sync push workflow

```bash
# From /Users/alcylu/Apps/openclaw/sync
source ~/.railway/tokens.env

# AGENTS.md (each instance edited individually — NOT copied across)
./oc-sync push ember workspace/AGENTS.md
./oc-sync push mamad workspace/AGENTS.md
./oc-sync push lisa workspace/AGENTS.md

# SKILL.md (all 4 copies must be identical after editing)
./oc-sync push ember workspace/skills/nightlife-concierge/SKILL.md
./oc-sync push mamad workspace/skills/nightlife-concierge/SKILL.md
./oc-sync push lisa workspace/skills/nightlife-concierge/SKILL.md
./oc-sync push lisa workspace-template/skills/nightlife-concierge/SKILL.md
```

### Verification commands

```bash
# AGENTS.md: stale references must be zero in all 3 files
grep -c "get_vip_table_chart\|get_vip_table_availability" \
  /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/AGENTS.md \
  /Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/AGENTS.md \
  /Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/AGENTS.md
# Expected: each file shows 0

# SKILL.md: new field guidance must be present
grep -c "busy_night\|pricing_approximate" \
  /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md
# Expected: >= 2

# SKILL.md: all 4 generic copies must be identical
diff /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md \
     /Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md && echo "IDENTICAL"
diff /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md \
     /Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md && echo "IDENTICAL"
diff /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md \
     /Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md && echo "IDENTICAL"
```

---

## Validation Architecture

`nyquist_validation: true` in `.planning/config.json`. Phase 5 is documentation/deployment only — no TypeScript source changes, no test surface. There are no automated tests for workspace file content; validation is structural (grep checks) and live (human-verify the deployed container).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | No test framework for workspace files |
| Config file | n/a |
| Quick run command | `grep -c "get_vip_table_chart\|get_vip_table_availability" <AGENTS.md files>` |
| Full suite command | All verification greps + oc-sync diff checks |

### Phase Requirements → Test Map

This phase has no formal requirement IDs. Success criteria map to structural checks:

| Success Criterion | Test Type | Automated Command |
|-------------------|-----------|-------------------|
| AGENTS.md stale refs removed (ember) | structural | `grep -c "get_vip_table_chart\|get_vip_table_availability" .../ember/workspace/AGENTS.md` → must be 0 |
| AGENTS.md stale refs removed (mamad) | structural | `grep -c "get_vip_table_chart\|get_vip_table_availability" .../mamad/workspace/AGENTS.md` → must be 0 |
| AGENTS.md stale refs removed (lisa) | structural | `grep -c "get_vip_table_chart\|get_vip_table_availability" .../lisa/workspace/AGENTS.md` → must be 0 |
| SKILL.md has busy_night guidance | structural | `grep -c "busy_night" .../ember/.../SKILL.md` → must be >= 1 |
| SKILL.md has pricing_approximate guidance | structural | `grep -c "pricing_approximate" .../ember/.../SKILL.md` → must be >= 1 |
| 4 SKILL.md copies identical | structural | `diff ember SKILL.md mamad SKILL.md` → empty |
| lisa container serves current SKILL.md | live | `oc-sync diff lisa` or human test via Railway |

### Sampling Rate

- **Per task commit:** Run the grep checks above
- **Per wave merge:** Full verification greps + oc-sync diff for all 3 instances
- **Phase gate:** All greps pass and lisa container push confirmed (or explicitly deferred with documented reason)

### Wave 0 Gaps

None — no test infrastructure needed for this phase. Structural verification is via grep, deployment verification is via oc-sync diff.

---

## Open Questions

1. **Is lisa container currently online?**
   - What we know: It was offline during Phase 2 (2026-03-11). It shares a Railway project with ember, oneoak, and mamad.
   - What's unclear: Current status as of this research.
   - Recommendation: Run `oc-sync status` at the start of the plan task. If lisa is offline, update local files and document the push as deferred — do not block plan completion on it. The phase success criterion is "lisa serves the current SKILL.md", so the plan should include a human-verify step to confirm the container is reachable.

2. **Do sessions need to be cleared after pushing?**
   - What we know: openclaw caches skill descriptions in session snapshots. The note in CLAUDE.md says to clear sessions after skill file changes.
   - What's unclear: Whether the AGENTS.md change triggers the same caching issue (AGENTS.md is loaded fresh each session, not cached in skill descriptions per the workspace files table).
   - Recommendation: SKILL.md changes need session clearing; AGENTS.md changes probably don't (it's read every boot, not stored as a skill description). Include session clearing as a step for SKILL.md push only.

---

## Sources

### Primary (HIGH confidence)

All findings are based on direct file inspection — no external research needed for this phase.

- `/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/AGENTS.md` — confirmed stale bullet at line 200
- `/Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/AGENTS.md` — confirmed stale bullet at line 186
- `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/AGENTS.md` — confirmed stale bullet at line 165
- `/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` — confirmed VIP Presentation Rule at line 186, no busy_night/pricing_approximate guidance
- `/Users/alcylu/Apps/nightlife-mcp/src/services/vipPricing.ts` — confirmed field semantics (busy_night, pricing_approximate logic)
- `/Users/alcylu/Apps/nightlife-mcp/src/types.ts` — confirmed VipPricingResult interface with field docs
- `/Users/alcylu/Apps/openclaw/sync/oc-sync` — confirmed push command, token resolution, path mapping
- `/Users/alcylu/Apps/openclaw/sync/instances.conf` — confirmed lisa/mamad in registry with correct service IDs
- `~/.railway/tokens.env` — confirmed RAILWAY_TOKEN_OC_LISA and RAILWAY_TOKEN_OC_MAMAD present
- `.planning/phases/02-ember-prompt-update/02-01-SUMMARY.md` — confirmed lisa was offline in Phase 2, established push workflow

---

## Metadata

**Confidence breakdown:**
- File locations and stale content: HIGH — directly verified by reading each file
- oc-sync push workflow: HIGH — established in Phase 2, same commands
- Railway token availability: HIGH — confirmed in tokens.env
- busy_night/pricing_approximate semantics: HIGH — read from types.ts and service source
- Session clearing necessity: MEDIUM — general pattern from CLAUDE.md, specific to SKILL.md only

**Research date:** 2026-03-11
**Valid until:** Stable — file paths and deployment mechanism don't change unless openclaw is restructured
