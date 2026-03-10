import test from "node:test";
import assert from "node:assert/strict";
import { getVipPricing } from "./vipPricing.js";

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

const VENUE_ID = "d290f1ee-6c54-4b01-90e6-d701748f0851";
const TABLE_ID_1 = "aaaa1111-6c54-4b01-90e6-d701748f0851";
const TABLE_ID_2 = "bbbb2222-6c54-4b01-90e6-d701748f0851";

const DEFAULT_VENUE = {
  id: VENUE_ID,
  name: "Test Club",
  city_id: "city-1",
  vip_booking_enabled: true,
  vip_default_min_spend: null,
  vip_default_currency: null,
};

const DEFAULT_CITY = {
  timezone: "Asia/Tokyo",
  service_day_cutoff_time: "06:00",
};

const DEFAULT_TABLES = [
  {
    id: TABLE_ID_1,
    table_code: "V1",
    table_name: "VIP 1",
    metadata: { layout_image_url: "https://cdn.nightlife.dev/charts/test-layout.jpg" },
    zone: "VIP Zone",
    capacity_min: 4,
    capacity_max: 8,
  },
  {
    id: TABLE_ID_2,
    table_code: "V2",
    table_name: "VIP 2",
    metadata: {},
    zone: "VIP Zone",
    capacity_min: 2,
    capacity_max: 6,
  },
];

// Weekday row (Sun=0, use day 0 for weekday)
// Weekend rows (Fri=5, Sat=6)
const DEFAULT_DAY_DEFAULTS = [
  { vip_venue_table_id: TABLE_ID_1, day_of_week: 0, min_spend: 100000, currency: "JPY", note: null },
  { vip_venue_table_id: TABLE_ID_2, day_of_week: 0, min_spend: 100000, currency: "JPY", note: null },
  { vip_venue_table_id: TABLE_ID_1, day_of_week: 5, min_spend: 200000, currency: "JPY", note: null },
  { vip_venue_table_id: TABLE_ID_2, day_of_week: 5, min_spend: 200000, currency: "JPY", note: null },
  { vip_venue_table_id: TABLE_ID_1, day_of_week: 6, min_spend: 250000, currency: "JPY", note: null },
  { vip_venue_table_id: TABLE_ID_2, day_of_week: 6, min_spend: 250000, currency: "JPY", note: null },
];

type StubOverrides = Partial<{
  venue: object | null;
  city: object | null;
  eventOccurrences: object[];
  operatingHours: object[];
  venueTables: object[];
  dayDefaults: object[];
  dateOverrides: object[];
}>;

function createStub(overrides: StubOverrides = {}) {
  const venue = "venue" in overrides ? overrides.venue : DEFAULT_VENUE;
  const city = "city" in overrides ? overrides.city : DEFAULT_CITY;
  const eventOccurrences = overrides.eventOccurrences ?? [];
  const operatingHours = overrides.operatingHours ?? [
    { day_of_week: 0, is_enabled: true },
    { day_of_week: 1, is_enabled: true },
    { day_of_week: 2, is_enabled: true },
    { day_of_week: 3, is_enabled: true },
    { day_of_week: 4, is_enabled: true },
    { day_of_week: 5, is_enabled: true },
    { day_of_week: 6, is_enabled: true },
  ];
  const venueTables = overrides.venueTables ?? DEFAULT_TABLES;
  const dayDefaults = overrides.dayDefaults ?? DEFAULT_DAY_DEFAULTS;
  const dateOverrides = overrides.dateOverrides ?? [];

  return {
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: venue,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "cities") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: city,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "event_occurrences") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lt: async () => ({
                    data: eventOccurrences,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "venue_operating_hours") {
        return {
          select: () => ({
            eq: async () => ({
              data: operatingHours,
              error: null,
            }),
          }),
        };
      }

      if (table === "vip_venue_tables") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: venueTables,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_table_day_defaults") {
        return {
          select: () => ({
            eq: async () => ({
              data: dayDefaults,
              error: null,
            }),
          }),
        };
      }

      if (table === "vip_table_availability") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: dateOverrides,
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// ---------------------------------------------------------------------------
// VPRC-01: Aggregates weekday and weekend min spend from day-defaults
// ---------------------------------------------------------------------------

test("getVipPricing aggregates weekday and weekend min spend from day-defaults", async () => {
  const supabase = createStub();
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09", // Monday (weekday)
  });

  assert.equal(result.venue_id, VENUE_ID);
  assert.equal(result.venue_name, "Test Club");
  assert.equal(result.venue_open, true);
  assert.equal(result.pricing_configured, true);
  assert.equal(result.weekday_min_spend, 100000);
  assert.equal(result.weekend_min_spend, 200000);
  assert.equal(result.currency, "JPY");
  assert.ok(result.generated_at);
});

// ---------------------------------------------------------------------------
// VPRC-02: Returns venue_open: false for closed venue
// ---------------------------------------------------------------------------

test("getVipPricing returns venue_open false for closed venue", async () => {
  // Venue has operating hours with Monday=false; no events
  const supabase = createStub({
    operatingHours: [
      { day_of_week: 0, is_enabled: false },
      { day_of_week: 1, is_enabled: false }, // Monday closed
      { day_of_week: 2, is_enabled: false },
      { day_of_week: 3, is_enabled: true },
      { day_of_week: 4, is_enabled: true },
      { day_of_week: 5, is_enabled: true },
      { day_of_week: 6, is_enabled: true },
    ],
    eventOccurrences: [], // no events
  });

  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09", // Monday (UTC day 1)
  });

  assert.equal(result.venue_open, false);
  assert.ok(result.venue_closed_message, "venue_closed_message should be non-null");
  assert.equal(result.pricing_configured, false);
  assert.deepEqual(result.zones, []);
  assert.equal(result.weekday_min_spend, null);
  assert.equal(result.weekend_min_spend, null);
});

// ---------------------------------------------------------------------------
// VPRC-03: Zone summary contains capacity range and per-zone pricing
// ---------------------------------------------------------------------------

test("getVipPricing zone summary contains capacity range and per-zone pricing", async () => {
  const supabase = createStub({
    venueTables: [
      {
        id: TABLE_ID_1,
        table_code: "S1",
        table_name: "Stage 1",
        metadata: {},
        zone: "Stage",
        capacity_min: 4,
        capacity_max: 8,
      },
      {
        id: TABLE_ID_2,
        table_code: "D1",
        table_name: "Dance 1",
        metadata: {},
        zone: "Dance Floor",
        capacity_min: 2,
        capacity_max: 6,
      },
    ],
    dayDefaults: [
      { vip_venue_table_id: TABLE_ID_1, day_of_week: 0, min_spend: 100000, currency: "JPY", note: null },
      { vip_venue_table_id: TABLE_ID_1, day_of_week: 5, min_spend: 200000, currency: "JPY", note: null },
      { vip_venue_table_id: TABLE_ID_2, day_of_week: 0, min_spend: 80000, currency: "JPY", note: null },
      { vip_venue_table_id: TABLE_ID_2, day_of_week: 5, min_spend: 150000, currency: "JPY", note: null },
    ],
  });

  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  assert.equal(result.zones.length, 2);

  const stage = result.zones.find((z) => z.zone === "Stage");
  const dance = result.zones.find((z) => z.zone === "Dance Floor");

  assert.ok(stage, "Stage zone should exist");
  assert.equal(stage!.capacity_min, 4);
  assert.equal(stage!.capacity_max, 8);
  assert.equal(stage!.weekday_min_spend, 100000);
  assert.equal(stage!.weekend_min_spend, 200000);
  assert.equal(stage!.currency, "JPY");

  assert.ok(dance, "Dance Floor zone should exist");
  assert.equal(dance!.capacity_min, 2);
  assert.equal(dance!.capacity_max, 6);
  assert.equal(dance!.weekday_min_spend, 80000);
  assert.equal(dance!.weekend_min_spend, 150000);
});

// ---------------------------------------------------------------------------
// VPRC-04: Returns layout_image_url when present
// ---------------------------------------------------------------------------

test("getVipPricing returns layout_image_url when present in table metadata", async () => {
  const supabase = createStub(); // DEFAULT_TABLES[0] has layout_image_url
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  assert.equal(
    result.layout_image_url,
    "https://cdn.nightlife.dev/charts/test-layout.jpg",
  );
});

test("getVipPricing returns null layout_image_url when absent", async () => {
  const supabase = createStub({
    venueTables: [
      {
        id: TABLE_ID_1,
        table_code: "V1",
        table_name: "VIP 1",
        metadata: {},
        zone: "VIP",
        capacity_min: 4,
        capacity_max: 8,
      },
    ],
  });
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  assert.equal(result.layout_image_url, null);
});

// ---------------------------------------------------------------------------
// VPRC-05: Returns pricing_configured: false when no day-defaults and no vip_default_min_spend
// ---------------------------------------------------------------------------

test("getVipPricing returns pricing_configured false when no day-defaults and no default_min_spend", async () => {
  const supabase = createStub({
    dayDefaults: [],
    venue: { ...DEFAULT_VENUE, vip_default_min_spend: null },
  });
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  assert.equal(result.pricing_configured, false);
  assert.ok(result.pricing_not_configured_message, "pricing_not_configured_message should be non-null");
});

test("getVipPricing returns pricing_configured true when only vip_default_min_spend exists", async () => {
  const supabase = createStub({
    dayDefaults: [],
    venue: { ...DEFAULT_VENUE, vip_default_min_spend: 100000 },
  });
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  assert.equal(result.pricing_configured, true);
  assert.equal(result.pricing_not_configured_message, null);
});

// ---------------------------------------------------------------------------
// VPRC-06: Returns booking_supported from vip_booking_enabled
// ---------------------------------------------------------------------------

test("getVipPricing returns booking_supported from vip_booking_enabled", async () => {
  const enabledStub = createStub({
    venue: { ...DEFAULT_VENUE, vip_booking_enabled: true },
  });
  const enabled = await getVipPricing(enabledStub as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });
  assert.equal(enabled.booking_supported, true);

  const disabledStub = createStub({
    venue: { ...DEFAULT_VENUE, vip_booking_enabled: false },
  });
  const disabled = await getVipPricing(disabledStub as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });
  assert.equal(disabled.booking_supported, false);

  const nullStub = createStub({
    venue: { ...DEFAULT_VENUE, vip_booking_enabled: null },
  });
  const nullResult = await getVipPricing(nullStub as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });
  assert.equal(nullResult.booking_supported, false);
});

// ---------------------------------------------------------------------------
// VPRC-09: Resolves "tonight" via service date (6am JST cutoff)
// ---------------------------------------------------------------------------

test("getVipPricing resolves tonight via service date", async () => {
  const supabase = createStub();
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "tonight",
  });

  // Result should have a service_date set
  assert.ok(result.service_date, "service_date should be set when date='tonight'");
  // Should be a valid YYYY-MM-DD string
  assert.match(result.service_date!, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------------------
// Per-date override: event_pricing_note when vip_table_availability has rows
// ---------------------------------------------------------------------------

test("getVipPricing includes event_pricing_note when per-date overrides exist", async () => {
  const supabase = createStub({
    dateOverrides: [{ min_spend: 500000 }],
  });
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  assert.ok(result.event_pricing_note, "event_pricing_note should be non-null when overrides exist");
});

test("getVipPricing has null event_pricing_note when no per-date overrides", async () => {
  const supabase = createStub({
    dateOverrides: [],
  });
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  assert.equal(result.event_pricing_note, null);
});

// ---------------------------------------------------------------------------
// Edge case: venue with zero operating-hours rows does NOT block as closed
// ---------------------------------------------------------------------------

test("getVipPricing does not block venue with zero operating-hours rows", async () => {
  const supabase = createStub({
    operatingHours: [], // 0 rows — should not block
    eventOccurrences: [], // no events either
  });
  const result = await getVipPricing(supabase as never, {
    venue_id: VENUE_ID,
    date: "2026-03-09",
  });

  // Venue with no operating hours configured should NOT be marked closed
  assert.equal(result.venue_open, true);
});

// ---------------------------------------------------------------------------
// Error case: venue not found
// ---------------------------------------------------------------------------

test("getVipPricing throws VENUE_NOT_FOUND for unknown venue_id", async () => {
  const supabase = createStub({ venue: null });

  await assert.rejects(
    () => getVipPricing(supabase as never, { venue_id: VENUE_ID }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match((err as { code?: string }).code ?? "", /VENUE_NOT_FOUND/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Error case: invalid UUID
// ---------------------------------------------------------------------------

test("getVipPricing throws INVALID_REQUEST for non-UUID venue_id", async () => {
  const supabase = createStub();

  await assert.rejects(
    () => getVipPricing(supabase as never, { venue_id: "not-a-uuid" }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match((err as { code?: string }).code ?? "", /INVALID_REQUEST/);
      return true;
    },
  );
});
