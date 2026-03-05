import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError } from "../errors.js";
import {
  __testOnly_buildVipHoursSyntheticOccurrences,
  __testOnly_rankVenueSummaries,
  getVenueInfo,
} from "./venues.js";

test("getVenueInfo validates UUID input", async () => {
  await assert.rejects(
    async () =>
      getVenueInfo(
        {} as any,
        {
          supabaseUrl: "https://example.com",
          supabaseServiceRoleKey: "x",
          serverName: "nightlife-mcp",
          serverVersion: "0.1.0",
          defaultCity: "tokyo",
          defaultCountryCode: "JP",
          nightlifeBaseUrl: "https://nightlifetokyo.com",
          topLevelCities: ["tokyo"],
          httpHost: "127.0.0.1",
          httpPort: 3000,
          mcpHttpRequireApiKey: true,
          mcpHttpUseDbKeys: true,
          mcpHttpAllowEnvKeyFallback: true,
          mcpHttpApiKeys: [],
          mcpEnableRecommendations: false,
          vipDashboardAdmins: [],
          vipDashboardSessionTtlMinutes: 720,
          vipDashboardSessionCookieName: "vip_dashboard_session",
          stripeSecretKey: null,
          stripeWebhookSecret: null,
          resendApiKey: null,
        },
        "not-a-uuid",
      ),
    (error) =>
      error instanceof NightlifeError && error.code === "INVALID_VENUE_ID",
  );
});

test("venue ranking prefers more events, then earlier next date", () => {
  const ranked = __testOnly_rankVenueSummaries([
    {
      venue_id: "v3",
      name: "C",
      area: null,
      address: null,
      website: null,
      image_url: null,
      vip_booking_supported: true,
      upcoming_event_count: 4,
      next_event_date: "2026-03-02T22:00:00Z",
      genres: [],
      nlt_url: "https://example.com/3",
    },
    {
      venue_id: "v1",
      name: "A",
      area: null,
      address: null,
      website: null,
      image_url: null,
      vip_booking_supported: false,
      upcoming_event_count: 7,
      next_event_date: "2026-03-05T22:00:00Z",
      genres: [],
      nlt_url: "https://example.com/1",
    },
    {
      venue_id: "v2",
      name: "B",
      area: null,
      address: null,
      website: null,
      image_url: null,
      vip_booking_supported: true,
      upcoming_event_count: 7,
      next_event_date: "2026-03-01T22:00:00Z",
      genres: [],
      nlt_url: "https://example.com/2",
    },
  ]);

  assert.deepEqual(ranked.map((venue) => venue.venue_id), ["v2", "v1", "v3"]);
});

test("VIP hours synthesis creates synthetic open-day events for VIP venues", () => {
  const synthetic = __testOnly_buildVipHoursSyntheticOccurrences(
    {
      id: "2bc4fd88-47d1-43fc-8ec3-b2bc4b331daf",
      name: "WARP SHINJUKU",
      name_en: "WARP SHINJUKU",
      name_ja: null,
      address: null,
      address_en: null,
      address_ja: null,
      city: "Shinjuku",
      city_en: "Shinjuku",
      city_ja: null,
      website: null,
      image_url: null,
      sns_instagram: null,
      sns_tiktok: null,
      sns_x: null,
      sns_youtube: null,
      guest_list_enabled: true,
      vip_booking_enabled: true,
      city_id: "11111111-1111-4111-8111-111111111111",
      hours_timezone: "UTC+09:00",
      hours_weekly_json: [
        {
          open_day: 5,
          close_day: 6,
          open_time: "21:00",
          close_time: "04:30",
        },
      ],
    } as any,
    "2026-03-06",
    "2026-03-08",
    "Asia/Tokyo",
  );

  assert.equal(synthetic.length, 1);
  assert.ok(synthetic[0]?.id.startsWith("__vip_hours__:"));
  assert.equal(synthetic[0]?.occurrence_days?.[0]?.service_date, "2026-03-06");
  assert.equal(synthetic[0]?.name_en, "VIP Booking Available");
  assert.equal(synthetic[0]?.description_en, "Venue open with VIP booking availability.");
});

test("VIP hours synthesis handles overnight windows even when close_day equals open_day", () => {
  const synthetic = __testOnly_buildVipHoursSyntheticOccurrences(
    {
      id: "560a67c5-960e-44fe-a509-220490776158",
      name: "1 Oak",
      name_en: "1 Oak",
      name_ja: null,
      address: null,
      address_en: null,
      address_ja: null,
      city: "Roppongi",
      city_en: "Roppongi",
      city_ja: null,
      website: null,
      image_url: null,
      sns_instagram: null,
      sns_tiktok: null,
      sns_x: null,
      sns_youtube: null,
      guest_list_enabled: true,
      vip_booking_enabled: true,
      city_id: "11111111-1111-4111-8111-111111111111",
      hours_timezone: "Asia/Tokyo",
      hours_weekly_json: [
        {
          open_day: 5,
          close_day: 5,
          open_time: "23:00",
          close_time: "05:00",
        },
      ],
    } as any,
    "2026-03-06",
    "2026-03-08",
    "Asia/Tokyo",
  );

  assert.equal(synthetic.length, 1);
  const start = new Date(String(synthetic[0]?.start_at || "")).getTime();
  const end = new Date(String(synthetic[0]?.occurrence_days?.[0]?.end_at || "")).getTime();
  assert.ok(Number.isFinite(start) && Number.isFinite(end));
  assert.ok(end > start);
});

test("VIP hours synthesis skips non-VIP venues", () => {
  const synthetic = __testOnly_buildVipHoursSyntheticOccurrences(
    {
      id: "00ffb61c-d834-4619-9580-5a3913e43e3a",
      name: "Zouk",
      name_en: "Zouk",
      name_ja: null,
      address: null,
      address_en: null,
      address_ja: null,
      city: "Shibuya",
      city_en: "Shibuya",
      city_ja: null,
      website: null,
      image_url: null,
      sns_instagram: null,
      sns_tiktok: null,
      sns_x: null,
      sns_youtube: null,
      guest_list_enabled: true,
      vip_booking_enabled: false,
      city_id: "11111111-1111-4111-8111-111111111111",
      hours_timezone: "UTC+09:00",
      hours_weekly_json: [
        {
          open_day: 2,
          close_day: 3,
          open_time: "21:00",
          close_time: "04:00",
        },
      ],
    } as any,
    "2026-03-03",
    "2026-03-04",
    "Asia/Tokyo",
  );

  assert.equal(synthetic.length, 0);
});
