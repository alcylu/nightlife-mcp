import test from "node:test";
import assert from "node:assert/strict";
import { NightlifeError } from "../errors.js";
import {
  __testOnly_matchPerformerQuery,
  __testOnly_sortPerformerSummaries,
  getPerformerInfo,
} from "./performers.js";

test("getPerformerInfo validates UUID input", async () => {
  await assert.rejects(
    async () =>
      getPerformerInfo(
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
          stripeSecretKey: null,
          stripeWebhookSecret: null,
          resendApiKey: null,
        },
        "bad-id",
      ),
    (error) =>
      error instanceof NightlifeError && error.code === "INVALID_PERFORMER_ID",
  );
});

test("performer sorting supports recent_activity mode", () => {
  const sorted = __testOnly_sortPerformerSummaries(
    [
      {
        performer_id: "p1",
        name: "Alpha",
        slug: "alpha",
        follower_count: 100,
        ranking_score: 90,
        genres: ["house"],
        image_url: null,
        has_upcoming_event: true,
        next_event_date: "2026-03-10T22:00:00Z",
        nlt_url: "https://example.com/alpha",
      },
      {
        performer_id: "p2",
        name: "Bravo",
        slug: "bravo",
        follower_count: 20,
        ranking_score: 70,
        genres: ["techno"],
        image_url: null,
        has_upcoming_event: true,
        next_event_date: "2026-03-01T22:00:00Z",
        nlt_url: "https://example.com/bravo",
      },
      {
        performer_id: "p3",
        name: "Charlie",
        slug: "charlie",
        follower_count: 500,
        ranking_score: 98,
        genres: ["electro"],
        image_url: null,
        has_upcoming_event: false,
        next_event_date: null,
        nlt_url: "https://example.com/charlie",
      },
    ],
    "recent_activity",
  );

  assert.deepEqual(sorted.map((item) => item.performer_id), ["p2", "p1", "p3"]);
});

// -----------------------------------------------------------------------
// matchPerformerQuery — regression tests (must pass GREEN before Task 2)
// -----------------------------------------------------------------------

test("matchPerformerQuery: empty needle always returns true", () => {
  assert.equal(__testOnly_matchPerformerQuery("Alpha", ["House"], ""), true);
});

test("matchPerformerQuery: no match returns false", () => {
  assert.equal(__testOnly_matchPerformerQuery("Alpha", ["House"], "beta"), false);
});

test("matchPerformerQuery: exact same-case name match returns true", () => {
  assert.equal(__testOnly_matchPerformerQuery("Regular DJ", ["House"], "regular"), true);
});

test("matchPerformerQuery: genre match returns true", () => {
  assert.equal(__testOnly_matchPerformerQuery("Regular DJ", ["Techno"], "techno"), true);
});

// -----------------------------------------------------------------------
// Cross-accent normalization tests (must FAIL RED until Task 2 wires in
// normalizeQuery + stripAccents on both needle and haystack)
// -----------------------------------------------------------------------

test("matchPerformerQuery: accent-variant needle matches performer with macron", () => {
  // "Shinjūku DJ" has ū; needle "shinjuku" (normalizeQuery output, no macron)
  assert.equal(
    __testOnly_matchPerformerQuery("Shinjūku DJ", [], "shinjuku"),
    true,
    "accent-stripped needle should match macron in performer name",
  );
});

test("matchPerformerQuery: accent-variant needle matches performer with accented chars", () => {
  // "Céline" with accent; normalizeQuery("celine") -> "celine"
  assert.equal(
    __testOnly_matchPerformerQuery("Céline Dion", [], "celine"),
    true,
    "accent-stripped needle should match accented performer name",
  );
});
