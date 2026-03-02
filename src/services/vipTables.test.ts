import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError } from "../errors.js";
import {
  getVipTableAvailability,
  getVipTableChart,
  uploadVipTableChartImage,
  upsertVipTableAvailability,
  upsertVipVenueTables,
} from "./vipTables.js";

test("getVipTableAvailability returns per-day available tables", async () => {
  const supabase = {
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  name: "Zouk",
                  vip_booking_enabled: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_venue_tables") {
        return {
          select: () => ({
            eq: (_field: string, _value: unknown) => ({
              eq: (_isActiveField: string, _isActiveValue: unknown) => ({
                order: () => ({
                  order: async () => ({
                    data: [
                      {
                        id: "table-1",
                        table_code: "A1",
                        table_name: "A1",
                        metadata: {
                          table_note: "Near DJ booth",
                          layout_image_url: "https://cdn.nightlife.dev/charts/zouk-layout.jpg",
                        },
                        zone: "Front",
                        capacity_min: 2,
                        capacity_max: 6,
                        is_active: true,
                        default_status: "unknown",
                        chart_shape: "rectangle",
                        chart_x: 10,
                        chart_y: 12,
                        chart_width: 8,
                        chart_height: 6,
                        chart_rotation: 0,
                        sort_order: 1,
                      },
                      {
                        id: "table-2",
                        table_code: "B2",
                        table_name: "B2",
                        metadata: {
                          table_note: "Behind DJ booth",
                        },
                        zone: "Back",
                        capacity_min: 2,
                        capacity_max: 6,
                        is_active: true,
                        default_status: "unknown",
                        chart_shape: "booth",
                        chart_x: 24,
                        chart_y: 18,
                        chart_width: 9,
                        chart_height: 7,
                        chart_rotation: 0,
                        sort_order: 2,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "vip_table_availability") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                gte: () => ({
                  lte: async () => ({
                    data: [
                      {
                        vip_venue_table_id: "table-1",
                        booking_date: "2026-03-01",
                        status: "available",
                        min_spend: 1000,
                        currency: "JPY",
                        note: "Ready",
                      },
                      {
                        vip_venue_table_id: "table-2",
                        booking_date: "2026-03-01",
                        status: "blocked",
                        min_spend: null,
                        currency: null,
                        note: null,
                      },
                      {
                        vip_venue_table_id: "table-1",
                        booking_date: "2026-03-02",
                        status: "held",
                        min_spend: null,
                        currency: null,
                        note: null,
                      },
                      {
                        vip_venue_table_id: "table-2",
                        booking_date: "2026-03-02",
                        status: "available",
                        min_spend: 1200,
                        currency: "JPY",
                        note: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "vip_table_day_defaults") {
        return {
          select: () => ({
            eq: async () => ({
              data: [],
              error: null,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as any;

  const result = await getVipTableAvailability(supabase, {
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    booking_date_from: "2026-03-01",
    booking_date_to: "2026-03-02",
  });

  assert.equal(result.days.length, 2);
  assert.equal(result.days[0].available_count, 1);
  assert.equal(result.days[0].total_count, 2);
  assert.equal(result.days[0].tables.length, 1);
  assert.equal(result.days[0].tables[0].table_code, "A1");
  assert.equal(result.days[1].tables.length, 1);
  assert.equal(result.days[1].tables[0].table_code, "B2");
  assert.equal(result.days[1].tables[0].note, "Behind DJ booth");
});

test("getVipTableChart returns chart and status fallback", async () => {
  const supabase = {
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  name: "Zouk",
                  vip_booking_enabled: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_venue_tables") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  order: async () => ({
                    data: [
                      {
                        id: "table-1",
                        table_code: "A1",
                        table_name: "A1",
                        metadata: {
                          table_note: "Near DJ booth",
                          layout_image_url: "https://cdn.nightlife.dev/charts/zouk-layout.jpg",
                        },
                        zone: "Front",
                        capacity_min: 2,
                        capacity_max: 6,
                        is_active: true,
                        default_status: "unknown",
                        chart_shape: "rectangle",
                        chart_x: 10,
                        chart_y: 12,
                        chart_width: 8,
                        chart_height: 6,
                        chart_rotation: 0,
                        sort_order: 1,
                      },
                      {
                        id: "table-2",
                        table_code: "B2",
                        table_name: "B2",
                        metadata: {
                          table_note: "Blocked view of stage",
                        },
                        zone: "Back",
                        capacity_min: 4,
                        capacity_max: 8,
                        is_active: true,
                        default_status: "available",
                        chart_shape: "booth",
                        chart_x: 24,
                        chart_y: 18,
                        chart_width: 9,
                        chart_height: 7,
                        chart_rotation: 5,
                        sort_order: 2,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "vip_table_availability") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    {
                      vip_venue_table_id: "table-1",
                      booking_date: "2026-03-01",
                      status: "booked",
                      min_spend: 2000,
                      currency: "JPY",
                      note: "Confirmed hold",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === "vip_table_day_defaults") {
        return {
          select: () => ({
            eq: async () => ({
              data: [],
              error: null,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as any;

  const result = await getVipTableChart(supabase, {
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    booking_date: "2026-03-01",
  });

  assert.equal(result.tables.length, 2);
  assert.equal(result.layout_image_url, "https://cdn.nightlife.dev/charts/zouk-layout.jpg");
  assert.equal(result.tables[0].status, "booked");
  assert.equal(result.tables[0].note, "Confirmed hold");
  assert.equal(result.tables[1].status, "available");
  assert.equal(result.tables[1].chart_shape, "booth");
  assert.equal(result.tables[1].note, "Blocked view of stage");
});

test("upsertVipVenueTables normalizes codes and writes upsert payload", async () => {
  let capturedRows: Array<Record<string, unknown>> = [];

  const supabase = {
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  name: "Zouk",
                  vip_booking_enabled: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_venue_tables") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [
                  {
                    table_code: "A1",
                    metadata: {
                      table_note: "Existing note",
                      preserved_key: "keep",
                    },
                  },
                ],
                error: null,
              }),
            }),
          }),
          upsert: (rows: Array<Record<string, unknown>>) => {
            capturedRows = rows;
            return {
              select: async () => ({
                data: [
                  { id: "table-1", table_code: "A1" },
                  { id: "table-2", table_code: "B_02" },
                ],
                error: null,
              }),
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as any;

  const result = await upsertVipVenueTables(supabase, {
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    layout_image_url: "https://cdn.nightlife.dev/charts/zouk-layout.jpg",
    tables: [
      { table_code: "a1", table_name: "A1", capacity_min: 2, capacity_max: 6 },
      {
        table_code: "b_02",
        capacity_min: 4,
        capacity_max: 8,
        default_status: "held",
        note: "Behind DJ booth",
      },
    ],
  });

  assert.equal(result.updated_count, 2);
  assert.equal(capturedRows[0].table_code, "A1");
  assert.equal(capturedRows[1].table_code, "B_02");
  assert.equal(capturedRows[1].default_status, "held");
  assert.deepEqual(capturedRows[0].metadata, {
    layout_image_url: "https://cdn.nightlife.dev/charts/zouk-layout.jpg",
    table_note: "Existing note",
    preserved_key: "keep",
  });
  assert.deepEqual(capturedRows[1].metadata, {
    layout_image_url: "https://cdn.nightlife.dev/charts/zouk-layout.jpg",
    table_note: "Behind DJ booth",
  });
});

test("upsertVipTableAvailability rejects unknown table codes", async () => {
  const supabase = {
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  name: "Zouk",
                  vip_booking_enabled: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_venue_tables") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [{ id: "table-1", table_code: "A1" }],
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_table_availability") {
        return {
          upsert: async () => ({
            data: null,
            error: null,
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as any;

  await assert.rejects(
    async () =>
      upsertVipTableAvailability(supabase, {
        venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
        booking_date: "2026-03-01",
        tables: [
          { table_code: "A1", status: "available" },
          { table_code: "Z9", status: "available" },
        ],
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "INVALID_REQUEST" &&
      error.message.includes("Unknown table_code"),
  );
});

test("uploadVipTableChartImage uploads image and persists layout URL on venue tables", async () => {
  const updates = new Map<string, Record<string, unknown>>();
  const uploaded: { path: string; contentType: string; bytes: number }[] = [];

  const supabase = {
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, "vip-table-charts");
        return {
          upload: async (path: string, payload: Buffer, options: { contentType: string }) => {
            uploaded.push({
              path,
              contentType: options.contentType,
              bytes: payload.length,
            });
            return { data: { path }, error: null };
          },
          getPublicUrl: (path: string) => ({
            data: {
              publicUrl:
                `https://nqwyhdfwcaedtycojslb.supabase.co/storage/v1/object/public/vip-table-charts/${path}`,
            },
          }),
        };
      },
    },
    from: (table: string) => {
      if (table === "venues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  name: "1Oak",
                  vip_booking_enabled: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "vip_venue_tables") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                { id: "table-1", metadata: { table_note: "Stage table" } },
                { id: "table-2", metadata: { table_note: "Floor table", keep: "yes" } },
              ],
              error: null,
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: async (_field: string, tableId: string) => {
              updates.set(tableId, payload);
              return { data: null, error: null };
            },
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as any;

  const result = await uploadVipTableChartImage(supabase, {
    venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    image_base64: Buffer.from("fake-image-bytes").toString("base64"),
    mime_type: "image/png",
    filename: "1oak-main-layout.png",
  });

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].contentType, "image/png");
  assert.equal(result.storage_bucket, "vip-table-charts");
  assert.equal(result.venue_name, "1Oak");
  assert.match(result.storage_path, /^d290f1ee-6c54-4b01-90e6-d701748f0851\/\d{14}-1oak-main-layout\.png$/);
  assert.match(result.layout_image_url, /\/vip-table-charts\/d290f1ee-6c54-4b01-90e6-d701748f0851\//);
  assert.equal(result.size_bytes, Buffer.from("fake-image-bytes").length);

  const metadataOne = updates.get("table-1")?.metadata as Record<string, unknown>;
  const metadataTwo = updates.get("table-2")?.metadata as Record<string, unknown>;
  assert.equal(typeof metadataOne.layout_image_url, "string");
  assert.equal(metadataOne.table_note, "Stage table");
  assert.equal(metadataTwo.keep, "yes");
  assert.equal(metadataTwo.table_note, "Floor table");
});

test("uploadVipTableChartImage rejects unsupported mime type", async () => {
  const supabase = {} as any;
  await assert.rejects(
    async () =>
      uploadVipTableChartImage(supabase, {
        venue_id: "d290f1ee-6c54-4b01-90e6-d701748f0851",
        image_base64: Buffer.from("fake-image-bytes").toString("base64"),
        mime_type: "application/pdf",
      }),
    (error) =>
      error instanceof NightlifeError &&
      error.code === "INVALID_REQUEST" &&
      error.message.includes("mime_type must be one of"),
  );
});
