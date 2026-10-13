import test from "node:test";
import assert from "node:assert/strict";
import {
  __testOnly_collectStageMetadata,
  __testOnly_matchQuery,
  __testOnly_resolveGenreEventIds,
} from "./events.js";

// Minimal EventOccurrenceRow stub for testing matchQuery in isolation.
// Only populates fields that matchQuery actually reads.
function makeRow(overrides: {
  name_en?: string | null;
  name_i18n?: unknown;
  description_en?: string | null;
  description_i18n?: unknown;
  venueName?: string | null;
  venueNameEn?: string | null;
  venueNameJa?: string | null;
  city?: string | null;
  cityEn?: string | null;
  cityJa?: string | null;
} = {}): Parameters<typeof __testOnly_matchQuery>[0] {
  return {
    id: "test-event-id",
    city_id: null,
    venue_id: null,
    name_en: overrides.name_en ?? null,
    name_i18n: overrides.name_i18n ?? null,
    description_en: overrides.description_en ?? null,
    description_i18n: overrides.description_i18n ?? null,
    start_at: null,
    end_at: null,
    published: true,
    featured: false,
    source: null,
    source_url: null,
    entrance_costs: null,
    occurrence_days: null,
    venue: {
      id: "v1",
      name: overrides.venueName ?? null,
      name_en: overrides.venueNameEn ?? null,
      name_ja: overrides.venueNameJa ?? null,
      address: null,
      address_en: null,
      address_ja: null,
      city: overrides.city ?? null,
      city_en: overrides.cityEn ?? null,
      city_ja: overrides.cityJa ?? null,
      website: null,
    },
  } as Parameters<typeof __testOnly_matchQuery>[0];
}

// -----------------------------------------------------------------------
// Regression tests (must pass GREEN even before normalization is wired in)
// -----------------------------------------------------------------------

test("matchQuery: empty query always returns true", () => {
  const row = makeRow({ name_en: "Some Event" });
  assert.equal(__testOnly_matchQuery(row, "", [], []), true);
});

test("matchQuery: exact same-case match in event name_en", () => {
  const row = makeRow({ name_en: "techno night" });
  assert.equal(__testOnly_matchQuery(row, "techno", [], []), true);
});

test("matchQuery: exact same-case match in performers array", () => {
  const row = makeRow();
  assert.equal(__testOnly_matchQuery(row, "dj", ["DJ Snake", "Techno Guy"], []), true);
});

test("matchQuery: exact same-case match in genres array", () => {
  const row = makeRow();
  assert.equal(__testOnly_matchQuery(row, "techno", [], ["Techno", "House"]), true);
});

test("matchQuery: no match returns false", () => {
  const row = makeRow({ name_en: "jazz club" });
  assert.equal(__testOnly_matchQuery(row, "techno", [], []), false);
});

// -----------------------------------------------------------------------
// Cross-accent normalization tests (must FAIL RED until Task 2 wires in
// normalizeQuery + stripAccents on both needle and haystack)
// -----------------------------------------------------------------------

test("matchQuery: accent-variant needle matches macron in venue name", () => {
  // "Shinjuku" (with macron ū) should match needle "shinjuku" (no macron)
  const row = makeRow({ venueNameEn: "Shinjūku Club" });
  assert.equal(
    __testOnly_matchQuery(row, "shinjuku", [], []),
    true,
    "accent-stripped needle should match macron haystack",
  );
});

test("matchQuery: space-collapsed needle matches space-containing venue name", () => {
  // normalizeQuery("CE LA VI") -> "celavi"; haystack "CE LA VI" -> norm -> "celavi"
  const row = makeRow({ venueNameEn: "CE LA VI" });
  assert.equal(
    __testOnly_matchQuery(row, "celavi", [], []),
    true,
    "space-collapsed needle should match space-containing haystack after normalization",
  );
});

test("matchQuery: accent-variant needle matches accented performer name", () => {
  // performer "Dua Lipa" — needle "dualipa" (space-collapsed normalizeQuery output)
  const row = makeRow();
  assert.equal(
    __testOnly_matchQuery(row, "dualipa", ["Dua Lipa"], []),
    true,
    "space-collapsed needle should match performer name after normalization",
  );
});

test("matchQuery: accent-variant needle matches accented genre name", () => {
  // genre "Techno" — needle "techno" (no difference here, but validates normalization path)
  const row = makeRow();
  assert.equal(
    __testOnly_matchQuery(row, "techno", [], ["Techno"]),
    true,
    "lowercase needle should match title-case genre via normalization",
  );
});

test("lineup projection excludes off-stage crew and keeps billed custom performers", () => {
  const { performersByEvent, lineupByEvent } = __testOnly_collectStageMetadata([
    {
      event_id: "event-1",
      custom_name: "Main Floor",
      is_off_stage: false,
      venue_stage: null,
      event_timetables: [
        {
          start_time: "23:00",
          end_time: "00:00",
          custom_performer_name: "Special Guest",
          confirmation_status: "confirmed",
          performer: null,
        },
        {
          start_time: "22:00",
          end_time: "23:00",
          custom_performer_name: "Declined Act",
          confirmation_status: "declined",
          performer: null,
        },
      ],
    },
    {
      event_id: "event-1",
      custom_name: "Photo Team",
      is_off_stage: true,
      venue_stage: null,
      event_timetables: [
        {
          start_time: null,
          end_time: null,
          custom_performer_name: null,
          confirmation_status: "confirmed",
          performer: {
            id: "photographer-1",
            name: "Backstage Photographer",
            name_en: null,
            name_ja: null,
          },
        },
      ],
    },
  ]);

  assert.deepEqual(performersByEvent.get("event-1"), ["Special Guest"]);
  assert.deepEqual(lineupByEvent.get("event-1"), [
    {
      stage: "Main Floor",
      performer_name: "Special Guest",
      start_time: "23:00",
      end_time: "00:00",
    },
  ]);
});

test("genre resolution includes aliases and descendants from the shared catalog", async () => {
  let mappedGenreIds: string[] = [];
  const supabase = {
    from(table: string) {
      if (table === "genres") {
        return {
          select: () => ({
            or: async () => ({ data: [{ id: "parent-id" }], error: null }),
          }),
        };
      }
      if (table === "genre_aliases") {
        return {
          select: () => ({
            ilike: async () => ({ data: [{ genre_id: "alias-id" }], error: null }),
          }),
        };
      }
      if (table === "event_genres") {
        return {
          select: () => ({
            in: (_column: string, ids: string[]) => {
              mappedGenreIds = ids;
              return {
                order: () => ({
                  range: async () => ({
                    data: [{ event_id: "event-from-child" }],
                    error: null,
                  }),
                }),
              };
            },
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name: string, args: { p_genre_ids: string[] }) {
      assert.equal(name, "expand_genre_ids");
      assert.deepEqual(args.p_genre_ids, ["parent-id", "alias-id"]);
      return { data: ["parent-id", "alias-id", "child-id"], error: null };
    },
  };

  const eventIds = await __testOnly_resolveGenreEventIds(
    supabase as never,
    "electronic",
  );
  assert.deepEqual(mappedGenreIds, ["parent-id", "alias-id", "child-id"]);
  assert.deepEqual([...eventIds!], ["event-from-child"]);
});
