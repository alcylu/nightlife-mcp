# Pitfalls Research

**Domain:** VIP booking tool redesign — live availability to generic inquiry-based pricing
**Researched:** 2026-03-10
**Confidence:** HIGH (grounded in actual codebase, known patterns, and verified sources)

---

## Critical Pitfalls

### Pitfall 1: Removing Tool Fields That Existing Clients Already Send

**What goes wrong:**
The redesigned tool drops input fields (e.g., `booking_date_to`, `include_non_available`, `party_size`) that the old `get_vip_table_availability` accepted. If Ember or any external API client still sends those fields in its tool call, the new stricter Zod schema rejects the call with a validation error — or worse, silently ignores fields it previously acted on.

**Why it happens:**
Replacing a tool schema feels like a clean internal refactor. But Ember's system prompt may reference the old input shape, and external hotel clients may have hard-coded the old parameter names into their MCP integrations.

**How to avoid:**
- Treat any field removal from an input schema as a breaking change requiring a coordination window.
- If replacing `get_vip_table_availability`, keep old tool registered but with a deprecation notice in its description for at least one deploy cycle.
- Audit Ember's system prompt for references to old tool names and input fields before removing them from the server.
- Use `z.passthrough()` on any transition-period schemas to silently accept — but ignore — unknown fields rather than rejecting.

**Warning signs:**
- Ember tool calls that reference `booking_date_to` or `include_non_available` after the new tool is deployed.
- External clients getting 400-equivalent MCP errors immediately after deploy.
- Sudden drop in VIP tool call success rate in observability metrics.

**Phase to address:** Phase 1 (tool schema redesign) — define the new schema alongside the old, not as a replacement.

---

### Pitfall 2: Returning a "Generic" Price Range That Contradicts the Actual Booking

**What goes wrong:**
The tool surfaces "weekday ¥100,000 / weekend ¥200,000" to Ember. Ember presents this to the user. The user submits a booking inquiry for Saturday. The venue then confirms at ¥300,000 (because it's a special event night). The user feels deceived. Trust collapses.

**Why it happens:**
`vip_table_day_defaults` stores regular day-of-week pricing. Special events override this in `vip_table_availability`. The redesign removes per-date checks in favor of generic weekday/weekend ranges — but the event context isn't factored into the pricing signal.

**How to avoid:**
- Always check if a `vip_table_availability` per-date row exists for the requested date. If it does, surface its min_spend as the "tonight's price" rather than the generic range.
- When the returned event context shows a notable event on that date, add a clear qualifier: "prices may vary on special event nights — venue will confirm."
- Mark returned pricing fields with a `pricing_approximate: true` flag so Ember's prompt can distinguish confirmed vs. estimated pricing.
- Never suppress per-date data when it exists just to keep the response simple.

**Warning signs:**
- Users reporting that confirmed booking amounts don't match what Ember quoted.
- `vip_table_availability` table has rows for a date that the new tool ignores.
- Ops team manually correcting pricing expectations for users post-inquiry.

**Phase to address:** Phase 1 (service layer) — the pricing aggregation logic must still consult per-date rows before falling back to day-defaults.

---

### Pitfall 3: Ember Hallucinates Table Availability from the Chart Image

**What goes wrong:**
The tool returns a table chart image URL. Ember sees a layout with labeled tables (V1–V6, DJ1–DJ2, etc.) in its context. Without explicit instruction otherwise, Ember may infer from the image that specific tables are "available" or describe them as bookable — because that's what table charts usually mean.

**Why it happens:**
LLMs pattern-match on visual layouts. A seating chart with labeled zones implies availability. Without system prompt instructions that explicitly say "this chart is for reference only — all tables are subject to venue confirmation," Ember will reason incorrectly from the image.

**How to avoid:**
- Add explicit instruction to Ember's system prompt: "The table chart is a venue layout reference only. Do not infer availability from it. All tables require venue confirmation via the booking inquiry."
- Do not return per-table `status` fields in the new tool response. If `status` is still present in the response shape, Ember will use it regardless of intent.
- The new tool response should explicitly omit availability state at the table level — return table metadata (zone, capacity) but not `status`.

**Warning signs:**
- Ember saying things like "Table V3 in the VIP zone appears to be available based on the chart."
- Users being told specific tables are open before venue confirmation.
- Ember calling `create_vip_booking_request` with a `preferred_table_code` that came from chart inference, not user selection.

**Phase to address:** Phase 2 (Ember prompt update) — the prompt must explicitly forbid availability inferences from chart data.

---

### Pitfall 4: Inquiry Flow Gets Skipped — Ember Jumps Straight to Booking Submission

**What goes wrong:**
Ember receives pricing information and interprets that as enough context to go directly to `create_vip_booking_request` without the user explicitly saying "yes, please book." The user was browsing pricing, not committing. A booking inquiry gets submitted without informed consent.

**Why it happens:**
The tool is named and described in a way that makes it a natural precursor to booking. If Ember's system prompt doesn't add an explicit confirmation gate, agentic reasoning will collapse the "browse" and "commit" steps into one.

**How to avoid:**
- Ember's system prompt must define a strict two-step flow: (1) present pricing and ask "Would you like me to check with the venue?", (2) submit inquiry only after affirmative response.
- The pricing tool description should include language like: "Returns pricing information only. Do not submit a booking request without explicit user confirmation."
- Add a test case to Ember QA: present pricing → verify Ember does NOT auto-call `create_vip_booking_request` without user prompt.

**Warning signs:**
- VIP booking submissions arriving in ops queue that users don't remember authorizing.
- Ember tool call logs showing `create_vip_booking_request` called immediately after `get_vip_pricing` with no user turn in between.
- Customer complaints about unsolicited booking requests to venues.

**Phase to address:** Phase 2 (Ember prompt) — define the confirmation gate as a mandatory step, not a suggestion.

---

### Pitfall 5: Venues With No Pricing Data Silently Return Unhelpful Response

**What goes wrong:**
The tool is expanded to new venues that don't yet have `vip_table_day_defaults` rows. The response comes back empty or returns only the chart image and venue name, with no pricing data. Ember presents this as "pricing information is not available" — but the user doesn't understand why. They assume the venue doesn't do VIP, when in reality the data just hasn't been seeded.

**Why it happens:**
The 4-level pricing fallback chain was designed for the 3 seeded venues. Expansion venues will hit Level 4 (no pricing data) and the fallback result is "unknown." This is a data problem that looks like a feature bug.

**How to avoid:**
- Return a clear `data_completeness` field in the response: `"pricing_configured": false` when no day-defaults exist, plus a human-readable `venue_note` like "Contact venue directly for minimum spend."
- Ember's prompt should handle this state explicitly: when `pricing_configured: false`, say "VIP pricing for [venue] isn't in our system yet — I can still submit an inquiry and the venue will confirm details."
- Do not expose un-seeded venues through the tool without a clear ops workflow to seed their pricing first.

**Warning signs:**
- Ember returning blank or "unknown" pricing responses for venues that ops know accept VIP bookings.
- Tool response missing both `weekday_min_spend` and `weekend_min_spend` fields.
- Ops receiving booking requests with no minimum spend context to work from.

**Phase to address:** Phase 1 (tool response shape) — define and document the `pricing_configured: false` state in the output schema from the start.

---

### Pitfall 6: Midnight / Next-Day Date Confusion in Inquiry Context

**What goes wrong:**
The existing `create_vip_booking_request` tool already has elaborate dual-date wording instructions (Friday night = Saturday morning arrival). The new pricing tool receives `booking_date` but doesn't apply the same service-day logic. A user asking "what's the minimum spend for Saturday night?" might get Friday pricing because Saturday night entries start at 00:00 on Sunday in the DB.

**Why it happens:**
The service-day rollover logic (6am JST cutoff) exists in `utils/time.ts` but is not uniformly applied across tools. VIP tools may use calendar date directly rather than service-date semantics.

**How to avoid:**
- The new pricing tool must apply the same service-day resolution as `get_tonight` — a request for "Saturday" means the Saturday night event window, not the calendar day.
- Reuse `getCurrentServiceDate()` and `serviceDateWindowToUtc()` from `utils/time.ts` rather than accepting raw `YYYY-MM-DD` strings without normalization.
- Add a test case: request Saturday pricing at 02:00 JST Sunday — verify it returns Saturday night pricing, not Sunday.

**Warning signs:**
- Users reporting wrong prices shown vs. what venue charges on that night.
- Tool returning "venue closed" for a Saturday request because the raw calendar date maps to a day the venue doesn't operate.
- Day-of-week logic returning "weekday" for Friday night because the service date resolves to Saturday.

**Phase to address:** Phase 1 (service layer) — apply time normalization to any date input before querying day-defaults.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Delete old `get_vip_table_availability` tool immediately | Cleaner server registration | Breaks Ember if prompt not updated atomically | Never — always deploy new tool first, then update prompt, then remove old |
| Return flat weekday/weekend prices with no `pricing_approximate` flag | Simpler response shape | Ember quotes prices as confirmed; users dispute post-booking | Never — always flag approximation |
| Skip per-date row check and always use day-defaults | Simpler service logic | Per-event pricing gets ignored; mispricing on special nights | Never — per-date rows must always take priority |
| Hardcode day-of-week thresholds (Fri/Sat = weekend) in service layer | Fast to ship | Wrong for venues with non-standard "weekend" definitions | Never — use the day-default data itself to determine weekday vs. weekend |
| Use the existing chart tool unchanged and just add pricing on top | Less code change | Chart still returns per-table `status` fields that Ember will use | Never — the new tool must not expose `status` at all |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Ember system prompt | Update prompt and server in separate deploys with no coordination | Deploy new MCP tool first, then update Ember prompt in same release window |
| `vip_table_day_defaults` DB | Query by `day_of_week` using JavaScript's `Date.getDay()` (UTC) | Query using JST day-of-week after service-date resolution; Tokyo clubs operate on JST, not UTC |
| Supabase chart image URL | Assume `layout_image_url` is always set | Some tables have no chart image; handle null gracefully in both tool response and Ember prompt |
| Ember + table chart image | Pass raw URL and let Ember infer meaning | Wrap the URL with explicit text: "This is a seating chart for reference. It does not indicate availability." |
| `openclaw` repo vs `nightlife-mcp` repo | Update prompt config without testing against new tool schema | Stage both changes together in a feature branch; test end-to-end before merging either |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching per-date rows + day-defaults + event context in 3 sequential queries | Tool latency >500ms for common pricing lookups | Parallelize the 3 queries with `Promise.all`; they have no dependencies on each other | At current scale (3 venues), harmless; noticeable at 20+ venues or high concurrent traffic |
| Supabase 1000-row cap on `vip_table_day_defaults` | Pricing silently returns empty for venues with many tables/days | Use `.range()` pagination or verify max rows needed; 30 tables × 7 days = 210 rows per venue, well within limit | Safe for current 3 venues; audit at 50+ venues |
| Loading full `vip_table_availability` calendar to find per-date override | Response slow for multi-week date ranges | Query only the specific `booking_date` row, not a range | Not applicable for single-date pricing lookups |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Returning `layout_image_url` without checking it's a Supabase storage URL | Could expose unexpected external URL if DB has bad data | Validate URL starts with the known Supabase storage prefix before returning |
| Pricing response includes internal DB IDs (`table_id`, `venue_id`) that aren't needed | Unnecessary data exposure in public tool output | Strip internal IDs from the new tool's output schema; return only user-facing fields |
| Ember submits booking with pricing details sourced from tool response as if they're venue-confirmed | User has false expectation of locked-in price | Pricing in inquiry confirmation email must say "minimum spend to be confirmed by venue" |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Presenting weekday and weekend as separate prices without explaining which applies tonight | User mentally anchors on wrong number | Always resolve which price tier applies to the requested date and lead with that number; show the other tier for context |
| "Starting from ¥100,000" language for minimum spend | Users assume they can book for exactly ¥100,000; venue quotes higher; complaint | Use "minimum spend from ¥100,000" with explicit qualifier: "venue will confirm the minimum for your date and party size" |
| No explanation of what minimum spend means | Non-Japanese users unfamiliar with the model assume it's a cover charge | Ember prompt should include one-sentence explainer: "The minimum spend means your group commits to ordering at least ¥X in bottles and drinks — it's not a cover charge." |
| Presenting pricing before confirming venue supports VIP | User discovers mid-inquiry that venue doesn't accept VIP bookings | Check `vip_booking_supported` flag on venue before returning pricing; if false, stop and clarify |
| Showing table chart with zone labels (e.g., "Premium Stage") without context | User asks to book "Premium Stage" not knowing it costs 3x weekday rate | Embed zone context in the chart description, not just the image; note that zone impacts minimum spend |

---

## "Looks Done But Isn't" Checklist

- [ ] **New pricing tool deployed:** Verify `get_vip_table_availability` and `get_vip_table_chart` are either removed from server registration or explicitly deprecated — confirm via `/health` endpoint tool listing.
- [ ] **Ember prompt updated:** Verify Ember does NOT call old tool names by running a test conversation asking about VIP pricing; inspect tool call logs.
- [ ] **Per-date override respected:** Seed a test `vip_table_availability` row for a specific date; call new pricing tool for that date; verify the per-date price appears, not the day-default.
- [ ] **Venue closed state handled:** Remove all `venue_operating_hours` rows for a test venue; call pricing tool; verify response says venue is closed on that day — not just empty pricing.
- [ ] **Service-day logic applied:** Call pricing tool at 02:00 JST with no explicit date; verify it resolves to "last night" (Friday), not the current UTC calendar day.
- [ ] **Ember confirmation gate works:** Script a conversation where user asks about VIP pricing and says nothing further; verify Ember asks "would you like me to submit an inquiry?" rather than auto-submitting.
- [ ] **Null chart image handled:** Call pricing tool for a venue with no `layout_image_url`; verify response includes `layout_image_url: null` without error, and Ember doesn't break.
- [ ] **`pricing_configured: false` state surfaced:** Call pricing tool for a venue with zero `vip_table_day_defaults` rows; verify response clearly marks `pricing_configured: false` rather than returning empty arrays.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Old tool removed before Ember prompt updated | MEDIUM | Re-register old tool temporarily; update Ember prompt; then remove old tool again |
| Users quoted wrong price (day-default ignored per-date row) | LOW | Ops contacts affected users with corrected pricing; patch service logic to check per-date rows first |
| Ember auto-submitting booking without user confirmation | HIGH | Revert Ember prompt to previous version; audit all auto-submitted bookings in ops queue; cancel any unintended submissions |
| Venue pricing shows stale data after new day-defaults seeded | LOW | No cache to clear — Supabase is queried live; verify data at DB level; tool will reflect it on next call |
| New venue surfaces with `pricing_configured: false` unexpectedly | LOW | Seed day-default rows for that venue; no code change required |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Removing fields breaks Ember / external clients | Phase 1: Schema design — keep old tool registered through first deploy | Confirm no MCP validation errors in tool call logs after deploy |
| Generic price contradicts per-date special event price | Phase 1: Service layer — per-date check runs before day-defaults | Unit test: per-date row present → tool returns per-date price, not day-default |
| Ember hallucinates availability from chart | Phase 2: Ember prompt update — explicit "chart is reference only" instruction | QA: Ember does not name specific available tables |
| Inquiry skipped — Ember auto-books | Phase 2: Ember prompt — mandatory confirmation gate defined | QA: No `create_vip_booking_request` call without affirmative user turn |
| Un-seeded venues return unhelpful empty response | Phase 1: Output schema — `pricing_configured` field defined and documented | Test with zero-row venue before shipping |
| Service-day date confusion in pricing lookup | Phase 1: Service layer — date normalization applied to all inputs | Unit test: 02:00 JST Saturday → Friday pricing |
| Stale Ember prompt assumptions about old tool | Phase 2: Ember prompt + deploy coordination | End-to-end test across both repos before merging |

---

## Sources

- Codebase audit: `/Users/alcylu/Apps/nightlife-mcp/src/tools/vipTables.ts`, `vipBookings.ts`, `server.ts`
- Codebase concerns: `/Users/alcylu/Apps/nightlife-mcp/.planning/codebase/CONCERNS.md` (fragile pricing fallback chain, test coverage gaps)
- Project spec: `/Users/alcylu/Apps/nightlife-mcp/.planning/PROJECT.md`
- MCP tool versioning: [The Weak Point in MCP Nobody's Talking About: API Versioning](https://nordicapis.com/the-weak-point-in-mcp-nobodys-talking-about-api-versioning/) (MEDIUM confidence)
- Backward compatibility: [API Backwards Compatibility Best Practices](https://zuplo.com/learning-center/api-versioning-backward-compatibility-best-practices) (MEDIUM confidence)
- Pricing ambiguity UX: [How to Display Price Discounts: Avoid These 4 Pitfalls](https://baymard.com/blog/product-page-price-discounts) (MEDIUM confidence)
- LLM prompt cache breakage on tool changes: [Prompt Caching in LLMs](https://blog.dailydoseofds.com/p/prompt-caching-in-llms) (MEDIUM confidence)
- VIP nightclub booking system patterns: [Boost Nightclub Profits: Table Service Secrets](https://www.ticketfairy.com/blog/2024/09/04/how-to-increase-night-club-revenue-with-table-service/) (LOW confidence — general industry, not engineering-specific)
- Existing CLAUDE.md VIP pricing docs (HIGH confidence — direct knowledge of this system's data model and operating hours logic)

---

*Pitfalls research for: VIP booking redesign — generic pricing + inquiry flow*
*Researched: 2026-03-10*
