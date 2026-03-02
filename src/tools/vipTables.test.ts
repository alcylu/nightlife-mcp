import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError, toolErrorResponse } from "../errors.js";
import {
  vipTableAvailabilityOutputSchema,
  vipTableChartOutputSchema,
} from "./vipTables.js";

test("vipTableAvailabilityOutputSchema accepts daily availability payload", () => {
  const parsed = vipTableAvailabilityOutputSchema.parse({
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    venue_name: "Zouk",
    booking_date_from: "2026-03-01",
    booking_date_to: "2026-03-03",
    party_size: 4,
    generated_at: "2026-02-28T12:00:00.000Z",
    days: [
      {
        booking_date: "2026-03-01",
        venue_open: true,
        available_count: 2,
        total_count: 4,
        tables: [
          {
            table_id: "table-1",
            table_code: "A1",
            table_name: "A1",
            zone: "Front",
            capacity_min: 2,
            capacity_max: 6,
            status: "available",
            min_spend: 1000,
            currency: "JPY",
            note: "Prime location",
            pricing_approximate: false,
          },
        ],
      },
    ],
  });

  assert.equal(parsed.days.length, 1);
  assert.equal(parsed.days[0].tables[0].status, "available");
});

test("vipTableChartOutputSchema accepts table chart payload", () => {
  const parsed = vipTableChartOutputSchema.parse({
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    venue_name: "Zouk",
    venue_open: true,
    booking_date: "2026-03-01",
    layout_image_url: "https://cdn.nightlife.dev/charts/zouk-layout.jpg",
    generated_at: "2026-02-28T12:00:00.000Z",
    tables: [
      {
        table_id: "table-1",
        table_code: "A1",
        table_name: "A1",
        zone: "Front",
        capacity_min: 2,
        capacity_max: 6,
        is_active: true,
        sort_order: 1,
        chart_shape: "rectangle",
        chart_x: 12.5,
        chart_y: 8.5,
        chart_width: 6.0,
        chart_height: 4.0,
        chart_rotation: 0,
        status: "held",
        min_spend: 1200,
        currency: "JPY",
        note: null,
        pricing_approximate: false,
      },
    ],
  });

  assert.equal(parsed.tables.length, 1);
  assert.equal(parsed.tables[0].chart_shape, "rectangle");
});

test("toolErrorResponse supports table availability errors", () => {
  const payload = toolErrorResponse(new NightlifeError("INVALID_REQUEST", "Invalid table_code."));
  assert.deepEqual(payload, {
    error: {
      code: "INVALID_REQUEST",
      message: "Invalid table_code.",
    },
  });
});
