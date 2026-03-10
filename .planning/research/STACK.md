# Stack Research

**Domain:** MCP tool response design — pricing data for AI agent conversational presentation
**Researched:** 2026-03-10
**Confidence:** HIGH (core patterns from official MCP spec + verified against existing codebase)

---

## The Core Question

How should an MCP tool return VIP pricing data so an AI agent (Ember) can present it naturally in conversation — not dump JSON at the user?

The answer comes from two orthogonal concerns:

1. **Response structure** — what shape to return, how to use `content` + `structuredContent`
2. **Semantic field design** — how to name and describe fields so the LLM reasons about them correctly
3. **Tool description engineering** — what the description says shapes Ember's behavior more than code does

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@modelcontextprotocol/sdk` | `^1.26.0` (current: 1.27.1) | MCP server + tool registration | Already in use; v1.x is production-stable. v2 is pre-alpha, expected Q1 2026 — do NOT upgrade yet |
| `zod` (via `zod/v4`) | `^4.3.6` | Output schema definition + validation | Already in use. `outputSchema` field on `registerTool()` causes SDK to include the schema in the MCP tool manifest, enabling client-side validation and LLM understanding of response shape |
| TypeScript | `^5.9.3` | Type safety across tool → service boundary | Already in use |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new needed | — | — | The existing stack is sufficient for this redesign |

No new dependencies are required for the VIP generic pricing redesign. The existing `@modelcontextprotocol/sdk`, `zod/v4`, and `supabase-js` handle everything.

---

## Response Structure Pattern

### Use the dual `content` + `structuredContent` pattern (already established in this codebase)

The existing `runTool()` helper in `src/tools/events.ts` already implements the correct pattern. Match it exactly:

```typescript
return {
  content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
  structuredContent: output as unknown as Record<string, unknown>,
};
```

**Why this works:**
- `structuredContent` — the canonical machine-readable form. MCP spec 2025-06-18 introduced this as the formal structured output field. Used by clients that understand it.
- `content[0].text` — serialized JSON fallback for clients that only understand text content. Required for backwards compatibility per spec.
- `outputSchema` on the tool definition — publishes the Zod schema in the MCP tool manifest. Clients and LLMs can use this to understand the response shape before calling the tool.

**Confidence:** HIGH — this is exactly what the MCP 2025-06-18 spec mandates, and the codebase already does it correctly in all other tools.

### What NOT to return

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Pre-formatted prose in tool response | Bakes presentation into the server — Ember can't adapt tone/language | Return structured fields; let Ember format |
| Per-table availability status arrays | Venues don't maintain this; implies false accuracy | Weekday/weekend min spend ranges |
| Raw `vip_table_availability` rows | Too granular, implies specificity the data doesn't have | Aggregated `weekday_min_spend` / `weekend_min_spend` |
| Null-heavy optional fields | Forces agent to check null before every field | Use concrete values or omit the field if genuinely absent |

---

## Semantic Field Design for Pricing Data

This is the highest-leverage decision for conversational quality. Field names and descriptions are read by the LLM — they shape how Ember reasons about and presents data.

### Pricing range fields — name them for what they mean, not how they're stored

```typescript
// Good — maps to how a human would say it
weekday_min_spend: number | null,       // "¥100,000 minimum on weekdays"
weekend_min_spend: number | null,       // "¥200,000 minimum on weekends"
currency: "JPY",
pricing_note: string | null,            // human-readable caveat: "1 bottle minimum (cheapest ¥60K)"

// Bad — internal DB terminology leaking out
default_min_spend: number | null,       // what's a "default"?
min_spend_amount: number,              // amount of what?
pricing_approximate: boolean,          // LLM may ignore or misinterpret this flag
```

### Include a `_context_for_agent` field for Ember-specific guidance

Research on MCP tool descriptions (arxiv 2602.14878) shows that 97% of tool descriptions lack usage guidance, and adding explicit behavioral guidance improves task success by ~6-15 percentage points. The cleanest place for per-response guidance is a dedicated string field:

```typescript
pricing_context: string | null
// Example: "Prices are minimum spend per table, not per person.
//  Actual spend typically higher — bottles, service charge not included."
```

The agent reads this alongside the data and can weave it into its response naturally. This is more robust than trying to encode all caveats in the tool description alone.

### Event context field — conversational hook

The PROJECT.md requirement includes "relevant event info for the requested date (e.g., 'busy night — cool event tonight')". This should be a ready-to-use string, not raw event data:

```typescript
event_context: string | null
// Example: "Special event tonight: Honey Dijon b2b Peggy Gou"
// Example: "No special event scheduled"
// NOT: the full EventSummary object (too much data, Ember doesn't need lineup/price/flyer here)
```

**Why a string, not an EventSummary object:** The VIP pricing tool has one job — give pricing info and a booking hook. Event data is a contextual hint, not the primary payload. An EventSummary with 8+ fields dilutes the tool's focus and wastes context tokens. A concise string is sufficient.

### Table chart image — return a public URL, nothing more

```typescript
table_chart_url: string | null
// Example: "https://...supabase.co/storage/v1/object/public/vip-table-charts/{venue_id}/table-chart.png"
```

The existing data already stores chart images in Supabase Storage per venue. Return the public URL directly. Ember can present it as "here's the table layout" without needing to understand storage internals.

---

## Tool Description Engineering

The `description` field on `server.registerTool()` is prompt text injected into Ember's context. It determines when Ember calls the tool and what it does with the result.

For the redesigned VIP pricing tool, the description must do three things explicitly:

1. **State what the tool does** — returns generic pricing ranges, not real-time availability
2. **State what it does NOT do** — explicitly say it doesn't show per-table live status
3. **Guide Ember's response behavior** — tell Ember to offer to submit a booking inquiry after presenting pricing

```typescript
// Good description — behavioral guidance embedded
description: `Get VIP table pricing information for a venue on a given date.
Returns weekday/weekend minimum spend ranges and a table chart image URL.
Does NOT return real-time per-table availability — venues don't maintain that data.
After presenting pricing, offer to submit a booking inquiry on the user's behalf.`

// Bad description — too sparse, Ember improvises
description: "Get VIP pricing for a venue."
```

**Why this matters:** Research (arxiv 2602.14878) confirms that descriptions with explicit guidelines (when/how to use) improve intermediate task completion by 15% vs descriptions that only state purpose. For a conversational flow where Ember must transition from "here's pricing" to "want me to check with the venue?", the transition needs to be in the description.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Structured JSON + prose Ember prompt | Prose tool response (pre-formatted text) | Only if the target agent has no system prompt control — e.g., a generic client with no customization |
| `weekday_min_spend` / `weekend_min_spend` as top-level fields | Return full per-day array from `vip_table_day_defaults` | If you need per-day precision (Mon vs Thu pricing differs) — not needed here since the goal is generic ranges |
| `event_context: string` (summary string) | `nearest_event: EventSummary` (full object) | If the downstream agent needs to deep-link to the event or show lineup — not needed for VIP pricing flow |
| `pricing_context: string` (free-form hint) | `pricing_approximate: boolean` flag | Boolean flags require Ember to know what to do with `true` — prose is more reliably acted on |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@modelcontextprotocol/sdk` v2 (pre-alpha) | Not production-stable; anticipated Q1 2026. The codebase uses `^1.26.0` — stay on 1.x | Stay on `^1.26.0` / `1.27.x` |
| Raw Supabase `vip_table_availability` rows in tool response | Per-table data implies real-time accuracy the venues don't provide | Aggregate to weekday/weekend ranges in the service layer |
| `structuredContent` without `outputSchema` | LLM doesn't know the response shape at tool selection time; misses validation | Always pair with `outputSchema` on `registerTool()` |
| Image data embedded in response (base64) | Wastes context tokens; table chart images are already in public Supabase Storage | Return a `table_chart_url: string` pointing to the public URL |

---

## Stack Patterns by Variant

**If the venue has no pricing data (no day-defaults, no venue default):**
- Return `weekday_min_spend: null`, `weekend_min_spend: null`
- Return `pricing_context: "Contact venue directly for pricing"` rather than omitting the field
- Return `venue_open: false` if operating hours confirm the venue is closed on that day

**If the venue has pricing for weekends but not weekdays:**
- Return `weekday_min_spend: null`, `weekend_min_spend: 200000`
- Return `pricing_context: "Weekend pricing confirmed. Weekday pricing not available — contact venue."`
- Do not invent a weekday number from the weekend figure

**If the requested date is outside the date where pricing is known:**
- Fall back to day-of-week from `vip_table_day_defaults` (existing 4-level fallback logic still applies)
- Surface the pricing even if `booking_date` is approximate

---

## Version Compatibility

| Package | Version | Notes |
|---------|---------|-------|
| `@modelcontextprotocol/sdk` | `^1.26.0` | Pin to 1.x. v2 breaks API; not production-ready as of 2026-03-10 |
| `zod` | `^4.3.6` (imported as `zod/v4`) | Already in use. `outputSchema` on `registerTool()` takes a Zod schema object — return the same schema instance used for validation |
| `@supabase/supabase-js` | `^2.97.0` | No changes needed for this feature |

---

## Sources

- [MCP Tools Specification (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — `structuredContent`, `outputSchema`, content types, backwards compat requirement — HIGH confidence
- [Anthropic: Implement Tool Use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) — "return only high-signal information", lean response design, stable identifiers — HIGH confidence
- [arxiv: MCP Tool Descriptions Are Smelly (2602.14878)](https://arxiv.org/html/2602.14878v1) — tool description quality, 6-component framework, 15% improvement from guidelines — MEDIUM confidence (academic paper, not official docs)
- [TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — v1.x production stable, v2 pre-alpha, 1.27.1 current — HIGH confidence
- [npm: @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — current version 1.27.1 — HIGH confidence
- [Zod v4 Release Notes](https://zod.dev/v4) — `zod/v4` import path, breaking changes from v3 — HIGH confidence
- Existing codebase (`src/tools/events.ts`, `src/tools/venues.ts`) — `runTool()` helper, dual content/structuredContent pattern — HIGH confidence (source of truth for this project)

---

*Stack research for: VIP generic pricing redesign — MCP tool response design for conversational AI*
*Researched: 2026-03-10*
