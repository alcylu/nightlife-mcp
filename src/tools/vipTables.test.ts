import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError, toolErrorResponse } from "../errors.js";
import {
  vipPricingOutputSchema,
  registerVipPricingTool,
} from "./vipTables.js";

test("toolErrorResponse supports table availability errors", () => {
  const payload = toolErrorResponse(new NightlifeError("INVALID_REQUEST", "Invalid table_code."));
  assert.deepEqual(payload, {
    error: {
      code: "INVALID_REQUEST",
      message: "Invalid table_code.",
    },
  });
});

// ---------------------------------------------------------------------------
// vipPricingOutputSchema tests
// ---------------------------------------------------------------------------

test("vipPricingOutputSchema validates a well-formed VipPricingResult", () => {
  const parsed = vipPricingOutputSchema.parse({
    venue_id: "6f772e2f-d5f6-4db7-bf74-43cdc1cedb21",
    venue_name: "CÉ LA VI",
    venue_open: true,
    venue_closed_message: null,
    pricing_configured: true,
    pricing_not_configured_message: null,
    weekday_min_spend: 100000,
    weekend_min_spend: 200000,
    currency: "JPY",
    zones: [
      {
        zone: "vip zone",
        capacity_min: 4,
        capacity_max: 10,
        weekday_min_spend: 100000,
        weekend_min_spend: 200000,
        currency: "JPY",
      },
    ],
    layout_image_url: "https://cdn.nightlife.dev/charts/celavi-layout.jpg",
    booking_supported: true,
    booking_note: null,
    generated_at: "2026-03-10T14:00:00.000Z",
    service_date: "2026-03-10",
    event_pricing_note: null,
    event_name: "Friday Night Special",
    busy_night: true,
    pricing_approximate: false,
  });

  assert.equal(parsed.venue_id, "6f772e2f-d5f6-4db7-bf74-43cdc1cedb21");
  assert.equal(parsed.venue_open, true);
  assert.equal(parsed.pricing_configured, true);
  assert.equal(parsed.zones.length, 1);
  assert.equal(parsed.zones[0].zone, "vip zone");
});

test("vipPricingOutputSchema rejects object missing venue_open", () => {
  assert.throws(() => {
    vipPricingOutputSchema.parse({
      venue_id: "6f772e2f-d5f6-4db7-bf74-43cdc1cedb21",
      venue_name: "CÉ LA VI",
      // venue_open intentionally missing
      venue_closed_message: null,
      pricing_configured: true,
      pricing_not_configured_message: null,
      weekday_min_spend: 100000,
      weekend_min_spend: 200000,
      currency: "JPY",
      zones: [],
      layout_image_url: null,
      booking_supported: true,
      booking_note: null,
      generated_at: "2026-03-10T14:00:00.000Z",
      service_date: "2026-03-10",
      event_pricing_note: null,
      event_name: null,
      busy_night: false,
      pricing_approximate: false,
    });
  }, "expected parse to throw for missing venue_open");
});

test("vipPricingOutputSchema rejects object missing venue_id", () => {
  assert.throws(() => {
    vipPricingOutputSchema.parse({
      // venue_id intentionally missing
      venue_name: "CÉ LA VI",
      venue_open: true,
      venue_closed_message: null,
      pricing_configured: true,
      pricing_not_configured_message: null,
      weekday_min_spend: 100000,
      weekend_min_spend: 200000,
      currency: "JPY",
      zones: [],
      layout_image_url: null,
      booking_supported: true,
      booking_note: null,
      generated_at: "2026-03-10T14:00:00.000Z",
      service_date: "2026-03-10",
      event_pricing_note: null,
      event_name: null,
      busy_night: false,
      pricing_approximate: false,
    });
  }, "expected parse to throw for missing venue_id");
});

test("registerVipPricingTool is a callable function (exported)", () => {
  assert.equal(typeof registerVipPricingTool, "function", "registerVipPricingTool should be exported as a function");
});
