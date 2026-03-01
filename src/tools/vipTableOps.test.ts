import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError, toolErrorResponse } from "../errors.js";
import {
  uploadVipTableChartImageOutputSchema,
  upsertVipTableAvailabilityOutputSchema,
  upsertVipVenueTablesOutputSchema,
} from "./vipTableOps.js";

test("upsertVipVenueTablesOutputSchema accepts mutation response", () => {
  const parsed = upsertVipVenueTablesOutputSchema.parse({
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    venue_name: "Zouk",
    updated_count: 2,
    tables: [
      { table_id: "table-1", table_code: "A1" },
      { table_id: "table-2", table_code: "B2" },
    ],
  });

  assert.equal(parsed.updated_count, 2);
  assert.equal(parsed.tables[0].table_code, "A1");
});

test("upsertVipTableAvailabilityOutputSchema accepts mutation response", () => {
  const parsed = upsertVipTableAvailabilityOutputSchema.parse({
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    venue_name: "Zouk",
    booking_date: "2026-03-01",
    updated_count: 4,
  });

  assert.equal(parsed.booking_date, "2026-03-01");
  assert.equal(parsed.updated_count, 4);
});

test("uploadVipTableChartImageOutputSchema accepts upload response", () => {
  const parsed = uploadVipTableChartImageOutputSchema.parse({
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    venue_name: "1Oak",
    storage_bucket: "vip-table-charts",
    storage_path: "d290f1ee-6c54-4b01-90e6-d701748f0851/20260301112500-layout.jpg",
    layout_image_url:
      "https://nqwyhdfwcaedtycojslb.supabase.co/storage/v1/object/public/vip-table-charts/d290f1ee-6c54-4b01-90e6-d701748f0851/20260301112500-layout.jpg",
    mime_type: "image/jpeg",
    size_bytes: 182331,
    uploaded_at: "2026-03-01T02:25:00.000Z",
  });

  assert.equal(parsed.storage_bucket, "vip-table-charts");
  assert.equal(parsed.mime_type, "image/jpeg");
});

test("toolErrorResponse supports ops table inventory errors", () => {
  const payload = toolErrorResponse(
    new NightlifeError("DB_QUERY_FAILED", "Failed to upsert VIP table availability."),
  );

  assert.deepEqual(payload, {
    error: {
      code: "DB_QUERY_FAILED",
      message: "Failed to upsert VIP table availability.",
    },
  });
});
