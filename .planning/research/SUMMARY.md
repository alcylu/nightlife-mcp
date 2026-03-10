# Project Research Summary

**Project:** VIP Generic Pricing Redesign — nightlife-mcp
**Domain:** MCP tool response design for AI-mediated VIP booking inquiry flow
**Researched:** 2026-03-10
**Confidence:** HIGH

## Executive Summary

This research covers the redesign of two existing MCP tools (`get_vip_table_availability` and `get_vip_table_chart`) into a single `get_vip_pricing` tool that returns honest weekday/weekend minimum spend ranges rather than per-table availability status. The driving insight from both competitive analysis and the existing data model is that venues will not maintain per-table real-time availability — any system that surfaces that data is presenting stale or fabricated information. The correct model, used by every successful competitor (Discotech, VIPFlow, Club Bookers), is inquiry-based: show generic pricing ranges, then guide the user to submit a booking request that ops confirms manually.

The recommended implementation is a clean service extraction: a new read-only `vipPricing.ts` service aggregates `vip_table_day_defaults` into weekday/weekend buckets, checks venue operating hours, and optionally attaches event context. The MCP tool layer and booking submission layer are left unchanged. The response schema is designed for LLM narration — field names and descriptions are written so Ember can present the data in natural conversation without prompt engineering workarounds. All tool description text doubles as behavioral instruction to Ember, eliminating the need for per-client system prompt customization.

The primary risks are deployment coordination risks, not architectural ones. The biggest failure mode is removing old tool fields before updating Ember's system prompt, or allowing Ember to skip the confirmation gate and auto-submit booking inquiries. Both risks have clear mitigations: deploy new tool first, update Ember prompt second, remove old tool third; and encode the mandatory confirmation step in both the tool description and SKILL.md. A secondary risk is pricing misrepresentation on special event nights where `vip_table_availability` per-date overrides exist — the service layer must always check those rows before falling back to day-defaults.

---

## Key Findings

### Recommended Stack

No new dependencies are required. The existing `@modelcontextprotocol/sdk` (1.27.1, stay on 1.x — v2 is pre-alpha), `zod/v4`, and `@supabase/supabase-js` handle everything. The dual `content` + `structuredContent` response pattern used throughout the codebase is the correct MCP 2025-06-18 pattern — follow it exactly. The `outputSchema` field on `registerTool()` should always accompany `structuredContent` so clients and LLMs know the response shape at tool-selection time.

The highest-leverage decision in this redesign is not code — it is field naming and tool description copy. Research (arxiv 2602.14878) shows that explicit behavioral guidance in tool descriptions improves agent task completion by 6-15 percentage points. Field names like `weekday_min_spend` and `weekend_min_spend` outperform `default_min_spend` or `min_spend_amount` because they map directly to how a human would phrase the information.

**Core technologies:**
- `@modelcontextprotocol/sdk` ^1.26.0: MCP server + tool registration — pin to 1.x, v2 not ready
- `zod/v4`: Output schema definition with `outputSchema` on `registerTool()` — already in use
- TypeScript ^5.9.3: Type safety across tool-to-service boundary — already in use

See `.planning/research/STACK.md` for full details.

### Expected Features

The feature landscape is well-understood from competitor analysis. The key strategic insight is that "per-table real-time availability" is a feature that sounds better than it performs — competitors who offer it have maintenance problems, and it creates user trust failures when status is stale. The correct anti-feature decision is to explicitly remove per-table status from the public tool and replace it with honest ranges plus a booking inquiry path.

**Must have (table stakes — P1):**
- Weekday vs. weekend minimum spend ranges — the primary pricing axis; every competitor shows this
- Venue open/closed gate — pricing info is useless if the venue is closed that night
- Table chart image URL — included unconditionally when available; builds credibility
- Zone-level pricing summary — aggregate by zone (dancefloor, VIP room) so Ember can narrate tiers
- Booking inquiry affordance — `booking_supported: true/false` + `booking_note` so Ember knows when to offer `create_vip_booking_request`
- Pricing unavailable fallback — explicit `pricing_configured: false` + message when no data exists
- Ember system prompt (SKILL.md) update — present pricing conversationally; enforce confirmation gate

**Should have (competitive differentiators — P2, add after validation):**
- Event context / busy night signal — query `event_occurrences` for the requested date; surface `event_name` + `busy_night` boolean
- `pricing_approximate` flag in output — lets Ember say "around ¥100K" vs. "exactly ¥100K"
- Multi-venue comparison — `venue_ids[]` param for side-by-side; trigger when hotel clients request it

**Defer (v2+):**
- Deposit-linked pricing in the discovery tool
- Day-of-week full breakdown (Mon-Sun)
- Per-table detailed view (only if venues adopt maintenance workflows)

See `.planning/research/FEATURES.md` for full competitor analysis and dependency graph.

### Architecture Approach

The architecture is a clean two-phase separation: `get_vip_pricing` (read-only browse) and `create_vip_booking_request` (write, unchanged). The browsing phase consolidates two old tools into one; the submission phase is untouched. This follows the MCP composable-tools principle: combine tools only when operations must be atomic. Browse-then-submit is not atomic — a user may browse three venues before deciding on one.

The new service file (`vipPricing.ts`) is read-only and isolated from `vipBookings.ts`. It performs three parallel queries (operating hours, day-defaults aggregation, event context lookup) that have no dependencies on each other and should be parallelized with `Promise.all`. The pricing aggregation groups `vip_table_day_defaults` by weekday (Sun-Thu, days 0-4) vs. weekend (Fri-Sat, days 5-6) and takes `MIN(min_spend)` per bucket.

**Major components:**
1. `vipPricing.ts` (new service) — read-only DB queries: operating hours gate, day-defaults aggregation by weekday/weekend, event context attachment, chart image URL passthrough
2. `tools/vipTables.ts` (rewrite) — exposes `get_vip_pricing` with `outputSchema`; behavioral description embeds flow guidance for Ember
3. `server.ts` (minor) — swap `registerVipTableTools` import for `registerVipPricingTool`; old tool kept registered through first deploy, then removed
4. `SKILL.md` in openclaw (separate repo) — rewrite VIP Booking Flow section only; mandatory confirmation gate before `create_vip_booking_request`

**Build order:** vipPricing.ts service → tool file → server.ts import swap → REST endpoint (if parity needed) → SKILL.md update → end-to-end test in Ember

See `.planning/research/ARCHITECTURE.md` for full component diagram and data flow.

### Critical Pitfalls

1. **Removing tool input fields before updating Ember** — Ember's system prompt may reference old field names (`booking_date_to`, `include_non_available`). Deploy the new tool alongside the old; remove the old only after Ember prompt is confirmed updated. Use `z.passthrough()` on transition-period schemas.

2. **Generic price range contradicting a per-date special event price** — `vip_table_day_defaults` stores regular pricing, but `vip_table_availability` has per-date overrides for special events. The service must always check per-date rows first and only fall back to day-defaults when none exist. Never suppress per-date data.

3. **Ember hallucinates availability from the table chart image** — LLMs pattern-match on seating charts and infer availability from them. SKILL.md must explicitly state: "The table chart is a venue layout reference only. Do not infer availability from it." The new tool response must not include any `status` fields.

4. **Ember auto-submitting booking without user confirmation** — Agentic reasoning may collapse browse and commit steps. Both the tool description and SKILL.md must define a mandatory confirmation gate: present pricing, ask "would you like me to submit an inquiry?", only then call `create_vip_booking_request`.

5. **Service-day date confusion** — `vip_table_day_defaults` must be queried using JST day-of-week after service-date resolution (6am JST cutoff), not raw UTC calendar dates. Reuse `getCurrentServiceDate()` from `utils/time.ts`. A request at 02:00 JST Saturday must resolve to Friday night pricing.

See `.planning/research/PITFALLS.md` for full pitfall details, recovery strategies, and the "Looks Done But Isn't" verification checklist.

---

## Implications for Roadmap

The research reveals a two-phase implementation with a clear dependency boundary: the MCP server changes (Phase 1) must be deployed before the Ember prompt update (Phase 2). The two repos cannot be updated atomically, so the transition window requires the old tools to remain registered until Phase 2 is confirmed.

### Phase 1: MCP Server — New Pricing Tool

**Rationale:** The core data model, DB schema, and pricing fallback chain all already exist. This is primarily an extraction and aggregation exercise. No new infrastructure, no new DB tables. The build order is linear and well-understood.

**Delivers:** A new `get_vip_pricing` MCP tool (and optional REST endpoint) that returns weekday/weekend min spend ranges, venue open flag, table chart URL, and optional event context. Old tools remain registered with deprecation notice in description.

**Addresses (from FEATURES.md P1):** Weekday/weekend min spend, venue open/closed gate, table chart URL, zone-level pricing summary, pricing unavailable fallback (`pricing_configured: false`)

**Avoids (from PITFALLS.md):**
- Per-date override bug: service layer checks `vip_table_availability` before falling back to `vip_table_day_defaults`
- Service-day date confusion: apply `getCurrentServiceDate()` + JST resolution to all date inputs
- Unhelpful empty response for unseeded venues: `pricing_configured` field defined in output schema from day one
- Breaking Ember: old tools stay registered through this phase

**Needs phase research:** No — patterns are well-documented, build order is clear, codebase already has all dependencies.

### Phase 2: Ember Prompt — VIP Flow Update

**Rationale:** Depends on Phase 1 being deployed and verified. The Ember update happens second to eliminate the window where the new tool is available but Ember uses old tool names. The confirmation gate pitfall (auto-booking) is the highest-recovery-cost risk in the project — it must be addressed here with explicit, tested instruction.

**Delivers:** Updated SKILL.md in openclaw that replaces the two-tool browse phase with a single `get_vip_pricing` call, enforces the mandatory user confirmation gate before booking submission, and includes explicit instructions on table chart interpretation.

**Addresses (from FEATURES.md P1):** Ember system prompt update, booking inquiry affordance surface
**Avoids (from PITFALLS.md):**
- Ember hallucinates availability from chart: explicit "chart is reference only" instruction
- Inquiry skipped / auto-booking: mandatory confirmation gate defined and QA-tested
- Stale Ember prompt: old tool names audited and replaced

**Needs phase research:** No — the SKILL.md structure is known, the confirmation gate pattern is standard.

### Phase 3: Enhancements — Event Context and Pricing Signals (P2)

**Rationale:** Add only after core tool is live and Ember is confirmed using it. Event context (`event_on_date`, `busy_night` flag) is a best-effort enhancement — it can be added to the service with no breaking changes to the Phase 1 schema since the field is already defined as nullable. The `pricing_approximate` flag is similarly non-breaking.

**Delivers:** Event context in pricing responses (busy night signal), `pricing_approximate` flag for Ember to modulate language ("around ¥100K" vs. "exactly ¥100K").

**Addresses (from FEATURES.md P2):** Event context / busy night signal, `pricing_approximate` flag in output

**Needs phase research:** No — both enhancements are additive to established patterns.

### Phase Ordering Rationale

- **Server before prompt:** The new MCP tool must be deployed first so Ember can call it; updating the prompt before the tool is available breaks the flow.
- **Old tools kept through Phase 1:** Eliminates regression risk. Deploying new tool alongside old means a failed Ember prompt update rolls back cleanly — Ember can still call old tools if something goes wrong.
- **Enhancements deferred to Phase 3:** The event context lookup adds a DB query and introduces the only new external dependency (events service). Keeping it out of Phase 1 reduces scope and risk for the core pricing redesign.

### Research Flags

Phases with standard patterns (no additional research needed):
- **Phase 1:** All patterns established — aggregation query, dual content/structuredContent output, 4-level pricing fallback, operating hours gate all already exist in codebase.
- **Phase 2:** SKILL.md update is constrained scope — only the VIP Booking Flow section changes.
- **Phase 3:** Additive enhancements to existing service; event lookup pattern already implemented in `getVenueInfo()`.

No phases require `/gsd:research-phase` during planning. The research corpus is sufficient to plan all three phases directly.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | MCP 2025-06-18 spec direct, existing codebase verified, TypeScript SDK GitHub confirmed |
| Features | HIGH | Competitor platforms analyzed directly (Discotech, VIPFlow, ZEROTOKYO); existing DB schema read; PROJECT.md requirements explicit |
| Architecture | HIGH | MCP spec direct, existing codebase read (vipTables.ts, vipBookings.ts, server.ts, SKILL.md), build order verified against actual file structure |
| Pitfalls | HIGH | Grounded in actual codebase audit plus CONCERNS.md; deployment coordination risks verified against real cross-repo dependency (nightlife-mcp + openclaw) |

**Overall confidence:** HIGH

### Gaps to Address

- **openclaw repo access during planning:** SKILL.md update is in a separate repo. The roadmap should treat Phase 2 as requiring a cross-repo PR. Confirm the openclaw change can be merged coordinately with Phase 1 deployment timing.
- **`pricing_context` vs. `pricing_note` field naming:** STACK.md recommends `pricing_context` (Ember-guidance string); FEATURES.md references `pricing_approximate` as a flag. The roadmap executor should choose one approach and apply it consistently across the output schema. Recommendation: use `pricing_note: string | null` for human-readable caveats and surface `pricing_approximate: boolean` only if the DB fallback level warrants it.
- **REST endpoint parity for `get_vip_pricing`:** ARCHITECTURE.md lists a REST endpoint as step 4 in the build order but marks it as conditional ("if REST parity needed"). The roadmap should decide early whether `/api/v1/venues/:id/vip-pricing` is in scope for Phase 1 or deferred.

---

## Sources

### Primary (HIGH confidence)
- MCP Tools Specification 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18/server/tools — structuredContent, outputSchema, content types
- TypeScript SDK GitHub: https://github.com/modelcontextprotocol/typescript-sdk — v1.x production stable, 1.27.1 current
- npm @modelcontextprotocol/sdk: https://www.npmjs.com/package/@modelcontextprotocol/sdk — version confirmation
- Zod v4 Release Notes: https://zod.dev/v4 — import path, breaking changes
- Existing codebase: `src/tools/events.ts`, `src/tools/venues.ts`, `src/tools/vipTables.ts`, `src/tools/vipBookings.ts`, `src/services/vipTables.ts`, `src/services/vipBookings.ts` — source of truth for patterns
- Ember agent: `sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md` — current VIP flow
- Project CLAUDE.md: VIP pricing data model, operating hours logic, 4-level fallback chain

### Secondary (MEDIUM confidence)
- arxiv 2602.14878 (MCP Tool Descriptions Are Smelly): https://arxiv.org/html/2602.14878v1 — tool description quality, 15% task completion improvement from behavioral guidelines
- Designing Composable Tools for Enterprise MCP: https://dev.to/zaynelt/designing-composable-tools-for-enterprise-mcp-from-theory-to-practice-3df — browse/submit separation pattern
- MCP tool description as behavioral contract: https://composio.dev/blog/how-to-effectively-use-prompts-resources-and-tools-in-mcp
- API Backwards Compatibility Best Practices: https://zuplo.com/learning-center/api-versioning-backward-compatibility-best-practices — breaking change coordination window
- MCP API Versioning risks: https://nordicapis.com/the-weak-point-in-mcp-nobodys-talking-about-api-versioning/

### Tertiary (LOW confidence — general industry signals)
- Discotech: https://discotech.me / https://help.discotech.me — inquiry-based booking model, minimum spend definitions
- VIPFlow: https://vipflow.com — "price on request" competitor pattern, Tokyo venue examples
- ZEROTOKYO: https://zerotokyo.jp/en/vip/ — venue-direct pricing and floor plan image standards
- Tokyo Night Owl: https://tokyonightowl.com/tokyo-vip-how-to-book-nightclub-tables/ — VIP booking expectations for hotel guests
- TicketFairy table service blog: https://www.ticketfairy.com/blog/2024/09/04/how-to-increase-nightclub-revenue-with-table-service/ — general industry patterns

---
*Research completed: 2026-03-10*
*Ready for roadmap: yes*
