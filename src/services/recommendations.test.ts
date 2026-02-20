import test from "node:test";
import assert from "node:assert/strict";
import { MODAL_ANCHORS } from "../constants/modals.js";
import {
  __testOnly_selectRecommendationCandidates,
  type RecommendationCandidate,
} from "./recommendations.js";

function makeCandidate(input: {
  id: string;
  area: string;
  genre: string;
  quality: number;
  preference?: number;
  vector: {
    energy: number;
    social: number;
    discovery: number;
    budget: number;
    timeBucket: "early" | "prime" | "late";
  };
}): RecommendationCandidate {
  return {
    event: {
      event_id: input.id,
      name: input.id,
      date: "2026-02-20T22:00:00.000Z",
      service_date: "2026-02-20",
      venue: {
        id: `venue-${input.id}`,
        name: "Venue",
        area: input.area,
      },
      performers: ["A", "B"],
      genres: [input.genre],
      price: "JPY 3000",
      flyer_url: "https://example.com/flyer.jpg",
      nlt_url: "https://example.com/event",
    },
    vector: input.vector,
    qualityScore: input.quality,
    preferenceScore: input.preference || 0,
    primaryGenre: input.genre,
    area: input.area,
  };
}

test("slot selection keeps modal order and unique event IDs", () => {
  const candidates: RecommendationCandidate[] = MODAL_ANCHORS.slice(0, 3).map((modal, index) =>
    makeCandidate({
      id: `exact-${index}`,
      area: `area-${index}`,
      genre: `genre-${index}`,
      quality: 0.7,
      vector: {
        energy: modal.target.energy,
        social: modal.target.social,
        discovery: modal.target.discovery,
        budget: modal.target.budget,
        timeBucket: modal.target.timeBucket,
      },
    }),
  );

  const selected = __testOnly_selectRecommendationCandidates(candidates, 3);
  assert.equal(selected.length, 3);
  assert.deepEqual(
    selected.map((item) => item.modal.id),
    MODAL_ANCHORS.slice(0, 3).map((item) => item.id),
  );
  assert.equal(new Set(selected.map((item) => item.candidate.event.event_id)).size, 3);
});

test("missing modal inventory backfills from strongest remaining candidate", () => {
  const first = MODAL_ANCHORS[0];
  const candidates: RecommendationCandidate[] = [
    makeCandidate({
      id: "fit-first",
      area: "shibuya",
      genre: "techno",
      quality: 0.5,
      vector: {
        energy: first.target.energy,
        social: first.target.social,
        discovery: first.target.discovery,
        budget: first.target.budget,
        timeBucket: first.target.timeBucket,
      },
    }),
    makeCandidate({
      id: "fallback-strong",
      area: "shinjuku",
      genre: "house",
      quality: 0.95,
      vector: {
        energy: 1,
        social: 1,
        discovery: 1,
        budget: 1,
        timeBucket: "early",
      },
    }),
  ];

  const selected = __testOnly_selectRecommendationCandidates(candidates, 2);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].candidate.event.event_id, "fit-first");
  assert.equal(selected[1].candidate.event.event_id, "fallback-strong");
  assert.equal(selected[1].backfill, true);
  assert.equal(selected[1].hop, null);
});
