# Phase 2: Ember Prompt Update - Research

**Researched:** 2026-03-11
**Domain:** OpenClaw SKILL.md authoring — agent behavioral prompt update, multi-instance sync
**Confidence:** HIGH — all findings from direct codebase inspection of live skill files and sync tooling

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EMBR-01 | Ember SKILL.md updated to use `get_vip_pricing` instead of old two-tool flow | Current SKILL.md explicitly lists `get_vip_table_availability` + `get_vip_table_chart` in Tool Contract and VIP Booking Flow. Both must be replaced with `get_vip_pricing`. 4 sections are affected: Tool Contract, VIP Booking Flow, VIP Pricing Freshness Rule, and VIP Table Chart section. |
| EMBR-02 | Ember SKILL.md includes mandatory confirmation gate before calling `create_vip_booking_request` | Current flow at step 8 calls `create_vip_booking_request` immediately after collecting fields, with no confirmation gate. A mandatory "Would you like me to submit an inquiry?" step must be inserted before the tool call. |
| EMBR-03 | Ember SKILL.md explicitly states table chart is layout reference only — do not infer availability from image | The current "VIP Table Chart" section shows the chart image URL and summarizes it, but contains no guardrail against inferring availability from the image. A CRITICAL rule must be added. |
</phase_requirements>

---

## Summary

Phase 2 is a pure documentation/behavioral prompt update. There is no TypeScript code to write, no DB changes, and no API work. The deliverable is an updated SKILL.md in the openclaw sync directory — specifically at `/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md`.

The existing SKILL.md is 223 lines. The update requires targeted rewrites to 5 sections (Tool Contract, VIP Booking Flow, VIP Pricing Freshness Rule, VIP Table Chart, and Venue Lookup) plus the addition of a new Chart Interpretation Guardrail. All other sections (VIP Cancellation Flow, VIP Tone Guardrails, Response Rules, Recommendations, Guest List, Date Clarification, VIP Auto-Follow, VIP Presentation Rule) are unchanged.

The same SKILL.md content exists in 4 other openclaw instances: ember (primary), mamad (identical to ember), lisa/workspace, and lisa/workspace-template. The oneoak instance has a different venue-specific variant that is intentionally NOT updated (per the rule: oneoak is venue-specific, do not copy from ember). After editing local files, changes are pushed to running Railway containers via `oc-sync push`.

**Primary recommendation:** Edit the ember SKILL.md, verify it satisfies all three requirements, then push to ember + mamad + lisa instances using `oc-sync push <instance> workspace/skills/nightlife-concierge/SKILL.md`.

---

## Standard Stack

### Core
| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `oc-sync` (bash script) | — | Push SKILL.md changes to Railway containers | Project's established sync tool for all openclaw workspace file deployments |
| SKILL.md format | — | OpenClaw skill definition — YAML frontmatter + markdown sections | OpenClaw reads skill files at agent boot; structure is fixed by the platform |

### Affected Files

| File | Change Type | Why |
|------|-------------|-----|
| `/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` | MODIFIED | Primary — Ember is the generic nightlife concierge instance |
| `/Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md` | MODIFIED | Identical to ember currently — must stay in sync |
| `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md` | MODIFIED | Lisa also uses the generic nightlife-concierge skill |
| `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md` | MODIFIED | Template that new Lisa instances are built from |
| `/Users/alcylu/Apps/openclaw/sync/instances/oneoak/workspace/skills/nightlife-concierge/SKILL.md` | DO NOT MODIFY | Oneoak uses a venue-specific variant intentionally |

**Installation:** No new dependencies. The `oc-sync` script is already installed at `~/Apps/openclaw/sync/oc-sync`.

**Push command:**
```bash
source ~/.railway/tokens.env
cd /Users/alcylu/Apps/openclaw/sync

# Push to each generic instance
oc-sync push ember workspace/skills/nightlife-concierge/SKILL.md
oc-sync push mamad workspace/skills/nightlife-concierge/SKILL.md
oc-sync push lisa workspace/skills/nightlife-concierge/SKILL.md
```

For lisa's workspace-template, use the lisa push directly (template path varies — verify with `oc-sync ls lisa`).

---

## Architecture Patterns

### SKILL.md Section Map (What Changes vs What Stays)

```
nightlife-concierge/SKILL.md (223 lines)
├── YAML frontmatter              UNCHANGED — description will need update
├── ## Required Environment       UNCHANGED
├── ## Script                     UNCHANGED
├── ## Venue Lookup               PARTIAL UPDATE — remove `get_vip_table_availability` reference
├── ## Tool Contract              REWRITE VIP section — replace old tools with get_vip_pricing
├── ## VIP Booking Flow           REWRITE — replace 2-tool flow, add confirmation gate
│   ├── ### Booking Tone          UNCHANGED
│   ├── ### Flow                  REWRITE steps 2-4, insert confirmation gate before submit
│   ├── ### Date Clarification    UNCHANGED
│   └── ### VIP Auto-Follow       UNCHANGED
├── ## VIP Cancellation Flow      UNCHANGED
├── ## VIP Pricing Freshness Rule REWRITE — update tool name + add freshness note for get_vip_pricing
├── ## VIP Table Chart            REWRITE + ADD GUARDRAIL (EMBR-03)
├── ## VIP Presentation Rule      UNCHANGED (pricing language already correct)
├── ## Recommendations            UNCHANGED
├── ## Guest List Flow            UNCHANGED
├── ## Venue Knowledge            PARTIAL — remove get_vip_table_availability reference
├── ## Response Rules             UNCHANGED
└── ## VIP Tone Guardrails        UNCHANGED
```

### Pattern 1: Rewriting the Tool Contract (EMBR-01)

**What changes:** Remove `get_vip_table_availability` and `get_vip_table_chart` from the VIP Booking section. Add `get_vip_pricing`.

**Current state:**
```markdown
**VIP Booking:**
- `create_vip_booking_request` — Submit VIP table booking
- `get_vip_booking_status` — Check booking status
- `cancel_vip_booking_request` — Cancel a booking (requires email + phone verification)
- `get_vip_table_availability` — Table availability + pricing for date
- `get_vip_table_chart` — Table layout/positioning + floor plan
```

**New state:**
```markdown
**VIP Booking:**
- `create_vip_booking_request` — Submit VIP table booking
- `get_vip_booking_status` — Check booking status
- `cancel_vip_booking_request` — Cancel a booking (requires email + phone verification)
- `get_vip_pricing` — VIP pricing ranges, zone summaries, table chart URL, and booking affordance
```

### Pattern 2: Rewriting the VIP Booking Flow (EMBR-01 + EMBR-02)

**What changes:** Steps 2-4 replace the two-tool browse with one `get_vip_pricing` call. A new mandatory confirmation gate is inserted between "collect fields" and "call create_vip_booking_request".

**Current steps 1-10:**
```
1. User asks about VIP → look up venue_id
2. Call get_vip_table_availability with venue_id + date
3. Call get_vip_table_chart if they ask for floor plan or table positions
4. Also call get_venue_info to see what event is happening that night
5. Present both together
6. Collect required fields conversationally
7. Clarify late-night arrival dates
8. Call create_vip_booking_request  ← directly, no confirmation gate
9. Share booking_request_id
10. Register tracking
```

**New steps:**
```
1. User asks about VIP → look up venue_id
2. Call get_vip_pricing with venue_id (and optional date)
3. Also call get_venue_info to see what event is happening that night
4. Present pricing conversationally (see VIP Presentation Rule) + chart URL if available
5. Collect required fields conversationally
6. Clarify late-night arrival dates
7. CONFIRMATION GATE: Ask "Would you like me to submit an inquiry?" — wait for explicit YES
8. Call create_vip_booking_request only after confirmed YES
9. Share booking_request_id + "I've put in the request — we'll hear back from the venue"
10. Register tracking
```

**EMBR-02 confirmation gate wording guidance (include in SKILL.md):**
- Must be an explicit question, not a rhetorical one
- Agent must wait for user's affirmative before calling the tool
- "Want me to send that over?" / "Shall I put in the request?" / "Ready to submit your inquiry?" are all valid
- NEVER auto-submit: if user hasn't said yes, don't call the tool

### Pattern 3: VIP Table Chart Guardrail (EMBR-03)

**What changes:** The "VIP Table Chart" section currently instructs Ember to show the chart URL and summarize. It needs an explicit CRITICAL guardrail that the image is layout-only — table positions/zones are fixed furniture, not availability status.

**Current section** (lines 149-159) has NO availability guardrail.

**New section must include:**
```markdown
## VIP Table Chart

**CRITICAL: The table chart is a LAYOUT REFERENCE ONLY.** It shows physical positions and zones — it does NOT indicate which tables are available, held, or booked. Never say "Table V3 appears available" based on the image. Never infer status from what you see in the chart.

When asked for table map/positions/layout:

1. Call `get_vip_pricing` with the venue_id (includes layout_image_url if available)
2. If `layout_image_url` is present in the response: share the URL and note it is a seating chart for layout reference
3. If `layout_image_url` is null: let the user know the chart isn't available yet
4. For LINE: send plain `https://...` link, no `MEDIA:` with filesystem paths
5. Never reuse chart links from memory — use fresh tool output
```

Note: The previous flow required calling both `get_vip_table_chart` AND `get_vip_table_availability`. With `get_vip_pricing`, the `layout_image_url` is returned in a single call — no separate chart tool needed.

### Pattern 4: VIP Pricing Freshness Rule Update (EMBR-01)

**What changes:** The "VIP Pricing Freshness Rule" section currently says "make a fresh `get_vip_table_availability` call". The tool name must be updated to `get_vip_pricing`.

**Current:**
```
Every time a user asks about VIP pricing — even for the same date asked earlier — make a fresh `get_vip_table_availability` call.
```

**New:**
```
Every time a user asks about VIP pricing — even for the same venue asked earlier — make a fresh `get_vip_pricing` call.
```

Note: The date phrasing also changes to "same venue" because `get_vip_pricing` is venue-based, not date-based (date is optional).

### Pattern 5: Venue Lookup Section (EMBR-01)

**What changes:** Line 26 references `get_vip_table_availability` in the Venue Lookup paragraph. Remove it.

**Current:** "Use `search_venues`, `get_venue_info`, `get_vip_table_availability`, and other MCP tools to get live data."

**New:** "Use `search_venues`, `get_venue_info`, `get_vip_pricing`, and other MCP tools to get live data."

Similarly, the Venue Knowledge section (line ~199) references `get_vip_table_availability` in the "always call MCP tools first" list — replace with `get_vip_pricing`.

### Anti-Patterns to Avoid

- **Don't remove the Booking Tone: Always Tentative section.** The pricing language ("based on current pricing, subject to change") still applies — `get_vip_pricing` returns generic ranges, not live confirmed prices.
- **Don't modify the Date Clarification section.** The late-night arrival date logic is independent of which pricing tool is used.
- **Don't modify the VIP Auto-Follow section.** Tracking behavior is unchanged — it's triggered by `create_vip_booking_request` success, not by the pricing tool.
- **Don't modify the oneoak SKILL.md.** It is intentionally venue-specific. The rule in openclaw CLAUDE.md (line 314) explicitly says: copy skills from `ember` (generic), NEVER from `oneoak`.
- **Don't add `get_vip_table_availability` or `get_vip_table_chart` back to the tool list.** They stay deprecated in the MCP server until Phase 3 (LIFE-01), but Ember should not use them. The prompt must reflect the new flow exclusively.
- **Don't remove `get_vip_table_availability` from the tool list in oneoak's SKILL.md** — that file is out of scope for this phase.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deploying skill files to Railway containers | Custom rsync or scp | `oc-sync push <instance> <path>` | The sync tool handles Railway SSH auth, path mapping, and config reload |
| Session cache invalidation | Manual container restart | Clear sessions via oc-sync or note in plan | OpenClaw caches skill descriptions in session snapshots — old sessions may still see old skill until cleared |

---

## Common Pitfalls

### Pitfall 1: Session Cache Not Cleared After Skill Update
**What goes wrong:** After pushing the new SKILL.md, existing Ember sessions (active LINE/Discord chats) may still use the old skill description cached in their session snapshot. Ember continues calling old tools.
**Why it happens:** OpenClaw caches skill file content in session state at first load.
**How to avoid:** After pushing files, clear sessions via Railway SSH or wait for session expiry. Plan should include a session-clear step.
**Warning signs:** Ember calls `get_vip_table_availability` after the update is deployed.

### Pitfall 2: Missing Instances
**What goes wrong:** Only ember SKILL.md is updated; mamad and lisa still reference old tools. Users on those instances get inconsistent behavior.
**Why it happens:** The requirement says "Ember SKILL.md" but the same file needs to be consistent across all generic nightlife instances.
**How to avoid:** Update ember, mamad, lisa/workspace, and lisa/workspace-template together. Verify they are byte-for-byte identical after the update (as they are now).
**Warning signs:** `diff` between ember and mamad shows non-zero output after the update.

### Pitfall 3: YAML Frontmatter Description Inconsistency
**What goes wrong:** The YAML `description:` field at the top of SKILL.md still says "table availability/chart" after the rewrite.
**Why it happens:** The description is a one-liner overview that mentions the old tool patterns.
**Current value:** `"Query Nightlife MCP for events, VIP booking, table availability/chart, guest list, and venue info for any Tokyo venue."`
**How to avoid:** Update description to remove "table availability/chart" reference. Suggested: `"Query Nightlife MCP for events, VIP pricing, booking requests, guest list, and venue info for any Tokyo venue."`

### Pitfall 4: Confirmation Gate Wording is Too Weak
**What goes wrong:** The confirmation gate is phrased as a soft suggestion ("I can submit this for you") rather than an explicit question that waits for YES. Ember auto-submits if it interprets a vague signal as consent.
**Why it happens:** LLM prompts that say "offer to submit" can be interpreted as "proceed if context implies interest."
**How to avoid:** Phrase the gate as a CRITICAL rule: "Do NOT call `create_vip_booking_request` until the user explicitly confirms. Asking 'Would you like me to submit an inquiry?' is mandatory. Wait for yes."
**Warning signs:** Booking requests appear in DB without user explicitly saying "yes" or equivalent.

### Pitfall 5: VIP Presentation Rule Example Still Shows Old Data Shape
**What goes wrong:** The "Good" example in VIP Presentation Rule says "2 tables available" — the word "available" implies status, which `get_vip_pricing` does not provide (it gives pricing ranges, not per-table status).
**Why it happens:** The example was written for the old tool that returned per-table status.
**How to avoid:** Update the "Good" example to use pricing-range language. Suggested: "For VIP: from ~¥55K weekday / ~¥110K weekend" (no table count, no "available").
**Warning signs:** Ember says "X tables available" based on pricing data.

---

## Code Examples

### New VIP Booking Flow (complete section)

```markdown
## VIP Booking Flow

### Booking Tone: Always Tentative

**CRITICAL: Never promise or guarantee a table, price, or availability.**
- "I'll put in the request" — NOT "I've booked your table"
- Prices from `get_vip_pricing` are indicative ranges — "weekday minimums start around ¥X, subject to change"
- Special events, holidays, and artist nights may have different pricing

### Flow

1. User asks about VIP → look up the venue's `venue_id` from `tokyo-clubs.json` (or `search_venues` if not listed)
2. Call `get_vip_pricing` with the venue's `venue_id` (include `date` if the user mentioned a specific date)
3. Also call `get_venue_info` to see what event is happening that night
4. Present pricing conversationally (see VIP Presentation Rule) + chart URL if available
5. Collect required fields conversationally:
   - `booking_date` (YYYY-MM-DD)
   - `arrival_time` (HH:MM)
   - `party_size` (1-30)
   - `customer_name`
   - `customer_email`
   - `customer_phone`
   - Optional: `preferred_table_code`, `special_requests`
6. **Clarify late-night arrival dates** (see Date Clarification below)
7. **MANDATORY CONFIRMATION GATE:** Ask explicitly — "Would you like me to submit an inquiry?" — and wait for the user's YES before proceeding. Do NOT call `create_vip_booking_request` until you have explicit confirmation.
8. Call `create_vip_booking_request` with the venue's `venue_id`
9. Share `booking_request_id` + "I've put in the request — we'll hear back from the venue"
10. Register tracking (see VIP Auto-Follow below)
```

### New VIP Table Chart section

```markdown
## VIP Table Chart

**CRITICAL: The table chart is a LAYOUT REFERENCE ONLY.** It shows physical seating positions and zone names — it does NOT show which tables are available, held, or booked. Never infer table availability from the image. Never say "Table V3 looks available" based on what you see in the chart.

When asked for a table map, floor plan, or seating layout:

1. Look up the venue's `venue_id` from `tokyo-clubs.json`
2. Call `get_vip_pricing` with that `venue_id` — `layout_image_url` is included in the response when available
3. If `layout_image_url` is present: send the URL and note it is a seating chart for layout reference only
4. If `layout_image_url` is null: let the user know the chart isn't available yet
5. For LINE: send plain `https://...` link, no `MEDIA:` with filesystem paths
6. Never reuse chart links from memory — use fresh tool output
```

### New VIP Pricing Freshness Rule section

```markdown
## VIP Pricing Freshness Rule

**CRITICAL: Never reuse VIP pricing data from earlier in the conversation.** Every time a user asks about VIP pricing — even for the same venue asked earlier — make a fresh `get_vip_pricing` call.

- Do NOT say "as I mentioned earlier" with old pricing
- Do NOT assume previous data is still current
- Always call the tool fresh
```

### Updated VIP Presentation Rule "Good" example

```markdown
Good:
> "This Saturday at Warp — DJ SET with [artist], doors at 22:00. For VIP: weekday minimums from ~¥55K, weekend from ~¥110K. Want me to put in a request?"

Bad:
> "Warp has 2 tables available Saturday. From ¥55K."
> (Missing: who's playing, what's the vibe; "available" implies live status that we don't have)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact on SKILL.md |
|--------------|------------------|--------------|-------------------|
| `get_vip_table_availability` + `get_vip_table_chart` (2 tools) | `get_vip_pricing` (1 tool, includes chart URL) | Phase 1 (2026-03-10) | Tool Contract, VIP Booking Flow, VIP Table Chart, Freshness Rule all update |
| Auto-submit: collect fields → submit | Collect fields → **confirm** → submit | Phase 2 | Mandatory confirmation gate inserted at step 7 |
| Chart shown as informational reference (no guardrail) | Chart shown with explicit "layout only, not availability" CRITICAL warning | Phase 2 | New CRITICAL rule added to VIP Table Chart section |
| Per-table status implied ("2 tables available") | Pricing ranges only ("from ¥55K weekday") | Phase 2 | VIP Presentation Rule example updated |

**Old tools that stay registered in MCP server (not removed until Phase 3):**
- `get_vip_table_availability`: Still callable on server, but Ember's prompt no longer references it
- `get_vip_table_chart`: Still callable on server, but Ember's prompt no longer references it

---

## Open Questions

1. **Should the `get_vip_pricing` call include `date` in the default VIP inquiry flow?**
   - What we know: `date` is optional in `get_vip_pricing`. Without it, the tool returns aggregate weekday/weekend ranges. With a specific date, it also checks if the venue is open and may return an event pricing note.
   - What's unclear: Whether the default flow should always pass the date the user mentioned, or only pass it if they ask about a specific night.
   - Recommendation: Pass `date` when the user has specified a date ("this Saturday", "March 15"). Omit it when the user is asking generally. This produces more accurate "venue closed" responses for specific-date queries. Document this in the flow as "(include `date` if the user mentioned a specific date)".

2. **Does the mamad instance warrant its own unique SKILL.md or should it stay identical to ember?**
   - What we know: mamad and ember SKILL.md files are currently byte-for-byte identical (diff confirmed). The openclaw note says "copy from ember" for generic instances.
   - Recommendation: Keep them identical. Make the same edit to both files.

3. **Session clearing — should the plan include a Railway SSH command to clear Ember's sessions?**
   - What we know: OpenClaw caches session state. Old sessions hold old skill descriptions.
   - What's unclear: Whether `oc-sync push` triggers an auto-restart, or if sessions need to be manually cleared.
   - Recommendation: Include a step to either redeploy ember via Railway or clear sessions via SSH after pushing the file. The plan should not leave this to chance.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Manual verification — SKILL.md is a behavioral prompt, no automated test runner |
| Config file | None |
| Quick run command | `diff /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md /Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md` (must be empty) |
| Full suite command | Manual Ember chat test via LINE/Discord after deploy |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EMBR-01 | No reference to `get_vip_table_availability` or `get_vip_table_chart` in ember SKILL.md | automated | `grep -n "get_vip_table_availability\|get_vip_table_chart" /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` (must return empty) | ✅ file exists (will have 0 matches post-edit) |
| EMBR-01 | `get_vip_pricing` is listed in Tool Contract and used in VIP Booking Flow | automated | `grep -c "get_vip_pricing" /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` (must be ≥ 3) | ✅ file exists (will pass post-edit) |
| EMBR-02 | Confirmation gate phrase present | automated | `grep -i "confirmation gate\|explicitly confirms\|would you like me to submit" /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` (must have a match) | ✅ file exists (will pass post-edit) |
| EMBR-03 | Chart layout-only guardrail present | automated | `grep -i "layout reference only\|not.*available\|do not infer" /Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` (must have a match) | ✅ file exists (will pass post-edit) |
| All | ember and mamad files are identical | automated | `diff .../ember/.../SKILL.md .../mamad/.../SKILL.md` (must return empty) | ✅ will verify post-edit |
| EMBR-01 | Live Ember responds with `get_vip_pricing` call on VIP inquiry | manual | Send "What are the VIP options at Zouk?" in Ember LINE/Discord | — |
| EMBR-02 | Live Ember asks for confirmation before submitting | manual | Walk through booking flow to final step — verify Ember pauses | — |
| EMBR-03 | Ember does not say "Table X appears available" based on chart | manual | Ask "Can you show me the table layout for CÉ LA VI?" | — |

### Sampling Rate
- **Per task commit:** `grep -c "get_vip_table_availability" SKILL.md` (must be 0)
- **Per wave merge:** Full diff check between ember and mamad
- **Phase gate:** Manual live test in Ember before marking phase complete

### Wave 0 Gaps
None — no test infrastructure setup needed. All validation uses grep commands against existing files.

---

## Sources

### Primary (HIGH confidence)
- Direct inspection: `/Users/alcylu/Apps/openclaw/sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` — 223 lines, full content read
- Direct inspection: `/Users/alcylu/Apps/openclaw/sync/instances/mamad/workspace/skills/nightlife-concierge/SKILL.md` — byte-for-byte identical to ember (diff confirmed)
- Direct inspection: `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace/skills/nightlife-concierge/SKILL.md` — identical content
- Direct inspection: `/Users/alcylu/Apps/openclaw/sync/instances/lisa/workspace-template/skills/nightlife-concierge/SKILL.md` — identical content
- Direct inspection: `/Users/alcylu/Apps/openclaw/sync/instances/oneoak/workspace/skills/nightlife-concierge/SKILL.md` — venue-specific variant, confirmed different, do not modify
- Direct inspection: `/Users/alcylu/Apps/openclaw/sync/README.md` — oc-sync tool documentation, push command syntax
- Direct inspection: `/Users/alcylu/Apps/nightlife-mcp/.planning/phases/01-mcp-pricing-tool/01-RESEARCH.md` — `get_vip_pricing` tool description, response field names, tool description guidance for agents
- Direct inspection: `/Users/alcylu/Apps/nightlife-mcp/.planning/REQUIREMENTS.md` — EMBR-01, EMBR-02, EMBR-03 requirement text

### Secondary (MEDIUM confidence)
- `/Users/alcylu/Apps/openclaw/CLAUDE.md` openclaw instances section (line 314): "nightlife skill venue-neutral rule — all nightlife agents EXCEPT oneoak must use the generic nightlife-concierge skill. When creating new nightlife agents, copy skill files from ember (generic), NEVER from oneoak. Also remember to clear sessions after skill file changes."
- `/Users/alcylu/Apps/nightlife-mcp/.planning/STATE.md` — cross-repo dependency note: "nightlife-mcp deploy must precede openclaw SKILL.md update. Confirm openclaw merge can be coordinated with Phase 1 production deploy timing."

---

## Metadata

**Confidence breakdown:**
- File locations and content: HIGH — all files directly read, diff verified
- Sync deployment method: HIGH — oc-sync README directly read, command syntax confirmed
- Session cache behavior: MEDIUM — mentioned in openclaw CLAUDE.md but exact clear-session command not documented in README
- Requirement text mapping: HIGH — requirements read directly from REQUIREMENTS.md

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (SKILL.md format is stable; oc-sync tooling is stable)
