import test from "node:test";
import assert from "node:assert/strict";
import { toEventHeat, compareByHeat } from "./eventHeat.js";

// Shape mirrors real rows from event_occurrences (verified against prod 2026-08-27):
// heat_components = { gl, ig, ra, tickets, raw_values, weight_sum, featured_boost,
//                     formula_version, available_signals }

test("toEventHeat returns null when the event has never been scored", () => {
  assert.equal(toEventHeat({ heat_score: null, heat_components: null, heat_score_updated_at: null }), null);
});

test("toEventHeat maps a full four-signal row", () => {
  const heat = toEventHeat({
    heat_score: 100,
    heat_score_updated_at: "2026-08-26T07:13:24.583249+00:00",
    heat_components: {
      gl: 1.0, ig: 0.6012, ra: 0.9445, tickets: 1.0,
      raw_values: { gl: 103, ig: 103, ra: 323, tickets: 19 },
      weight_sum: 8.3, featured_boost: 20,
      formula_version: "v1-percentile",
      available_signals: ["gl", "ig", "ra", "tickets"],
    },
  });
  assert.ok(heat);
  assert.equal(heat.score, 100);
  assert.equal(heat.level, "hot");
  assert.equal(heat.confidence, "high");
  assert.equal(heat.updated_at, "2026-08-26T07:13:24.583249+00:00");
  assert.deepEqual(heat.signals, { gl: 1.0, ig: 0.6012, ra: 0.9445, tickets: 1.0 });
  assert.deepEqual(heat.raw, { gl: 103, ig: 103, ra: 323, tickets: 19 });
});

test("top_signal picks the highest percentile, breaking ties by signal priority", () => {
  // tickets and gl both 1.0 -> tickets wins (a paid ticket outranks a free signup)
  const heat = toEventHeat({
    heat_score: 100, heat_score_updated_at: null,
    heat_components: {
      gl: 1.0, tickets: 1.0, ra: 0.5,
      raw_values: { gl: 103, tickets: 19, ra: 10 },
      available_signals: ["gl", "tickets", "ra"],
    },
  });
  assert.equal(heat?.top_signal, "tickets");
});

test("a single-signal score is reported as low confidence", () => {
  // Real row: RA-only. Ember must hedge rather than claim it's selling out.
  const heat = toEventHeat({
    heat_score: 100, heat_score_updated_at: null,
    heat_components: {
      ra: 0.9952,
      raw_values: { gl: 0, ig: 0, ra: 1310, tickets: 0 },
      weight_sum: 2.0, featured_boost: 0,
      available_signals: ["ra"],
    },
  });
  assert.equal(heat?.confidence, "low");
  assert.equal(heat?.top_signal, "ra");
  // Signals with no data must not be invented as zeros.
  assert.deepEqual(heat?.signals, { ra: 0.9952 });
});

test("level bands follow the documented thresholds", () => {
  const at = (score: number) =>
    toEventHeat({ heat_score: score, heat_score_updated_at: null, heat_components: null })?.level;
  assert.equal(at(80), "hot");
  assert.equal(at(79), "warm");
  assert.equal(at(50), "warm");
  assert.equal(at(49), "quiet");
  assert.equal(at(0), "quiet");
});

test("toEventHeat survives a scored row with no components yet", () => {
  const heat = toEventHeat({ heat_score: 61, heat_score_updated_at: null, heat_components: null });
  assert.equal(heat?.score, 61);
  assert.equal(heat?.top_signal, null);
  assert.equal(heat?.confidence, "low");
  assert.deepEqual(heat?.signals, {});
});

test("compareByHeat sorts hottest first and sinks unscored events to the bottom", () => {
  const ev = (id: string, score: number | null) => ({
    event_id: id,
    heat: score === null ? null : { score, level: "hot" as const, confidence: "low" as const, top_signal: null, signals: {}, raw: {}, updated_at: null },
  });
  const sorted = [ev("a", null), ev("b", 40), ev("c", 95)].sort(compareByHeat).map((e) => e.event_id);
  // Unscored is "unknown", never "cold" -- but it cannot outrank a known score.
  assert.deepEqual(sorted, ["c", "b", "a"]);
});
