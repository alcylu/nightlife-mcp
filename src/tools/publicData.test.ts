import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../config.js";
import { createNightlifeServer } from "../server.js";
import { createRestRouter } from "../rest.js";
import { openApiDocument } from "../openapi.js";
import { publicSearchEventsOutputSchema, publicEventDetailSchema, publicRecommendationsOutputSchema, searchEventsOutputSchema } from "./events.js";
import { publicVenueDetailSchema, proVenueDetailSchema } from "./venues.js";
import { publicPerformerDetailSchema, proPerformerDetailSchema, proSearchPerformersOutputSchema } from "./performers.js";
import { publicCreateVipBookingOutputSchema, publicVipBookingStatusOutputSchema } from "./vipBookings.js";
import { createApiKeyAuthMiddleware } from "../middleware/apiKeyAuth.js";

const id = "00000000-0000-4000-8000-000000000001";
const config = loadConfig({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture", MCP_ENABLE_RECOMMENDATIONS: "true" });
const heat = { score: 99, level: "hot", confidence: "high", top_signal: "tickets", signals: { tickets: 1 }, raw: { tickets: 500, gl: 100 }, updated_at: "2026-10-15" };
const event = {
  event_id: id, name: "Event", date: "2026-10-15", service_date: "2026-10-15", venue: { id, name: "Venue", area: "Shibuya" },
  performers: ["DJ Test"], genres: ["House"], price: "JPY 3000", flyer_url: null, heat,
  event_media: [{ media_url: "https://example.com/event.mp4", media_type: "video", is_primary: true, display_order: 0, thumbnail_url: null, title: null }],
  nlt_url: "https://nightlifetokyo.com/tokyo/events/test", future_internal_metric: "INTERNAL_ONLY",
};
const performer = {
  performer_id: id, name: "DJ Test", performer_type: "DJ", slug: "test", bio: "INTERNAL_BIO",
  image_url: "https://example.com/INTERNAL_PHOTO", follower_count: 50000, ranking_score: 99,
  genres: ["House"], social_links: [{ platform: "Instagram", username: "INTERNAL_SOCIAL", url: null }],
  upcoming_events: [{ event, stage: "Main", set_start_time: null, set_end_time: null }], nlt_url: "https://nightlifetokyo.com/tokyo/djs/test",
};
const venue = {
  venue_id: id, name: "Venue", area: "Shibuya", address: "Tokyo", website: "https://example.com", image_url: "https://example.com/venue.jpg",
  vip_booking_supported: true, guest_list_enabled: true, sns_instagram: "INTERNAL_SOCIAL", sns_tiktok: null, sns_x: null, sns_youtube: null,
  upcoming_event_count: 1, upcoming_events: [event], nlt_url: "https://nightlifetokyo.com/tokyo/venues/test",
};

function fakeDatabase(): SupabaseClient {
  return {
    from(table: string) {
      let single = false;
      const q: any = new Proxy({}, { get(_target, key) {
        if (key === "then") return (resolve: any) => {
          let data: any = [];
          if (table === "performers" && single) data = { id, name: "DJ Test", name_en: "DJ Test", type: "DJ", slug: "test", bio_en: performer.bio, follower_count: 50000, ranking_score: 99 };
          if (table === "performer_media") data = [{ performer_id: id, media_url: performer.image_url }];
          if (table === "performer_social_links") data = [{ username: "INTERNAL_SOCIAL", full_url: "https://example.com/INTERNAL_SOCIAL", platform: { name: "Instagram" } }];
          if (table === "venues" && single) data = { id, name: "Venue", city_id: null, city_en: "Shibuya", address: "Tokyo", website: venue.website, image_url: venue.image_url, sns_instagram: venue.sns_instagram, guest_list_enabled: true, vip_booking_enabled: true };
          if (table === "cities" && single) data = { id, slug: "tokyo", name_en: "Tokyo", timezone: "Asia/Tokyo", service_day_cutoff_time: "06:00", country_code: "JP" };
          resolve({ data, error: null });
        };
        return () => { if (key === "maybeSingle" || key === "single") single = true; return q; };
      }});
      return q;
    },
  } as unknown as SupabaseClient;
}

function assertNoPrivateData(value: unknown) {
  const text = JSON.stringify(value);
  for (const forbidden of ["INTERNAL_", '"heat"', '"raw"', '"bio"', '"follower_count"', '"ranking_score"', '"social_links"', '"sns_instagram"', '"min_spend"', '"deposit_amount_jpy"', '"deposit_payment_url"']) {
    assert.ok(!text.includes(forbidden), `Public response leaked ${forbidden}`);
  }
}

test("public allowlists remove restricted fields throughout nested discovery payloads", () => {
  const search = { city: "tokyo", date_filter: "tonight", events: [event], vip_venues_open: [{ venue_id: id, name: "Venue", area: "Shibuya", hours: "22:00–05:00", min_spend: 100000, currency: "JPY", nlt_url: venue.nlt_url }], unavailable_city: null };
  const result = publicSearchEventsOutputSchema.parse(search);
  assertNoPrivateData(result);
  assert.equal(result.events[0].price, "JPY 3000", "ordinary admission prices stay public");
  assert.equal(result.events[0].event_media[0].media_type, "video", "event media stays public");
  assert.deepEqual(searchEventsOutputSchema.parse(search).events[0].heat, heat, "internal contracts retain demand data");
  assertNoPrivateData(publicVenueDetailSchema.parse(venue));
  const p = publicPerformerDetailSchema.parse(performer);
  assertNoPrivateData(p);
  assert.ok(!("image_url" in p));
  assert.equal(p.upcoming_events[0].stage, "Main");
  assertNoPrivateData(publicRecommendationsOutputSchema.parse({ city: "tokyo", date_filter: null, result_count: 1, unavailable_city: null, recommendations: [{ rank: 1, modal_id: "test", modal_name: "Test", modal_description: "Test", event, why_this_fits: ["House", "Shibuya"] }] }));
  assertNoPrivateData(publicEventDetailSchema.parse({ ...event, start_time: event.date, end_time: null, venue: { ...event.venue, address: "Tokyo", map_link: null, website: null }, lineup: [], price: { entrance_summary: "JPY 3000", door: null, advance: null, tiers: [] }, guest_list_status: "available" }));
});

test("public booking actions cannot expose prices indirectly in notes or deposit links", () => {
  assertNoPrivateData(publicCreateVipBookingOutputSchema.parse({ booking_request_id: id, status: "submitted", created_at: "2026-10-15", preferred_table_code: null, min_spend: 100000, min_spend_currency: "JPY", message: "INTERNAL_PRICE", table_warning: "INTERNAL_PRICE" }));
  assertNoPrivateData(publicVipBookingStatusOutputSchema.parse({ booking_request_id: id, status: "confirmed", last_updated_at: "2026-10-15", status_message: "INTERNAL_PRICE", latest_note: "INTERNAL_PRICE", history: [{ status: "confirmed", at: "2026-10-15", note: "INTERNAL_PRICE" }], deposit_status: "paid", deposit_amount_jpy: 50000, deposit_payment_url: "https://example.com/INTERNAL_PRICE" }));
});

function assertNoOperationalData(value: unknown) {
  const text = JSON.stringify(value);
  for (const forbidden of ['"heat"', '"follower_count"', '"ranking_score"', '"min_spend"', '"deposit_amount_jpy"', '"deposit_payment_url"', '"future_internal_metric"']) assert.ok(!text.includes(forbidden), `Pro response leaked ${forbidden}`);
}

test("Pro allowlists add approved enrichment without nested operational data", () => {
  const p = proPerformerDetailSchema.parse(performer);
  assert.equal(p.bio, performer.bio);
  assert.equal(p.image_url, performer.image_url);
  assert.deepEqual(p.social_links, performer.social_links);
  assertNoOperationalData(p);
  assertNoOperationalData(proVenueDetailSchema.parse(venue));
  const search = proSearchPerformersOutputSchema.parse({ city: "tokyo", date_filter: null, unavailable_city: null, performers: [{ ...performer, has_upcoming_event: true, next_event_date: "2026-10-15" }] });
  assert.equal(search.performers[0].image_url, performer.image_url);
  assertNoOperationalData(search);
});

test("actual MCP discovery and calls enforce Free, Pro and ops contracts", async () => {
  for (const mode of ["free", "pro", "ops"]) {
    const internal = mode === "ops";
    const enriched = mode !== "free";
    const server = createNightlifeServer(config, fakeDatabase(), { includeOpsTools: internal, includeProProfiles: mode === "pro" });
    const client = new Client({ name: "policy-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const tools = (await client.listTools()).tools;
      assert.equal(tools.some(t => t.name === "get_vip_pricing"), internal);
      const performerTool = tools.find(t => t.name === "get_performer_info")!;
      assert.equal(JSON.stringify(performerTool.outputSchema).includes('"bio"'), enriched);
      assert.equal(JSON.stringify(performerTool.outputSchema).includes('"follower_count"'), internal);
      const eventTool = tools.find(t => t.name === "search_events")!;
      assert.equal(JSON.stringify(eventTool.inputSchema).includes('"heat"'), internal);
      const p = await client.callTool({ name: "get_performer_info", arguments: { performer_id: id } });
      assert.ok(!p.isError);
      if (enriched) assert.ok(JSON.stringify(p).includes("INTERNAL_BIO"));
      else assertNoPrivateData(p);
      const v = await client.callTool({ name: "get_venue_info", arguments: { venue_id: id } });
      assert.ok(!v.isError);
      if (enriched) assert.ok(JSON.stringify(v).includes("INTERNAL_SOCIAL"));
      else assertNoPrivateData(v);
      if (!internal) { assertNoOperationalData(p); assertNoOperationalData(v); }
    } finally { await client.close(); await server.close(); }
  }
});

test("REST Free/legacy keys omit enrichment, Pro adds profiles, ops retains internal data", async () => {
  const app = express();
  app.use((req, _res, next) => { (req as any).apiKeyTier = req.headers["x-test-tier"] ?? "free"; (req as any).proProfiles = req.headers["x-test-tier"] === "pro"; next(); });
  app.use(createRestRouter(config, fakeDatabase()));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const tier of ["free", "starter", "pro", "ops"]) {
      const headers = { "x-test-tier": tier };
      for (const path of [`/performers/${id}`, `/venues/${id}`]) {
        const res = await fetch(base + path, { headers });
        assert.equal(res.status, 200);
        const data = await res.json();
        if (tier === "ops" || tier === "pro") assert.ok(JSON.stringify(data).includes("INTERNAL_"));
        else assertNoPrivateData(data);
        if (tier !== "ops") assertNoOperationalData(data);
      }
      if (tier !== "ops") {
        assert.equal((await fetch(`${base}/venues/${id}/vip-pricing`, { headers })).status, 404);
        assert.equal((await fetch(`${base}/events?sort_by=heat`, { headers })).status, 400);
        assert.equal((await fetch(`${base}/performers?sort_by=popularity`, { headers })).status, 400);
      }
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test("REST auth rechecks subscription on each request and ignores client Pro claims", async () => {
  let quota: number | null = 100;
  const db = fakeDatabase();
  db.rpc = (async () => ({ error: null, data: [{ allowed: true, tier: "starter", monthly_quota: quota, monthly_count: 1 }] })) as any;
  const app = express();
  app.use(createApiKeyAuthMiddleware({ supabase: db, config: { ...config, mcpHttpRequireApiKey: true, mcpHttpUseDbKeys: true, mcpEnableMonthlyLimits: true } }));
  app.use(createRestRouter(config, db));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/performers/${id}?plan=pro`;
  try {
    for (const paidQuota of [100, 2000, 100, null]) {
      quota = paidQuota;
      const res = await fetch(url, { headers: { "x-api-key": "fixture", "x-api-key-tier": "ops", "x-pro-profiles": "true" } });
      assert.equal(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      assert.equal("bio" in body, quota === 2000);
      assertNoOperationalData(body);
    }
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

test("OpenAPI separates Free/Pro profiles and never advertises operational fields", () => {
  assert.ok(!openApiDocument.paths["/venues/{id}/vip-pricing"]);
  const spec = JSON.stringify(openApiDocument);
  for (const field of ['"heat"', '"min_spend"', '"follower_count"', '"ranking_score"']) assert.ok(!spec.includes(field), `Public OpenAPI advertises ${field}`);
  assert.ok(!("image_url" in openApiDocument.components.schemas.PerformerDetail.properties));
  assert.ok("bio" in openApiDocument.components.schemas.ProPerformerDetail.properties);
  assert.ok("sns_instagram" in openApiDocument.components.schemas.ProVenueDetail.properties);
  assert.deepEqual(openApiDocument.paths["/performers"].get.parameters.find((p: any) => p.name === "sort_by").schema.enum, ["alphabetical", "recent_activity"]);
});
