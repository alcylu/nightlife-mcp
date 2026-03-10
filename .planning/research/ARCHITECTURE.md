# Architecture Research

**Domain:** VIP generic pricing tool in an MCP server + AI agent system
**Researched:** 2026-03-10
**Confidence:** HIGH (MCP spec direct, codebase read directly, agent prompt files read directly)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    Ember AI Agent (openclaw)                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  SKILL.md (system-prompt-equivalent for VIP flow)      │   │
│  │  tokyo-clubs.json (venue_id lookup + vibe tags)        │   │
│  └─────────────────────────┬──────────────────────────────┘   │
│                             │ tool calls via nlt.mjs           │
└─────────────────────────────┼────────────────────────────────┘
                              │ HTTP MCP (api.nightlife.dev/mcp)
┌─────────────────────────────▼────────────────────────────────┐
│                   nightlife-mcp (Express + MCP SDK)           │
│                                                               │
│   Tool Layer (src/tools/)                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ get_vip_pricing │  │create_vip_booking│  │get_vip_     │  │
│  │    (new)        │  │   _request       │  │booking_     │  │
│  └────────┬────────┘  └────────┬─────────┘  │status       │  │
│           │                    │             └─────────────┘  │
│   Service Layer (src/services/)                               │
│  ┌─────────────────┐  ┌──────────────────┐                   │
│  │ vipPricing.ts   │  │  vipBookings.ts  │                   │
│  │ (new, read-only)│  │  (existing)      │                   │
│  └────────┬────────┘  └────────┬─────────┘                   │
│           │                    │                              │
└───────────┼────────────────────┼──────────────────────────────┘
            │ Supabase client    │
┌───────────▼────────────────────▼──────────────────────────────┐
│                      Supabase (shared DB)                      │
│  vip_venue_tables   vip_table_day_defaults   event_occurrences │
│  venue_operating_hours   vip_booking_requests                  │
└───────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Ember SKILL.md | VIP flow instructions, tone rules, tool sequencing | Agent runtime only (not the MCP server) |
| tokyo-clubs.json | venue_id lookup, vibe/crowd tags | Read by Ember at request time |
| `get_vip_pricing` tool (new) | Return weekday/weekend min-spend ranges + table chart URL + event snapshot for a venue/date | `vipPricing.ts` service |
| `vipPricing.ts` service (new) | Query `vip_table_day_defaults` aggregated by weekday vs. weekend; attach event from `event_occurrences`; return `layout_image_url` from `vip_venue_tables` | Supabase |
| `create_vip_booking_request` tool | Accept customer details + optional preferred_table_code; persist to `vip_booking_requests`; send Resend transactional email | `vipBookings.ts` (unchanged) |
| `vipBookings.ts` service | All booking CRUD, status transitions, email dispatch | Supabase, Resend |
| `get_vip_booking_status` tool | Customer-facing status polling | `vipBookings.ts` (unchanged) |

## Recommended Project Structure

The redesign touches two repos and three files.

### nightlife-mcp changes

```
src/
├── services/
│   ├── vipPricing.ts        # NEW — generic pricing query
│   └── vipBookings.ts       # UNCHANGED
├── tools/
│   ├── vipTables.ts         # REPLACE — rename/rewrite to get_vip_pricing
│   └── vipBookings.ts       # UNCHANGED
└── server.ts                # MINOR — swap registerVipTableTools for registerVipPricingTool
```

### openclaw / Ember changes

```
sync/instances/ember/workspace/
└── skills/nightlife-concierge/
    └── SKILL.md             # UPDATE — rewrite VIP Booking Flow section only
```

### Structure Rationale

- **One new service file (`vipPricing.ts`):** Keeps pricing query logic isolated from the existing `vipBookings.ts` and `vipTables.ts`. The old `vipTables.ts` service had per-table availability logic that won't be used; the new file is purpose-built for aggregated ranges.
- **Replace `vipTables.ts` tool, not add alongside it:** The project spec says "replace existing VIP tool (not new tool)" to avoid a deprecation dance. External consumers (Ember, hotel APIs) update to the new contract in one migration.
- **SKILL.md is the only Ember file that changes:** The booking submission, cancellation, and status-check flows are correct. Only the "Step 1-4" browse section (what Ember does before collecting customer details) changes.

## Architectural Patterns

### Pattern 1: Aggregated Range Response (not per-table status)

**What:** The `get_vip_pricing` tool aggregates `vip_table_day_defaults` into two numbers: weekday min and weekend min. It does not return individual table status columns (`available`, `held`, `booked`). Those columns remain in the DB for future use but are not surfaced.

**When to use:** Any time the source data cannot be kept fresh by the venues. Surface the honest floor (minimum spend ranges) rather than a stale per-table status that implies live inventory.

**Trade-offs:**
- Pro: Honest, no false "available" signals.
- Pro: Zero maintenance burden on venues — the seeded day-default rows don't require ongoing updates.
- Con: Agent cannot say "table A3 is open." Instead: "tables from ¥150K — want me to check with the venue?" This is fine because the booking inquiry handles specifics.

**Example shape (tool output):**
```typescript
{
  venue_id: string;
  venue_name: string | null;
  booking_date: string | null;       // the requested date (null if no date given)
  venue_open: boolean | null;        // null when date not given
  weekday_min_spend: number | null;  // JPY; null if no data
  weekend_min_spend: number | null;  // JPY; null if no data
  currency: "JPY";
  pricing_note: string | null;       // e.g. "Prices may vary for special events"
  layout_image_url: string | null;   // table chart image from Supabase storage
  event_on_date: {                   // from event_occurrences, if date provided
    event_id: string;
    name: string;
    start_time: string | null;
    genres: string[];
    flyer_url: string | null;
  } | null;
  generated_at: string;
}
```

### Pattern 2: Tool Description as Behavioral Contract

**What:** The tool description in `server.registerTool()` is the agent's behavioral instruction, not just a summary. The MCP spec (2025-06-18) treats tool descriptions as model-controlled discovery metadata — the agent reads them at tool-selection time. Embedding flow guidance directly in the description (the pattern already used in `createVipBookingToolDescription`) tells the agent when and how to call the tool without requiring the caller's system prompt to be updated.

**When to use:** When the tool has non-obvious prerequisites or sequencing rules. The existing `create_vip_booking_request` description already demonstrates this with its multi-line guidance on late-night date clarification. Apply the same to `get_vip_pricing`.

**Example description guidance for `get_vip_pricing`:**
```
"Get weekday/weekend VIP minimum spend ranges and table chart for a venue.
 Call this before create_vip_booking_request to give the user pricing context.
 If the user specifies a date, pass it as booking_date to receive venue-open status
 and event context for that night. Returns layout_image_url — send this URL to the
 user so they can see the table chart.
 Do NOT reuse results from earlier in the conversation — call fresh each time."
```

**Trade-offs:**
- Pro: Description travels with the tool to every client (hotel APIs, new agent instances) — no per-client prompt engineering required.
- Con: Long descriptions increase token cost on every tool-list response. Keep to 3-5 actionable sentences.

### Pattern 3: Stateless Tools, Conversational State in Agent

**What:** Each MCP tool call is self-contained. The "browse → inquire → submit" flow is not encoded in server-side session state. Instead, the agent accumulates context across turns (pricing info from `get_vip_pricing`, then customer details collected via natural conversation, then `create_vip_booking_request` with all fields). No server-side session tracking is needed.

**When to use:** This is the canonical MCP pattern. The MCP spec explicitly describes tools as model-controlled and single-invocation. Multi-step state lives in the LLM's context window, not in the server.

**Trade-offs:**
- Pro: Server remains horizontally scalable and stateless — the existing Railway deployment model is unchanged.
- Pro: No server-side session timeout issues.
- Con: If the conversation resets, pricing context is lost. Mitigated by the "Freshness Rule" in SKILL.md (always re-call the tool).

### Pattern 4: Separate Browse and Submit Tools (Current)

**What:** The three-step flow maps naturally to two tools: one for browsing (`get_vip_pricing`) and one for committing (`create_vip_booking_request`). The inquiry step ("want me to check with the venue?") is a conversational turn, not a tool call.

**When to use:** When browse and submit have different failure modes and different input contracts. Browse is read-only, always safe, requires only venue_id. Submit is write, requires customer PII, triggers emails, and has downstream ops consequences.

**Do NOT consolidate into one tool.** The composable-tools pattern from enterprise MCP research says: combine when operations must happen atomically. Browse-then-submit is not atomic — the user may browse three venues before deciding. Keeping them separate lets the agent call `get_vip_pricing` for 1 Oak, then CÉ LA VI, then submit only for Zouk, all in one conversation.

## Data Flow

### Request Flow: Browse Phase

```
User: "What's the VIP situation at 1 Oak this Saturday?"
    |
Ember reads tokyo-clubs.json → resolves venue_id
    |
get_vip_pricing(venue_id, booking_date="2026-03-14")
    |
vipPricing.ts:
  1. Fetch vip_venue_tables WHERE venue_id → get layout_image_url
  2. Fetch vip_table_day_defaults WHERE venue_id → aggregate by weekday/weekend
  3. Check venue_operating_hours for that day-of-week → set venue_open
  4. Fetch event_occurrences WHERE venue_id, service_date=2026-03-14 → event context
    |
Response: { weekend_min_spend: 150000, layout_image_url: "...", event_on_date: {...} }
    |
Ember presents: "This Saturday at 1 Oak — [event name] with [artists]. VIP from ¥150K.
                 Here's the table layout: [URL]. Want me to put in a request?"
```

### Request Flow: Submit Phase

```
User: "Yes, table for 4, arriving 11pm. [provides name/email/phone]"
    |
Ember collects fields conversationally
    |
Ember confirms dual-date (late-night arrival check from SKILL.md rules)
    |
create_vip_booking_request({
  venue_id, booking_date, arrival_time, party_size,
  customer_name, customer_email, customer_phone,
  special_requests
})
    |
vipBookings.ts:
  1. INSERT into vip_booking_requests
  2. Attach preferred_table_code if given (soft fail if unknown)
  3. Populate min_spend from 4-level pricing fallback (existing logic, unchanged)
  4. Send Resend email to ops
    |
Response: { booking_request_id, status: "submitted", min_spend: 150000, ... }
    |
Ember: "I've put in the request — booking ref XYZ. We'll hear back from the venue."
    |
nlt.mjs auto-registers to watchlist → background poller handles follow-up
```

### Key Data Flows

1. **Pricing aggregation:** `vip_table_day_defaults` → group by weekday (Sun-Thu, days 0-4) vs. weekend (Fri-Sat, days 5-6) → take `MIN(min_spend)` per bucket → return both values. This uses the same seeded data that currently drives the 4-level fallback chain.

2. **Event context attachment:** `event_occurrences` lookup on venue_id + service_date is already used in `getVenueInfo()` in `venues.ts`. `vipPricing.ts` can use the same pattern (or call `getVenueInfo` internally) — no new DB queries needed.

3. **Chart image URL:** Already stored in `vip_venue_tables.layout_image_url` (a Supabase Storage public URL). `vipTables.ts` already fetches it in `getVipTableChart()`. The new service copies this pattern.

4. **Booking submission:** Completely unchanged. `vipBookings.ts` is not modified.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 3 venues (now) | Current approach works fine. Single DB query per tool call. |
| 10-30 venues | Same queries, more rows — still fast. `vip_table_day_defaults` row count scales linearly; no index changes needed. |
| 100+ venues | Aggregation query (`GROUP BY venue_id, CASE day_of_week`) may benefit from a materialized view or a simple cached layer in the service. Not needed yet. |

### Scaling Priorities

1. **First bottleneck:** `vip_table_day_defaults` scan grows as venues are added. Use a simple in-memory cache (30-60s TTL) in `vipPricing.ts` keyed by `venue_id` if response time degrades. Not needed for 3 venues.
2. **Second bottleneck:** Layout image URL. Already served from Supabase Storage CDN — no scaling concern.

## Anti-Patterns

### Anti-Pattern 1: Exposing Per-Table Status in the New Tool

**What people do:** Keep `status: "available" | "blocked"` per table in the response because the DB has the data.

**Why it's wrong:** Venues won't maintain this data. "Available" will be stale within days. The agent will present false availability to users, damaging trust. The whole point of this redesign is to drop the per-table status surface from the public API.

**Do this instead:** Return `weekday_min_spend` and `weekend_min_spend` only. If a user wants specifics, that's what the booking inquiry is for.

### Anti-Pattern 2: Encoding Conversational Flow in the MCP Tool

**What people do:** Add a `step` parameter ("step": "browse" | "inquire" | "submit") to a single omnibus tool, or use server-side session state to track conversation progress.

**Why it's wrong:** MCP tools are stateless by design (MCP spec 2025-06-18). Session state in the server creates scaling problems and breaks horizontal deployment. The LLM's context window already tracks where the user is in the flow.

**Do this instead:** Keep browse (`get_vip_pricing`) and submit (`create_vip_booking_request`) as separate, focused tools. The inquiry step is a conversational turn guided by SKILL.md.

### Anti-Pattern 3: Updating Agent Flow in Server Code

**What people do:** Write the "want me to put in a request?" prompt text inside the tool response, forcing the agent to parrot it.

**Why it's wrong:** The tool response is structured data. Prompt engineering belongs in SKILL.md (or the equivalent system prompt layer), not in JSON fields that the agent then re-interprets.

**Do this instead:** Return structured data. Let SKILL.md define how Ember presents it. The tool description (in `server.registerTool`) can note "present pricing and then ask if the user wants to proceed" — that's appropriate because it's tool-selection guidance, not message text.

### Anti-Pattern 4: Modifying `create_vip_booking_request` or `vipBookings.ts`

**What people do:** Change the booking schema to reference pricing data, since we now have a generic pricing step.

**Why it's wrong:** The booking tool and service are working correctly. The 4-level fallback chain inside `createVipBookingRequest` already populates `min_spend` from `vip_table_day_defaults`. Modifying it for the pricing redesign creates regression risk with no benefit.

**Do this instead:** Leave `vipBookings.ts` entirely untouched. The new `vipPricing.ts` is a read-only service that runs before the booking, independently.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase | Existing `createClient()` pattern via `src/db/supabase.ts` | `vipPricing.ts` receives the client as a parameter, same as all other services |
| Supabase Storage | Public URL stored in `vip_venue_tables.layout_image_url` | Already populated for 3 venues; `vipPricing.ts` reads it, does not upload |
| Resend (email) | Only triggered by `createVipBookingRequest` | Not touched by this redesign |
| Ember / openclaw | Calls MCP tools via `nlt.mjs` over HTTP | SKILL.md update replaces `get_vip_table_availability` + `get_vip_table_chart` calls with a single `get_vip_pricing` call in the browse phase |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `tools/vipTables.ts` → `services/vipPricing.ts` | Direct function call (same process) | Replace `registerVipTableTools` import in `server.ts` with `registerVipPricingTool` |
| `tools/vipBookings.ts` → `services/vipBookings.ts` | Direct function call (unchanged) | No changes required |
| `server.ts` → tool registrations | Import swap only | Remove `registerVipTableTools`, add `registerVipPricingTool` |
| Ember SKILL.md → MCP tools | HTTP tool calls via `nlt.mjs` | Browse phase changes from 2 calls to 1; submit phase unchanged |

## Build Order

The dependency chain is clear and linear:

```
1. vipPricing.ts service (read-only DB queries)
        |
2. vipTables.ts tool file (rename/rewrite to expose get_vip_pricing)
        |
3. server.ts (swap registration import)
        |
4. REST endpoint (add GET /api/v1/venues/:id/vip-pricing if REST parity needed)
        |
5. SKILL.md (update Ember VIP flow to use new tool)
        |
6. Test end-to-end in Ember conversation
```

Steps 1-3 are a single MCP server PR. Step 5 is a separate openclaw change. They can be merged in order: deploy the MCP server first (new tool available), then update SKILL.md (Ember switches to using it). The old tools can be removed from `server.ts` once Ember is confirmed to use the new path.

## Sources

- MCP Tools Specification 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Designing Composable Tools for Enterprise MCP: https://dev.to/zaynelt/designing-composable-tools-for-enterprise-mcp-from-theory-to-practice-3df
- MCP multi-step conversational flow (elicitation): https://workos.com/blog/mcp-features-guide
- MCP tool description as behavioral contract: https://composio.dev/blog/how-to-effectively-use-prompts-resources-and-tools-in-mcp
- Tool consolidation patterns (GitHub MCP example): https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1915
- Existing codebase: `src/tools/vipTables.ts`, `src/tools/vipBookings.ts`, `src/services/vipTables.ts`, `src/services/vipBookings.ts`, `src/types.ts`, `src/server.ts`
- Ember agent: `sync/instances/ember/workspace/skills/nightlife-concierge/SKILL.md`

---
*Architecture research for: VIP generic pricing redesign — nightlife-mcp + Ember*
*Researched: 2026-03-10*
