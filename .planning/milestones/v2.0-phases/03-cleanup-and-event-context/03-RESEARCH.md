# Phase 3: Cleanup and Event Context - Research

**Researched:** 2026-03-11
**Domain:** TypeScript service layer (vipPricing.ts), Supabase event_occurrences query, MCP tool registration cleanup
**Confidence:** HIGH — all findings from direct codebase inspection; no external dependencies to verify

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LIFE-01 | Old `get_vip_table_availability` and `get_vip_table_chart` tools removed from server registration | ALREADY DONE in uncommitted code. `src/tools/vipTables.ts` only exports `registerVipPricingTool`; `src/server.ts` no longer imports or calls `registerVipTableTools`. Success criteria #1 is met. Task: commit the already-complete work. |
| VPRC-07 | MCP tool queries events for the requested date and returns event context / busy night signal | `event_occurrences` table has `name_en` and `name_i18n` columns. The existing `resolvePricingClosedDates()` in `vipPricing.ts` already queries `event_occurrences` for the requested date window and populates `datesWithEvents`. Extend this function (or add a sibling) to also capture event name when an event is found for the specific service date. |
| VPRC-08 | MCP tool returns `pricing_approximate` flag so agent can modulate language | Pricing comes from two sources: (a) `vip_table_day_defaults` rows — exact, `pricing_approximate: false`; (b) `venue.vip_default_min_spend` fallback with no day-defaults — approximate, `pricing_approximate: true`. The flag maps directly to whether day-defaults drove the aggregation. |
</phase_requirements>

---

## Summary

Phase 3 has three goals: (1) commit and verify the already-removed old tool registrations, (2) extend `getVipPricing()` in `src/services/vipPricing.ts` to return event context when a specific date is requested, and (3) add a `pricing_approximate` flag to the service output.

**Important pre-condition:** Significant Phase 3 work is already done in uncommitted code. `src/tools/vipTables.ts` already has old tools removed, and `src/server.ts` no longer calls `registerVipTableTools`. The planner must treat LIFE-01 as "commit + verify" not "implement." There is also one pre-existing failing test in `src/services/vipPricing.test.ts` (line 231: `getVipPricing returns venue_open false for closed venue` — asserts `pricing_configured: false` when venue is closed, but the service currently returns aggregated pricing regardless of venue_open status). This test failure is unrelated to Phase 3 requirements but must be resolved as part of the test suite cleanup in this phase.

For VPRC-07, the `resolvePricingClosedDates()` function in `vipPricing.ts` already queries `event_occurrences` with `start_at` only. It must be extended to also select `name_en` and `name_i18n` so the event name is available. The function already does service-date resolution (cutoff-aware), so finding the event for a specific date is a matter of capturing the name alongside the date.

For VPRC-08, the pricing fallback level is already determined during aggregation. After `aggregatePricing()` runs: if `dayDefaults.length > 0` the pricing came from day-defaults (exact); if `dayDefaults.length === 0` but `vip_default_min_spend` is non-null, the pricing came from the venue-level fallback (approximate). The flag is boolean and lives at the top level of `VipPricingResult`.

**Primary recommendation:** Two plans. Plan 03-01: fix failing test + add event context (VPRC-07) — extend `resolvePricingClosedDates` to capture event name, add `event_name` and `busy_night` fields to service output and schemas. Plan 03-02: add `pricing_approximate` flag (VPRC-08) + commit LIFE-01 uncommitted work + deploy + verify.

---

## Current State of Uncommitted Work

This is critical context for the planner — some Phase 3 work is already done but not committed:

| File | Current State | What Changed |
|------|--------------|--------------|
| `src/tools/vipTables.ts` | Only `registerVipPricingTool` remains | Old `registerVipTableTools` and old tool handlers removed |
| `src/server.ts` | `registerVipTableTools` import and call removed | Only `registerVipPricingTool` wired |
| `src/services/vipPricing.ts` | No-date calls skip open-day check, return general pricing | Minor behavior change for calls without `date` param |
| `src/tools/vipTables.test.ts` | Old schema tests removed | Only `get_vip_pricing` schema tests remain |

LIFE-01 success criterion #1 is already satisfied. The task for the planner is to commit this work and verify deployment removes the old tool names.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.97.0 | Query `event_occurrences` for event name + date | Already in use throughout services |
| `zod` (via `zod/v4`) | ^4.3.6 | Extend `vipPricingOutputSchema` with new fields | Already the project schema tool |
| `node:test` + `tsx` | Built-in | Test new fields, update stub | Already the project test runner |

**Installation:** No new dependencies needed.

---

## Architecture Patterns

### Files Modified in Phase 3

```
src/
├── services/
│   └── vipPricing.ts        # MODIFY: add event_name + busy_night to return type;
│                            #         extend resolvePricingClosedDates to capture event name;
│                            #         add pricing_approximate to aggregation output
├── tools/
│   └── vipTables.ts         # MODIFY: extend vipPricingOutputSchema with new fields;
│                            #         already has old tools removed (uncommitted)
├── types.ts                 # MODIFY: add event_name + busy_night + pricing_approximate
│                            #         to VipPricingResult interface
└── services/
    └── vipPricing.test.ts   # MODIFY: fix existing failing test; add VPRC-07 + VPRC-08 tests;
                             #         update stub to return event name from event_occurrences
```

`src/server.ts` — already modified (uncommitted, no further changes needed).

### Pattern 1: Extending resolvePricingClosedDates for Event Name (VPRC-07)

**Current behavior:** Queries `event_occurrences` for `start_at` only. Returns a `Set<string>` of closed dates.

**Required change:** Also capture the event name for events that fall on the requested service date. The function signature and return type must be extended.

**New return type:**
```typescript
type PricingDateContext = {
  closedDates: Set<string>;
  eventByDate: Map<string, { name: string }>; // service date → event name
};
```

**Extended query — select `name_en` and `name_i18n` alongside `start_at`:**
```typescript
// Source: src/services/vipPricing.ts — resolvePricingClosedDates (current pattern)
const { data: eventRows } = await supabase
  .from("event_occurrences")
  .select("start_at,name_en,name_i18n")   // ADD: name_en,name_i18n
  .eq("venue_id", venueId)
  .eq("published", true)
  .gte("start_at", windowStart)
  .lt("start_at", windowEnd);
```

**Name extraction:** In `events.ts`, the `eventName()` helper uses `name_en` first, then falls back to `name_i18n` (Japanese). For `vipPricing.ts`, use the same priority: `name_en` first, then extract from `name_i18n` JSON if it has an `en` key, then fall back to `"Event"`.

Keep it simple — don't import from `events.ts`:
```typescript
function extractEventName(row: { name_en: string | null; name_i18n: unknown }): string {
  if (row.name_en) return row.name_en;
  if (row.name_i18n && typeof row.name_i18n === "object") {
    const i18n = row.name_i18n as Record<string, unknown>;
    if (typeof i18n.en === "string" && i18n.en) return i18n.en;
  }
  return "Event";
}
```

**In the loop that builds `datesWithEvents`:** After computing `serviceDate`, also store the event name in a `Map<string, string>`:
```typescript
if (!eventByDate.has(serviceDate)) {
  eventByDate.set(serviceDate, extractEventName(row));
}
```

**`getVipPricing()` integration:**
```typescript
const { closedDates, eventByDate } = await resolvePricingClosedDates(supabase, venueId, [serviceDate], city);
const venueOpen = !closedDates.has(serviceDate);
const eventName = eventByDate.get(serviceDate) ?? null;
const busyNight = eventName !== null;
```

**New fields in `VipPricingResult` (types.ts):**
```typescript
event_name: string | null;   // name of event on requested date, or null
busy_night: boolean;         // true when an event exists on requested date
```

Both fields are `null` / `false` when no date is provided.

### Pattern 2: `pricing_approximate` Flag (VPRC-08)

**Logic:** The flag is `true` when pricing comes from the venue-level `vip_default_min_spend` fallback (no day-defaults exist). It is `false` when `vip_table_day_defaults` has rows.

The old tool (`services/vipTables.ts`) applies this at per-table level (Level 3 of 4-level fallback = true). In the new `get_vip_pricing` tool, the concept is simpler: the aggregation either used day-defaults (exact) or didn't (approximate).

**In `getVipPricing()`, after calling `aggregatePricing()`:**
```typescript
const pricingApproximate = dayDefaults.length === 0 && venueDefaultMinSpend !== null;
```

**When `dayDefaults.length === 0` and `venueDefaultMinSpend !== null`:** The response currently has `pricing_configured: true` but no weekday/weekend ranges come from day-defaults. The venue-level default is approximate — `pricing_approximate: true`.

**When `dayDefaults.length > 0`:** Pricing aggregated from actual per-day rows — `pricing_approximate: false`.

**When `pricing_configured: false`:** No pricing data at all — `pricing_approximate: false` (no approximation, just no data).

**New field in `VipPricingResult` (types.ts):**
```typescript
pricing_approximate: boolean;
```

**Agent use:** When `pricing_approximate: true`, Ember should say "around ¥100K" rather than "¥100K minimum". When `false`, the figure is from per-day defaults and can be stated with more confidence.

### Pattern 3: Schema Extension (Zod + TypeScript)

**`types.ts` — add to `VipPricingResult` interface:**
```typescript
event_name: string | null;
busy_night: boolean;
pricing_approximate: boolean;
```

**`tools/vipTables.ts` — add to `vipPricingOutputSchema`:**
```typescript
event_name: z.string().nullable(),
busy_night: z.boolean(),
pricing_approximate: z.boolean(),
```

**REST endpoint:** No changes needed — it calls `getVipPricing()` and returns the result directly. New fields automatically included.

**OpenAPI spec (`openapi.ts`):** Should be updated to document the new fields. Not a blocker but good hygiene.

### Pattern 4: Test Stub Extension (VPRC-07 Tests)

The existing stub in `vipPricing.test.ts` returns `event_occurrences` with only `start_at`. To test VPRC-07, the stub must also return `name_en`:

```typescript
// Updated stub event_occurrences response
if (table === "event_occurrences") {
  return {
    select: (cols: string) => ({
      eq: () => ({
        eq: () => ({
          gte: () => ({
            lt: async () => ({
              data: eventOccurrences,  // rows now include name_en
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
}
```

The stub's `eventOccurrences` should have rows like:
```typescript
{ start_at: "2026-03-13T22:00:00+09:00", name_en: "Friday Night Special", name_i18n: null }
```

### Pre-Existing Failing Test (Must Fix in Phase 3)

The test `getVipPricing returns venue_open false for closed venue` at line 209 of `vipPricing.test.ts` asserts:
```typescript
assert.equal(result.pricing_configured, false);
assert.deepEqual(result.zones, []);
assert.equal(result.weekday_min_spend, null);
assert.equal(result.weekend_min_spend, null);
```

But the current service returns `pricing_configured: true` (day-defaults exist) and populated zones even when `venue_open: false`. The test expectation is wrong — the service should return pricing ranges for open nights even when the specific requested date is closed. This is by design (the tool description says: "When venue_open is false, the venue is closed on that specific date but general pricing ranges for open nights are still included").

**Resolution:** Fix the test assertions to match the correct behavior. When `venue_open: false`, `pricing_configured` should still reflect whether pricing data exists (it does in this test's stub), and zone/spend data should still be returned. The test should only assert `venue_open: false` and `venue_closed_message` is non-null.

### Anti-Patterns to Avoid

- **Don't add a second separate query for event context.** The `resolvePricingClosedDates()` function already queries `event_occurrences` for the date range. Extend it to also return the name rather than making a redundant second DB call.
- **Don't import from `services/events.ts`.** The `eventName()` helper there has dependencies on `occurrence_days` join that `vipPricing.ts` doesn't use. Write a minimal `extractEventName()` helper inline.
- **Don't set `busy_night: true` when no date is requested.** If `serviceDate` is null (general pricing query), both `event_name` and `busy_night` must be null/false.
- **Don't mark `pricing_approximate: true` when `pricing_configured: false`.** If there's no pricing data, the flag is `false` (nothing to approximate).
- **Don't change the `vip_table_availability` override behavior.** The `event_pricing_note` field from per-date overrides is separate from `pricing_approximate`. Both can coexist.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event name fallback from i18n JSON | Custom JSON parser | Simple `name_i18n as Record<string, unknown>` + `.en` key lookup | JSON is already parsed by Supabase client; no library needed |
| Second event query for name | Separate `from("event_occurrences")` call | Extend existing query in `resolvePricingClosedDates` to include `name_en,name_i18n` | Avoids duplicate DB round trip |
| Per-table `pricing_approximate` logic | Replicate old vipTables.ts Level-3 logic | Single boolean: `dayDefaults.length === 0 && venueDefaultMinSpend !== null` | Simpler, correct for the aggregated-pricing model |

---

## Common Pitfalls

### Pitfall 1: Stub Query Chain Depth Mismatch
**What goes wrong:** Adding `name_en,name_i18n` to the select call in `resolvePricingClosedDates` doesn't change the Supabase query chain structure — it only adds comma-separated columns to the select string. The stub's chain (`.select()` → `.eq()` → `.eq()` → `.gte()` → `.lt()`) remains the same depth, so the stub works without change to its chain structure.
**Why it matters:** If the service adds a new `.eq()` or `.order()` call, the stub chain breaks.
**How to avoid:** Don't change the chain structure — only change the select string.

### Pitfall 2: Event Name for Events Before Cutoff (Service Date vs. Calendar Date)
**What goes wrong:** A Saturday event starting at 3am (before 6am cutoff) has `start_at = 2026-03-14T03:00:00+09:00` but its service date is Friday 2026-03-13. If the user queries "2026-03-13" (Friday), the event belongs to Friday's service day, not Saturday.
**Why it happens:** The cutoff-aware service date resolution in `resolvePricingClosedDates` already handles this correctly for the `datesWithEvents` set. The same logic must be applied when capturing the event name — use `serviceDate` (already computed in the loop) as the key in `eventByDate`, not the raw calendar date.
**How to avoid:** Capture the name using the same `serviceDate` variable computed in the existing loop.

### Pitfall 3: Multiple Events on Same Date
**What goes wrong:** Two events at the same venue on the same service date — the second event overwrites the first name in `eventByDate`.
**Why it's acceptable:** Venues running two events same night is rare. Use the first event found (`if (!eventByDate.has(serviceDate))`). The `busy_night` signal is the important part, not the exact name.

### Pitfall 4: `pricing_approximate` in Response When No Date Provided
**What goes wrong:** When `serviceDate` is null (no date param), `pricing_approximate` must still be set correctly. The logic `dayDefaults.length === 0 && venueDefaultMinSpend !== null` works regardless of whether a date was provided.
**How to avoid:** Compute `pricingApproximate` after `aggregatePricing()` regardless of date param.

### Pitfall 5: Test Must Be Fixed, Not the Service
**What goes wrong:** Seeing the failing test and "fixing" the service to return empty pricing when `venue_open: false` — this would break the intended UX (show open-nights pricing even for a closed date).
**How to avoid:** Fix the test assertions, not the service behavior. The service behavior (return pricing ranges even for closed dates) is correct and documented in the tool description.

---

## Code Examples

### Extended resolvePricingClosedDates return type

```typescript
// Source: src/services/vipPricing.ts — pattern to extend

type PricingDateContext = {
  closedDates: Set<string>;
  eventByDate: Map<string, string>; // service date → event name
};

async function resolvePricingClosedDates(
  supabase: SupabaseClient,
  venueId: string,
  dates: string[],
  city: { timezone: string; cutoff: string },
): Promise<PricingDateContext> {
  if (dates.length === 0) {
    return { closedDates: new Set(), eventByDate: new Map() };
  }
  // ... existing window computation ...

  const { data: eventRows } = await supabase
    .from("event_occurrences")
    .select("start_at,name_en,name_i18n")  // extended
    .eq("venue_id", venueId)
    .eq("published", true)
    .gte("start_at", windowStart)
    .lt("start_at", windowEnd);

  const datesWithEvents = new Set<string>();
  const eventByDate = new Map<string, string>();

  for (const row of (eventRows || []) as Array<{ start_at: string; name_en: string | null; name_i18n: unknown }>) {
    // ... existing service date computation ...
    datesWithEvents.add(serviceDate);
    if (!eventByDate.has(serviceDate)) {
      eventByDate.set(serviceDate, extractEventName(row));
    }
  }

  // ... existing operating hours and closed set computation ...
  return { closedDates: closed, eventByDate };
}
```

### Minimal extractEventName helper

```typescript
// Inline in vipPricing.ts — no import from events.ts needed
function extractEventName(row: { name_en: string | null; name_i18n: unknown }): string {
  if (row.name_en) return row.name_en;
  if (row.name_i18n && typeof row.name_i18n === "object" && !Array.isArray(row.name_i18n)) {
    const i18n = row.name_i18n as Record<string, unknown>;
    if (typeof i18n.en === "string" && i18n.en) return i18n.en;
  }
  return "Event";
}
```

### pricing_approximate determination

```typescript
// After aggregatePricing() call in getVipPricing():
const venueDefaultMinSpend = coerceMinSpend(venue.vip_default_min_spend);
const pricingConfigured = dayDefaults.length > 0 || venueDefaultMinSpend !== null;
const pricingApproximate = dayDefaults.length === 0 && venueDefaultMinSpend !== null;
```

### Updated VipPricingResult interface (types.ts)

```typescript
// Add to existing VipPricingResult interface
export interface VipPricingResult {
  // ... existing fields ...
  event_name: string | null;        // name of event on requested date
  busy_night: boolean;              // true when event exists on requested date
  pricing_approximate: boolean;     // true when pricing from venue-level default (no day-defaults)
}
```

### Updated vipPricingOutputSchema (tools/vipTables.ts)

```typescript
// Add to existing z.object({...})
export const vipPricingOutputSchema = z.object({
  // ... existing fields ...
  event_name: z.string().nullable(),
  busy_night: z.boolean(),
  pricing_approximate: z.boolean(),
});
```

### VPRC-07 test example

```typescript
test("getVipPricing returns event_name and busy_night: true when event exists on date", async () => {
  const supabase = createStub({
    eventOccurrences: [
      {
        start_at: "2026-03-13T22:00:00.000Z", // Friday 22:00 UTC = Saturday 07:00 JST → service date Friday
        name_en: "Friday Night Special",
        name_i18n: null,
      },
    ],
  });

  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-13",
  });

  assert.equal(result.event_name, "Friday Night Special");
  assert.equal(result.busy_night, true);
});

test("getVipPricing returns event_name null and busy_night: false when no event", async () => {
  const supabase = createStub({ eventOccurrences: [] });
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  assert.equal(result.event_name, null);
  assert.equal(result.busy_night, false);
});
```

### VPRC-08 test example

```typescript
test("getVipPricing sets pricing_approximate: false when day-defaults exist", async () => {
  const supabase = createStub(); // DEFAULT_DAY_DEFAULTS has rows
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });
  assert.equal(result.pricing_approximate, false);
});

test("getVipPricing sets pricing_approximate: true when only vip_default_min_spend exists", async () => {
  const supabase = createStub({
    dayDefaults: [],
    venue: { ...DEFAULT_VENUE, vip_default_min_spend: 100000 },
  });
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });
  assert.equal(result.pricing_approximate, true);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Two tools: `get_vip_table_availability` + `get_vip_table_chart` | One tool: `get_vip_pricing` | Phase 1 | Simpler agent flow; no false availability signals |
| No event context in pricing response | `event_name` + `busy_night` fields | Phase 3 | Agent can tell user "there's a special event Friday — expect higher demand" |
| No `pricing_approximate` signal | `pricing_approximate: boolean` flag | Phase 3 | Agent modulates language: "around" vs. exact |
| Old tools still registered (deprecated) | Old tools completely removed | Phase 3 (LIFE-01) | Tool-not-found error on old tool names |

---

## Open Questions

1. **Should `busy_night: true` change the tool description guidance?**
   - What we know: The tool description currently says "Present pricing conversationally." VPRC-07 adds event context.
   - What's unclear: Whether to update the tool description to mention the `busy_night` signal.
   - Recommendation: Update the tool description WHAT TO DO AFTER section to include: "If busy_night is true, note the event name and that demand may be higher."

2. **When no date is provided, should `pricing_approximate` and `busy_night`/`event_name` be null or false/null?**
   - What we know: `service_date` is null when no date is provided. The new fields follow the same pattern.
   - Recommendation: `event_name: null`, `busy_night: false` (always boolean), `pricing_approximate: boolean` (computed regardless). This is consistent with `venue_open: boolean` which defaults to `true` when no date is provided.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) via `tsx --test` |
| Config file | None — invoked via `npm test` = `tsx --test src/**/*.test.ts` |
| Quick run command | `cd /Users/alcylu/Apps/nightlife-mcp && npm test -- --test-name-pattern "vipPricing"` |
| Full suite command | `cd /Users/alcylu/Apps/nightlife-mcp && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIFE-01 | Old tools absent from server (tool-not-found on call) | manual smoke | Deploy + MCP call attempt | ✅ (verify at deploy) |
| VPRC-07 | Returns `event_name` and `busy_night: true` when event on date | unit | `npm test -- --test-name-pattern "event_name"` | ❌ Wave 0 |
| VPRC-07 | Returns `event_name: null` and `busy_night: false` when no event | unit | `npm test -- --test-name-pattern "busy_night"` | ❌ Wave 0 |
| VPRC-08 | `pricing_approximate: false` when day-defaults exist | unit | `npm test -- --test-name-pattern "pricing_approximate"` | ❌ Wave 0 |
| VPRC-08 | `pricing_approximate: true` when only vip_default_min_spend | unit | `npm test -- --test-name-pattern "pricing_approximate"` | ❌ Wave 0 |
| (fix) | `venue_open: false` test passes (fix test assertions) | unit | `npm test -- --test-name-pattern "closed venue"` | ✅ (exists, failing) |

### Sampling Rate
- **Per task commit:** `npm test -- --test-name-pattern "vipPricing"`
- **Per wave merge:** `npm test` (full suite, all tests green)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/vipPricing.test.ts` — add VPRC-07 tests (event_name, busy_night); add VPRC-08 tests (pricing_approximate); fix existing failing test (line 209)
- [ ] `src/tools/vipTables.test.ts` — update `vipPricingOutputSchema` validation tests to include new fields
- [ ] No new framework or config needed

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/services/vipPricing.ts` (current service implementation, `resolvePricingClosedDates`, aggregation logic)
- Direct codebase inspection — `src/services/vipPricing.test.ts` (existing test coverage, failing test at line 209)
- Direct codebase inspection — `src/tools/vipTables.ts` (already-removed old tools, current schema)
- Direct codebase inspection — `src/server.ts` (already-removed `registerVipTableTools`)
- Direct codebase inspection — `src/types.ts` (`VipPricingResult` interface, existing `pricing_approximate` usage in old types)
- Direct codebase inspection — `src/services/vipTables.ts` (4-level pricing fallback, `pricing_approximate` per-table logic at Level 3)
- Direct codebase inspection — `src/services/events.ts` (`eventName()` helper pattern, `name_en`/`name_i18n` field names)
- Direct codebase inspection — `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`

### Secondary (MEDIUM confidence)
- `CLAUDE.md` VIP Table Availability Logic section — confirms 4-level pricing fallback semantics
- `CLAUDE.md` Seeded VIP Pricing Data section — confirms all three venues use day-defaults (so `pricing_approximate` will be `false` for them in production)

---

## Metadata

**Confidence breakdown:**
- LIFE-01 (tool removal): HIGH — verified directly in uncommitted source files; already done
- VPRC-07 (event context): HIGH — `event_occurrences` table/columns verified from existing queries in services; pattern is a straightforward extension
- VPRC-08 (pricing_approximate): HIGH — existing `pricing_approximate` usage in old service (`vipTables.ts`) verified; logic for new service is simpler
- Test fix: HIGH — root cause of failing test identified (test expectation vs. service behavior mismatch)

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable codebase; no external dependency changes)
