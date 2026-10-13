import assert from "node:assert/strict";
import test from "node:test";
import { eventSummarySchema as nestedEventSummarySchema } from "./schemas.js";
import { eventDetailSchema, searchEventsOutputSchema } from "./events.js";

const heat = {
  score: 88,
  level: "hot" as const,
  confidence: "medium" as const,
  top_signal: "tickets" as const,
  signals: { tickets: 0.9, ra: 0.7 },
  raw: { tickets: 12, ra: 40 },
  updated_at: "2026-10-13T00:00:00.000Z",
};

const media = {
  media_url: "https://example.com/promo.mp4",
  media_type: "video",
  is_primary: true,
  display_order: 0,
  thumbnail_url: "https://example.com/poster.jpg",
  title: "Event teaser",
};

const summary = {
  event_id: "event-id",
  name: "Event",
  date: "2026-10-13T14:00:00.000Z",
  service_date: "2026-10-13",
  venue: { id: "venue-id", name: "Venue", area: "Shibuya" },
  performers: ["DJ Test"],
  genres: ["House"],
  price: "JPY 3000",
  flyer_url: "https://example.com/flyer.jpg",
  heat,
  event_media: [media],
  nlt_url: "https://nightlifetokyo.com/tokyo/events/event-id",
};

test("event summary schemas preserve heat and image/video media", () => {
  const nested = nestedEventSummarySchema.parse(summary);
  assert.deepEqual(nested.heat, heat);
  assert.deepEqual(nested.event_media, [media]);

  const search = searchEventsOutputSchema.parse({
    city: "tokyo",
    date_filter: "tonight",
    events: [summary],
    vip_venues_open: [],
    unavailable_city: null,
  });
  assert.deepEqual(search.events[0]?.event_media, [media]);
});

test("event detail schema preserves image/video media", () => {
  const parsed = eventDetailSchema.parse({
    ...summary,
    start_time: summary.date,
    end_time: null,
    venue: {
      ...summary.venue,
      address: "Shibuya, Tokyo",
      map_link: "https://maps.google.com/",
      website: null,
    },
    lineup: [],
    price: { entrance_summary: summary.price, door: null, advance: null, tiers: [] },
    guest_list_status: "closed",
  });
  assert.deepEqual(parsed.event_media, [media]);
});
