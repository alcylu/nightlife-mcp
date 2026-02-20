import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveBudgetScore,
  deriveDiscoveryScore,
  deriveEnergyScore,
  deriveQualityScore,
  deriveSocialScore,
  diversityScore,
  modalDistance,
  modalFit,
} from "./recommendationFeatures.js";

test("feature derivation is stable for a high-energy party profile", () => {
  const genres = ["Techno", "EDM"];
  const name = "Warehouse Techno Party";

  assert.equal(deriveEnergyScore(genres, name, 9), 5);
  assert.equal(deriveSocialScore(genres, name, 9), 5);
  assert.equal(deriveDiscoveryScore(genres, name, false), 3);
  assert.equal(deriveBudgetScore("Door: JPY 5000"), 4);
});

test("distance and modal fit are deterministic", () => {
  const distance = modalDistance(
    {
      energy: 5,
      social: 4,
      discovery: 4,
      budget: 3,
      timeBucket: "late",
    },
    {
      energy: 5,
      social: 3,
      discovery: 5,
      budget: 3,
      timeBucket: "late",
    },
  );

  assert.equal(distance, 2);
  assert.equal(modalFit(distance), 0.8);
});

test("diversity favors new area/genre combinations", () => {
  const selected = [
    { area: "Shibuya", primaryGenre: "Techno", timeBucket: "late" as const },
  ];

  const same = diversityScore(
    { area: "Shibuya", primaryGenre: "Techno", timeBucket: "late" },
    selected,
  );
  const different = diversityScore(
    { area: "Shinjuku", primaryGenre: "Jazz", timeBucket: "early" },
    selected,
  );

  assert.ok(different > same);
});

test("quality score rewards strong event metadata", () => {
  const low = deriveQualityScore({
    featured: false,
    performerCount: 1,
    ticketTierCount: 0,
    guestListStatus: "closed",
    hasFlyer: false,
    eventDate: "2026-02-01T12:00:00.000Z",
    now: new Date("2026-02-20T00:00:00.000Z"),
  });

  const high = deriveQualityScore({
    featured: true,
    performerCount: 12,
    ticketTierCount: 5,
    guestListStatus: "available",
    hasFlyer: true,
    eventDate: "2026-02-20T22:00:00.000Z",
    now: new Date("2026-02-20T00:00:00.000Z"),
  });

  assert.ok(high > low);
});
