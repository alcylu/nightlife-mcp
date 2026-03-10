# Phase 1: MCP Pricing Tool - Research

**Researched:** 2026-03-10
**Domain:** TypeScript MCP tool + Express REST endpoint, Supabase queries, service-day date logic
**Confidence:** HIGH — all findings drawn from direct codebase inspection

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VPRC-01 | MCP tool returns weekday and weekend minimum spend ranges per venue (aggregated from day-defaults) | `vip_table_day_defaults` rows carry `day_of_week` (0-6) and `min_spend`. Aggregate by querying all rows for venue, grouping by weekday (Mon-Thu) vs weekend (Fri-Sat, with Sun at venue discretion). |
| VPRC-02 | MCP tool checks venue operating hours; returns `venue_open: false` if closed on requested date | `resolveClosedDates()` in `services/vipTables.ts` already implements this check (event-backed + `venue_operating_hours` table). Reuse or extract for new service. |
| VPRC-03 | MCP tool returns zone-level pricing summary (zone name, capacity range, weekday min, weekend min) | Zones are stored in `vip_venue_tables.zone`. Join to `vip_table_day_defaults` via `vip_venue_table_id`. Group by zone to derive capacity range and per-zone min spends. |
| VPRC-04 | MCP tool returns table chart image URL when available | Chart image URL is stored in `vip_venue_tables.metadata->>'layout_image_url'`. `extractLayoutImageUrl()` helper already exists in `services/vipTables.ts`. |
| VPRC-05 | MCP tool returns `pricing_configured: false` with message when no pricing data exists | Detected when `vip_table_day_defaults` query returns 0 rows for the venue AND no `vip_default_min_spend` on the venue row. |
| VPRC-06 | MCP tool returns booking affordance fields (`booking_supported`, `booking_note`) | `venues.vip_booking_enabled` is already fetched in `resolveVenue()`. Map to `booking_supported: boolean` + optional `booking_note` string. |
| VPRC-09 | MCP tool uses service-day date resolution (6am JST cutoff) for day-of-week classification | `getCurrentServiceDate()` and `serviceDateWindowToUtc()` in `utils/time.ts` handle this. Use `getCurrentServiceDate()` when input date is "tonight", then derive day-of-week via `new Date(\`\${serviceDate}T00:00:00Z\`).getUTCDay()`. |
| REST-01 | GET `/api/v1/venues/:id/vip-pricing` returns same data as MCP tool | Add route to `rest.ts`. Call the same service function used by the MCP tool. |
| REST-02 | REST endpoint uses shared API key auth middleware | `createApiKeyAuthMiddleware` from `middleware/apiKeyAuth.ts` is already wired to the `router` mounted at `/api/v1` in `http.ts`. No extra wiring needed — new route inherits it. |
| LIFE-02 | New `get_vip_pricing` tool description includes behavioral guidance for agents | MCP SDK `registerTool` description field supports multi-line strings. Pattern established in existing tools. Add when/what/after guidance in description. |
</phase_requirements>

---

## Summary

Phase 1 builds a single `get_vip_pricing` MCP tool and a matching REST endpoint that replace the conceptual role of `get_vip_table_availability` + `get_vip_table_chart`. The new tool presents honest, generic weekday/weekend pricing ranges aggregated from `vip_table_day_defaults` — not per-table live availability.

The codebase already contains all the data access primitives needed. The operating-hours gate (`resolveClosedDates`), venue resolution (`resolveVenue`), day-default query (`fetchTableDayDefaults`), chart image extraction (`extractLayoutImageUrl`), city/timezone context (`fetchCityContext`), and service-date utilities (`getCurrentServiceDate`) all exist in `services/vipTables.ts` and `utils/time.ts`. The new service layer (`services/vipPricing.ts`) will compose these functions, not rewrite them.

The old tools `get_vip_table_availability` and `get_vip_table_chart` stay registered in `tools/vipTables.ts` with a deprecation note but their behavior is unchanged. The new tool is registered separately, and a new registration function (`registerVipPricingTool`) is added to `tools/vipTables.ts` and wired in `server.ts`. The REST endpoint is a straightforward addition to `rest.ts`.

**Primary recommendation:** Implement the service layer in a new file `src/services/vipPricing.ts`, register the MCP tool in `src/tools/vipTables.ts` (keeping old tools), add REST route to `src/rest.ts`. No DB schema changes required.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.26.0 | MCP tool registration, `registerTool`, outputSchema | Already the project's MCP SDK |
| `zod` (v4 import path) | ^4.3.6 | Input/output schema definition | Already in use; project imports from `zod/v4` |
| `@supabase/supabase-js` | ^2.97.0 | DB queries for `vip_table_day_defaults`, `venues`, `venue_operating_hours` | Already the project's DB client |
| `date-fns-tz` | ^3.2.0 | Timezone-aware date math (used in `utils/time.ts`) | Already installed; `fromZonedTime` is used |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `express` | ^5.2.1 | REST endpoint routing in `rest.ts` | For the `GET /api/v1/venues/:id/vip-pricing` route |

**Installation:** No new dependencies needed. All required packages already installed.

---

## Architecture Patterns

### Recommended Project Structure

The new work touches these files only:

```
src/
├── services/
│   └── vipPricing.ts        # NEW: GetVipPricingInput, getVipPricing()
├── tools/
│   └── vipTables.ts         # MODIFIED: add registerVipPricingTool(); keep old tools
├── rest.ts                  # MODIFIED: add GET /venues/:id/vip-pricing route
├── server.ts                # MODIFIED: call registerVipPricingTool()
└── types.ts                 # MODIFIED: add VipPricingResult interface
```

### Pattern 1: Service Layer (`services/vipPricing.ts`)

**What:** Single async function `getVipPricing(supabase, input)` that orchestrates DB queries and returns a typed result. No business logic in the tool layer.

**Input type:**
```typescript
export type GetVipPricingInput = {
  venue_id: string;
  date?: string;   // "tonight" | YYYY-MM-DD | undefined (defaults to next available)
};
```

**Output type (add to `types.ts`):**
```typescript
export interface VipZonePricingSummary {
  zone: string;
  capacity_min: number | null;
  capacity_max: number | null;
  weekday_min_spend: number | null;
  weekend_min_spend: number | null;
  currency: string;
}

export interface VipPricingResult {
  venue_id: string;
  venue_name: string | null;
  venue_open: boolean;
  venue_closed_message: string | null;   // non-null when venue_open=false
  pricing_configured: boolean;
  pricing_not_configured_message: string | null;
  weekday_min_spend: number | null;      // lowest min_spend across weekday defaults
  weekend_min_spend: number | null;      // lowest min_spend across weekend defaults
  currency: string;
  zones: VipZonePricingSummary[];
  layout_image_url: string | null;
  booking_supported: boolean;
  booking_note: string | null;
  generated_at: string;
  service_date: string | null;           // resolved service date used for open-day check
}
```

**Logic flow:**
1. Validate UUID, resolve venue from `venues` table (need: `id`, `name`, `city_id`, `vip_booking_enabled`, `vip_default_min_spend`, `vip_default_currency`)
2. Resolve city context (timezone, cutoff) via `fetchCityContext()`
3. Determine `serviceDate`: if `date` param is present and is "tonight", call `getCurrentServiceDate(new Date(), timezone, cutoff)`; if YYYY-MM-DD, use directly; if absent, use current service date
4. Run open-day check: call `resolveClosedDates()` with single date — if closed, return early with `venue_open: false`
5. Fetch all `vip_table_day_defaults` for venue (all rows, no date filtering — aggregate across days)
6. Fetch active `vip_venue_tables` for the venue (need: `id`, `zone`, `capacity_min`, `capacity_max`, `metadata`)
7. Aggregate weekday/weekend ranges and zone summaries
8. Extract `layout_image_url` from first table's metadata that has one
9. Return `VipPricingResult`

**Day-of-week classification for weekday vs weekend:**
```typescript
// 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
// Weekend: day_of_week in [5, 6]  (Fri, Sat)
// Weekday: day_of_week in [0, 1, 2, 3, 4]  (Sun, Mon, Tue, Wed, Thu)
// Note: Tokyo club "weekday" includes Sunday (last night of weekend is typically lower spend)
// Adjust if product decision differs — keep flexible
```

**Aggregation logic:**
```typescript
// From all vip_table_day_defaults rows for venue:
// - Group by zone (via table's zone field)
// - For each group: find min of weekday min_spends, min of weekend min_spends
// - Venue-level weekday_min_spend = min across all weekday rows
// - pricing_configured = dayDefaultRows.length > 0 || venue.vip_default_min_spend != null
```

**CRITICAL: Per-date override check for service date**

STATE.md blocker note: "Service layer must check `vip_table_availability` per-date overrides before falling back to day-defaults — special event nights have explicit pricing that must not be suppressed."

This means when a specific date is requested (not just "what are the ranges"), the service should check `vip_table_availability` for that date and, if found, prefer those values for the weekday/weekend min spend display. This is only relevant when a date is provided. The response can flag this with a note (e.g., `pricing_source: "event_override"` vs `"day_defaults"`).

### Pattern 2: Tool Registration (`tools/vipTables.ts`)

**What:** Add `registerVipPricingTool(server, deps)` function at the bottom of the file. Keep the existing `registerVipTableTools` function unchanged.

**Tool description (LIFE-02) — behavioral guidance string:**
```typescript
const DESCRIPTION = `Get VIP pricing information for a venue. Returns honest weekday and weekend minimum spend ranges, zone summaries, table chart image URL, and booking affordance.

WHEN TO CALL: When a user asks about VIP tables, VIP pricing, bottle service costs, minimum spend, or table reservations at a specific venue.

WHAT TO DO AFTER:
- Present pricing conversationally ("Weekday minimums start around ¥100K, weekends from ¥200K")
- Show table chart URL as a layout reference only — do not infer availability from the image
- If booking_supported is true and user is interested, offer to submit an inquiry via create_vip_booking_request
- Do NOT suggest specific table codes unless the user asks

DO NOT CALL when venue_open is false — no pricing is available for closed nights.`;
```

**Input schema:**
```typescript
export const vipPricingInputSchema = {
  venue_id: z.string().uuid(),
  date: z.string().optional(),  // "tonight" | YYYY-MM-DD
};
```

**Output schema:** Mirror `VipPricingResult` as a Zod schema. Follow exact pattern from `vipTableAvailabilityOutputSchema`.

**runTool pattern:** Reuse the existing `runTool()` helper in `tools/vipTables.ts` — it handles metrics, logging, error normalization, and structured content.

### Pattern 3: REST Endpoint (`rest.ts`)

**What:** Add to the existing `createRestRouter` function before the `return router` statement.

```typescript
// GET /api/v1/venues/:id/vip-pricing
router.get("/venues/:id/vip-pricing", async (req, res) => {
  try {
    const result = await getVipPricing(supabase, {
      venue_id: req.params.id,
      date: str(req.query.date),
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});
```

Import `getVipPricing` from `./services/vipPricing.js` at top of file.

Note: Express router matches routes in registration order. `GET /venues/:id/vip-pricing` must be registered BEFORE `GET /venues/:id` to avoid the catch-all matching "vip-pricing" as an ID. Check the existing registration order in `rest.ts`.

### Pattern 4: `server.ts` Wiring

Import `registerVipPricingTool` from `./tools/vipTables.js` and call it alongside the existing `registerVipTableTools(server, { supabase })` line.

### Anti-Patterns to Avoid

- **Don't query `vip_table_availability` for the pricing ranges themselves.** That table is for per-date overrides; the base ranges come from `vip_table_day_defaults`. Only check per-date overrides when a specific date is requested.
- **Don't throw when `pricing_configured: false`.** Return a valid response object with the flag set and a message. The tool should never error for a venue that simply has no pricing data configured.
- **Don't add the new tool as a new file.** Keep tool registration in `tools/vipTables.ts` — the codebase pattern is one file per domain, not one file per tool.
- **Don't duplicate `resolveClosedDates`.** It's an `async function` (not exported) in `services/vipTables.ts`. If it can't be reused directly, extract it to a shared helper or replicate the logic with clear attribution. Since the new service is a sibling file, the cleanest option is to either: (a) export `resolveClosedDates` from `services/vipTables.ts`, or (b) copy the logic into `services/vipPricing.ts` (acceptable since it's self-contained).
- **Don't put `config` in the service function signature.** Existing VIP service functions take only `(supabase, input)`. Config is not needed for pricing queries.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Service-day date resolution | Custom cutoff logic | `getCurrentServiceDate()` in `utils/time.ts` | Already handles 6am JST cutoff, tested |
| Venue closed check | Custom event/hours query | `resolveClosedDates()` in `services/vipTables.ts` | Event-backed + operating hours, tested |
| City timezone/cutoff lookup | Inline Supabase query | `fetchCityContext()` in `services/vipTables.ts` | Handles null city_id gracefully |
| Chart image URL extraction | Inline metadata access | `extractLayoutImageUrl()` in `services/vipTables.ts` | Handles JSON parse, URL validation |
| UUID validation | Custom regex | `ensureUuid()` in `services/vipTables.ts` | Already throws correct `NightlifeError` |
| Tool error handling + metrics | Try/catch inline | `runTool()` in `tools/vipTables.ts` | Handles metrics recording, error normalization, structuredContent |
| Day-of-week from ISO date | Custom date math | `new Date(\`\${date}T00:00:00Z\`).getUTCDay()` | UTC-based, already the project pattern |

---

## Common Pitfalls

### Pitfall 1: Route Ordering in Express
**What goes wrong:** `GET /venues/:id` catches requests to `/venues/:id/vip-pricing` if registered first, treating `vip-pricing` as the ID value.
**Why it happens:** Express route matching is first-match-wins. `:id` is a wildcard.
**How to avoid:** Register `/venues/:id/vip-pricing` BEFORE `/venues/:id` in `rest.ts`. Verify by checking current order when editing.
**Warning signs:** `getVenueInfo()` is called with `venue_id = "vip-pricing"` and returns 404.

### Pitfall 2: `zod/v4` Import Path
**What goes wrong:** Importing from `"zod"` instead of `"zod/v4"` breaks at runtime — the project uses Zod v4 but via the `zod/v4` subpath export.
**Why it happens:** Zod v4 ships with both `import * as z from "zod"` (v3 compat shim) and `import * as z from "zod/v4"` (native v4). The project explicitly uses `zod/v4`.
**How to avoid:** Always import `import * as z from "zod/v4"` — copy the pattern from any existing tool file.
**Warning signs:** Type errors on `.uuid()`, `.min()` or Zod v3 behavior.

### Pitfall 3: Missing `vip_venue_tables` Join for Zone Data
**What goes wrong:** Querying `vip_table_day_defaults` alone does not give zone names or capacity ranges — those live on `vip_venue_tables`.
**Why it happens:** The schema is split: `vip_table_day_defaults` has `vip_venue_table_id` (FK) but not zone/capacity.
**How to avoid:** Fetch both `vip_venue_tables` (zone, capacity_min, capacity_max, metadata) and `vip_table_day_defaults`, then join in TypeScript by `vip_venue_table_id = table.id`.
**Warning signs:** Zone summaries array is empty or zones show as null.

### Pitfall 4: `pricing_configured` False Positive
**What goes wrong:** A venue with `vip_default_min_spend` set but zero `vip_table_day_defaults` rows still has approximate pricing — don't set `pricing_configured: false` in that case.
**Why it happens:** The pricing configured check must also consider the venue-level fallback.
**How to avoid:** `pricing_configured = dayDefaultRows.length > 0 || venue.vip_default_min_spend != null`
**Warning signs:** Zouk/1 Oak/CÉ LA VI return `pricing_configured: false` despite having seeded data.

### Pitfall 5: Per-Date Override Suppression
**What goes wrong:** On a special event night, `vip_table_availability` has explicit higher pricing (e.g., ¥500K on New Year's Eve). The generic day-default range shows ¥200K. If the tool only reads day-defaults, it misleads agents.
**Why it happens:** Day-defaults are structural templates; `vip_table_availability` is the override layer.
**How to avoid:** When `date` param is provided, check `vip_table_availability` for that specific date. If explicit rows exist, derive `event_min_spend` from them and note it in the response (e.g., `event_pricing_note: "Special event pricing applies — actual minimums may differ"`).
**Warning signs:** Explicitly documented in STATE.md as a known concern.

### Pitfall 6: Missing `es` Module `.js` Extensions
**What goes wrong:** Importing `./services/vipPricing` without `.js` extension fails at runtime since the project is `"type": "module"` and Node.js requires explicit extensions in ESM.
**Why it happens:** TypeScript transpiles `.ts` → `.js` but source imports must use `.js` extension even in `.ts` files.
**How to avoid:** Always write `import { getVipPricing } from "./services/vipPricing.js"` — copy the pattern from any existing import in the codebase.

### Pitfall 7: Venue with Zero `venue_operating_hours` Rows
**What goes wrong:** WARP venue (mentioned in CLAUDE.md) has 0 rows in `venue_operating_hours`. In `resolveClosedDates`, the `hasOperatingHours = operatingHours.size > 0` check handles this — no hours = not closed. Must replicate this behavior.
**Why it happens:** Unconfigured venues should not be blocked.
**How to avoid:** When reusing/copying `resolveClosedDates`, keep the `hasOperatingHours` guard intact.

---

## Code Examples

### Aggregating day-default rows into weekday/weekend ranges

```typescript
// Source: derived from services/vipTables.ts fetchTableDayDefaults() pattern

type DayDefaultRow = {
  vip_venue_table_id: string;
  day_of_week: number;   // 0=Sun..6=Sat
  min_spend: number | string | null;
  currency: string | null;
};

type TableRow = {
  id: string;
  zone: string | null;
  capacity_min: number | null;
  capacity_max: number | null;
};

function isWeekend(dow: number): boolean {
  return dow === 5 || dow === 6; // Fri=5, Sat=6
}

function aggregatePricing(tables: TableRow[], dayDefaults: DayDefaultRow[]) {
  const tableById = new Map(tables.map((t) => [t.id, t]));

  // Venue-level aggregate
  let weekdayMin: number | null = null;
  let weekendMin: number | null = null;

  // Zone-level
  const zoneMap = new Map<string, {
    capacities: number[];
    weekdayMins: number[];
    weekendMins: number[];
    currency: string;
  }>();

  for (const row of dayDefaults) {
    const spend = typeof row.min_spend === "string"
      ? Number(row.min_spend)
      : row.min_spend;
    if (spend === null || !Number.isFinite(spend)) continue;

    const table = tableById.get(row.vip_venue_table_id);
    const zone = table?.zone ?? "General";
    const currency = row.currency ?? "JPY";

    if (!zoneMap.has(zone)) {
      zoneMap.set(zone, { capacities: [], weekdayMins: [], weekendMins: [], currency });
    }
    const zd = zoneMap.get(zone)!;

    if (table?.capacity_min != null) zd.capacities.push(table.capacity_min);
    if (table?.capacity_max != null) zd.capacities.push(table.capacity_max);

    if (isWeekend(row.day_of_week)) {
      weekendMin = weekendMin === null ? spend : Math.min(weekendMin, spend);
      zd.weekendMins.push(spend);
    } else {
      weekdayMin = weekdayMin === null ? spend : Math.min(weekdayMin, spend);
      zd.weekdayMins.push(spend);
    }
  }

  const zones = Array.from(zoneMap.entries()).map(([zone, zd]) => ({
    zone,
    capacity_min: zd.capacities.length > 0 ? Math.min(...zd.capacities) : null,
    capacity_max: zd.capacities.length > 0 ? Math.max(...zd.capacities) : null,
    weekday_min_spend: zd.weekdayMins.length > 0 ? Math.min(...zd.weekdayMins) : null,
    weekend_min_spend: zd.weekendMins.length > 0 ? Math.min(...zd.weekendMins) : null,
    currency: zd.currency,
  }));

  return { weekday_min_spend: weekdayMin, weekend_min_spend: weekendMin, zones };
}
```

### Zod output schema pattern (from `tools/vipTables.ts`)

```typescript
// Source: src/tools/vipTables.ts — vipTableAvailabilityOutputSchema
import * as z from "zod/v4";

const vipZonePricingSummarySchema = z.object({
  zone: z.string(),
  capacity_min: z.number().int().nullable(),
  capacity_max: z.number().int().nullable(),
  weekday_min_spend: z.number().nullable(),
  weekend_min_spend: z.number().nullable(),
  currency: z.string(),
});

export const vipPricingOutputSchema = z.object({
  venue_id: z.string(),
  venue_name: z.string().nullable(),
  venue_open: z.boolean(),
  venue_closed_message: z.string().nullable(),
  pricing_configured: z.boolean(),
  pricing_not_configured_message: z.string().nullable(),
  weekday_min_spend: z.number().nullable(),
  weekend_min_spend: z.number().nullable(),
  currency: z.string(),
  zones: z.array(vipZonePricingSummarySchema),
  layout_image_url: z.string().url().nullable(),
  booking_supported: z.boolean(),
  booking_note: z.string().nullable(),
  generated_at: z.string(),
  service_date: z.string().nullable(),
});
```

### runTool pattern (from `tools/vipTables.ts`)

```typescript
// Source: src/tools/vipTables.ts — runTool()
server.registerTool(
  "get_vip_pricing",
  {
    description: DESCRIPTION,
    inputSchema: vipPricingInputSchema,
    outputSchema: vipPricingOutputSchema,
  },
  async (args) => runTool(
    "get_vip_pricing",
    vipPricingOutputSchema,
    async () => getVipPricing(deps.supabase, args),
  ),
);
```

### REST endpoint pattern (from `rest.ts`)

```typescript
// Source: src/rest.ts — existing route pattern
router.get("/venues/:id/vip-pricing", async (req, res) => {
  try {
    const result = await getVipPricing(supabase, {
      venue_id: req.params.id,
      date: str(req.query.date),
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 2-tool flow: `get_vip_table_availability` + `get_vip_table_chart` | 1-tool: `get_vip_pricing` | Phase 1 | Simpler agent flow; pricing not implied to be live |
| Per-table status ("available", "held", "booked") | Generic ranges (weekday/weekend min spend) | Phase 1 | Honest, maintainable; venues don't update table status |
| No booking affordance in tool response | Explicit `booking_supported` + `booking_note` | Phase 1 | Agent knows when to offer inquiry without extra tool call |

**Old tools that remain (not removed until Phase 3 / LIFE-01):**
- `get_vip_table_availability`: Stays registered, description updated with deprecation note
- `get_vip_table_chart`: Stays registered, description updated with deprecation note

---

## Open Questions

1. **Sunday classification: weekend or weekday?**
   - What we know: `day_of_week=0` (Sunday). Tokyo clubs often open Sunday as a "last night of weekend" event, but the seeded data (Zouk: Wed-Thu=weekday, Fri-Sat=weekend; CÉ LA VI: Sun-Thu=weekday, Fri-Sat=weekend) treats Sunday as weekday.
   - What's unclear: Should the aggregation classify Sun-Thu as weekday and Fri-Sat as weekend, matching the seeded data?
   - Recommendation: Classify based on which days have pricing rows — the day-defaults data itself is the authority. Compute weekday/weekend based on presence of rows, not a hardcoded heuristic. If day 0 rows exist, classify them with weekday since that's the seeded pattern. Document the classification logic clearly.

2. **What currency to use when zone rows have mixed currencies?**
   - What we know: All seeded data uses JPY. The DB allows any 3-letter currency code.
   - What's unclear: If two zones have different currencies, the top-level `currency` field is ambiguous.
   - Recommendation: Use the most common currency across rows, defaulting to "JPY". For zone level, use the zone's own currency.

3. **Should `date` param support "this_weekend" or date ranges?**
   - What we know: The open-day check requires a single date; the pricing aggregation spans all days.
   - What's unclear: Whether "this_weekend" makes semantic sense for a pricing query.
   - Recommendation: Accept only "tonight" and YYYY-MM-DD for Phase 1. The open-day check is the only date-dependent logic, and it needs a single date.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) via `tsx --test` |
| Config file | None — invoked via `npm test` = `tsx --test src/**/*.test.ts` |
| Quick run command | `cd /Users/alcylu/Apps/nightlife-mcp && npm test -- --test-name-pattern "vipPricing"` |
| Full suite command | `cd /Users/alcylu/Apps/nightlife-mcp && npm test` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VPRC-01 | Aggregates weekday/weekend min spend from day-defaults | unit | `npm test -- --test-name-pattern "getVipPricing"` | ❌ Wave 0 |
| VPRC-02 | Returns `venue_open: false` for closed venue | unit | `npm test -- --test-name-pattern "closed venue"` | ❌ Wave 0 |
| VPRC-03 | Zone summaries contain correct capacity range and pricing | unit | `npm test -- --test-name-pattern "zone summary"` | ❌ Wave 0 |
| VPRC-04 | Returns `layout_image_url` when present in table metadata | unit | `npm test -- --test-name-pattern "layout_image_url"` | ❌ Wave 0 |
| VPRC-05 | Returns `pricing_configured: false` when no day-defaults exist | unit | `npm test -- --test-name-pattern "pricing_configured"` | ❌ Wave 0 |
| VPRC-06 | Returns `booking_supported` from venue `vip_booking_enabled` | unit | `npm test -- --test-name-pattern "booking_supported"` | ❌ Wave 0 |
| VPRC-09 | Service-date "tonight" resolves correctly via JST cutoff | unit | `npm test -- --test-name-pattern "service.date"` | ❌ Wave 0 (reuse existing time.ts tests) |
| REST-01 | REST endpoint returns same shape as MCP tool | unit | `npm test -- --test-name-pattern "vipPricingOutputSchema"` | ❌ Wave 0 |
| REST-02 | Auth middleware applies to new endpoint | manual | Manual curl with/without key | — |
| LIFE-02 | Tool description contains when/what/after guidance | unit | `npm test -- --test-name-pattern "tool description"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --test-name-pattern "vipPricing"`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/vipPricing.test.ts` — covers VPRC-01 through VPRC-06, VPRC-09
- [ ] `src/tools/vipTables.test.ts` — extend existing file with `vipPricingOutputSchema` schema tests (REST-01, LIFE-02)
- [ ] No new framework install required — `node:test` + `tsx` already in place

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/services/vipTables.ts` (operating hours logic, day-defaults query, 4-level pricing fallback, ~1000 lines)
- Direct codebase inspection — `src/tools/vipTables.ts` (tool registration pattern, runTool helper, Zod schemas)
- Direct codebase inspection — `src/utils/time.ts` (service-day logic, cutoff handling)
- Direct codebase inspection — `src/rest.ts` (REST endpoint pattern, sendError, router structure)
- Direct codebase inspection — `src/middleware/apiKeyAuth.ts` (auth middleware — confirms REST-02 is automatic)
- Direct codebase inspection — `src/server.ts` (tool registration wiring)
- Direct codebase inspection — `src/types.ts` (existing type definitions)
- Direct codebase inspection — `src/errors.ts` (NightlifeError, error codes)
- Direct codebase inspection — `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/PROJECT.md`

### Secondary (MEDIUM confidence)
- `CLAUDE.md` VIP Table Availability Logic section — confirms 4-level pricing fallback and operating-hours edge cases
- `CLAUDE.md` Seeded VIP Pricing Data section — confirms seeded day-defaults for 3 venues, day-of-week configuration, and that metadata holds the chart image URL

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified via package.json and direct import inspection
- Architecture: HIGH — patterns copied directly from working production code in same codebase
- Pitfalls: HIGH — pitfalls 1-3, 5-7 verified from source code; pitfall 4 verified from CLAUDE.md seeded data section
- DB schema: HIGH — verified via Supabase query patterns in existing service layer; confirmed column names used in live queries

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable codebase; no external dependency changes expected)
