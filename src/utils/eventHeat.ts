/**
 * Event heat index.
 *
 * `event_occurrences.heat_score` (0-100) is recomputed nightly by
 * nlt-scraper/scripts/heat_score.py as a percentile-normalized blend of four
 * demand signals. `heat_components` carries the per-signal percentiles plus the
 * raw counts behind them.
 *
 * Two properties matter to any consumer:
 *   1. Coverage is partial. Roughly a third of upcoming events are scored.
 *      An unscored event is UNKNOWN, never cold -- never present it as "quiet".
 *   2. Scores are not equally trustworthy. A score built from one signal (an RA
 *      like count alone) is far weaker than one built from tickets + guest list
 *      + RA + Instagram, yet both can read 100. `confidence` exposes that so
 *      clients can hedge instead of overclaiming.
 */

export type HeatSignal = "tickets" | "gl" | "ra" | "ig";

/** Tie-break order when two signals share a percentile: money first, then intent. */
const SIGNAL_PRIORITY: HeatSignal[] = ["tickets", "gl", "ra", "ig"];

export type HeatLevel = "hot" | "warm" | "quiet";
export type HeatConfidence = "high" | "medium" | "low";

export interface EventHeat {
  /** 0-100, higher is hotter. */
  score: number;
  /** Banding for `score`: >=80 hot, >=50 warm, below that quiet. */
  level: HeatLevel;
  /** How many independent signals fed the score: >=3 high, 2 medium, <=1 low. */
  confidence: HeatConfidence;
  /** The signal that contributed most -- the "why is this hot" affordance. */
  top_signal: HeatSignal | null;
  /** Per-signal percentiles (0-1). Only signals with data are present. */
  signals: Partial<Record<HeatSignal, number>>;
  /** Raw counts behind the percentiles. */
  raw: Partial<Record<HeatSignal, number>>;
  /** When the nightly job last recomputed this score. */
  updated_at: string | null;
}

export type HeatSource = {
  heat_score: number | null;
  heat_components: unknown;
  heat_score_updated_at: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function levelFor(score: number): HeatLevel {
  if (score >= 80) return "hot";
  if (score >= 50) return "warm";
  return "quiet";
}

function confidenceFor(signalCount: number): HeatConfidence {
  if (signalCount >= 3) return "high";
  if (signalCount === 2) return "medium";
  return "low";
}

export function toEventHeat(row: HeatSource): EventHeat | null {
  const score = finiteNumber(row.heat_score);
  if (score === null) {
    return null;
  }

  const components = asRecord(row.heat_components);
  const rawValues = asRecord(components?.raw_values);

  const signals: Partial<Record<HeatSignal, number>> = {};
  const raw: Partial<Record<HeatSignal, number>> = {};

  for (const signal of SIGNAL_PRIORITY) {
    // Only surface signals the scorer actually had data for. Defaulting a
    // missing signal to 0 would read as "nobody bought a ticket" when the truth
    // is "we have no ticketing for this event".
    const percentile = finiteNumber(components?.[signal]);
    if (percentile !== null) {
      signals[signal] = percentile;
    }
    const rawCount = finiteNumber(rawValues?.[signal]);
    if (rawCount !== null) {
      raw[signal] = rawCount;
    }
  }

  let topSignal: HeatSignal | null = null;
  let topValue = -Infinity;
  for (const signal of SIGNAL_PRIORITY) {
    const value = signals[signal];
    // Strict > keeps SIGNAL_PRIORITY order as the tie-break.
    if (value !== undefined && value > topValue) {
      topSignal = signal;
      topValue = value;
    }
  }

  return {
    score,
    level: levelFor(score),
    confidence: confidenceFor(Object.keys(signals).length),
    top_signal: topSignal,
    signals,
    raw,
    updated_at: row.heat_score_updated_at,
  };
}

/**
 * Sort comparator: hottest first, unscored last.
 * Unscored events sink because we cannot rank what we cannot measure -- not
 * because they are cold.
 */
export function compareByHeat(
  a: { heat?: EventHeat | null },
  b: { heat?: EventHeat | null },
): number {
  const left = a.heat?.score;
  const right = b.heat?.score;
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}
