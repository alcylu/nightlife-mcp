import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { searchEvents } from "./events.js";

type EqCall = { table: string; column: string; value: unknown };

const CITY_ROW = {
  id: "city-tokyo",
  slug: "tokyo",
  name_en: "Tokyo",
  timezone: "Asia/Tokyo",
  service_day_cutoff_time: "06:00:00",
  country_code: "JP",
};

// A chainable Supabase recorder. Every builder method returns the same chain and
// records .eq() calls per table. Terminal reads resolve to safe empty results;
// the "cities" table resolves to a single city so getCityContext succeeds.
function recordingSupabase(eqCalls: EqCall[]): SupabaseClient {
  const makeChain = (table: string) => {
    const result =
      table === "cities" ? { data: CITY_ROW, error: null } : { data: [], error: null };
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of [
      "select",
      "order",
      "range",
      "in",
      "gte",
      "lt",
      "lte",
      "or",
      "limit",
      "neq",
    ]) {
      chain[m] = passthrough;
    }
    chain.eq = (column: string, value: unknown) => {
      eqCalls.push({ table, column, value });
      return chain;
    };
    chain.maybeSingle = async () => result;
    chain.single = async () => result;
    // Make the chain awaitable (resolves like a terminal query).
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain;
  };
  return { from: (table: string) => makeChain(table) } as unknown as SupabaseClient;
}

const CONFIG = {
  defaultCity: "tokyo",
  defaultCountryCode: "JP",
  nightlifeBaseUrl: "https://nightlifetokyo.com",
  topLevelCities: ["tokyo"],
} as unknown as AppConfig;

const NEBULA_SERIES_ID = "01debaa8-55a9-4b70-b81f-2f817ca94463";

test("searchEvents applies a series_id filter when seriesId is provided", async () => {
  const eqCalls: EqCall[] = [];
  await searchEvents(recordingSupabase(eqCalls), CONFIG, {
    city: "tokyo",
    seriesId: NEBULA_SERIES_ID,
  });

  const seriesFilter = eqCalls.find(
    (c) => c.table === "event_occurrences" && c.column === "series_id",
  );
  assert.ok(seriesFilter, "expected a series_id filter on event_occurrences");
  assert.equal(seriesFilter.value, NEBULA_SERIES_ID);
});

test("searchEvents does NOT filter by series_id when seriesId is omitted", async () => {
  const eqCalls: EqCall[] = [];
  await searchEvents(recordingSupabase(eqCalls), CONFIG, { city: "tokyo" });

  const seriesFilter = eqCalls.find(
    (c) => c.table === "event_occurrences" && c.column === "series_id",
  );
  assert.equal(seriesFilter, undefined, "must not filter by series_id by default");
});
