import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQuery, stripAccents } from "./normalize.js";

// NORM-01: Accent stripping
test("normalizeQuery strips acute accent: 'é' becomes 'e'", () => {
  assert.equal(normalizeQuery("é"), "e");
});

test("normalizeQuery strips macron: 'ō' becomes 'o'", () => {
  assert.equal(normalizeQuery("ō"), "o");
});

test("normalizeQuery strips umlaut: 'ü' becomes 'u'", () => {
  assert.equal(normalizeQuery("ü"), "u");
});

// NORM-02: Space collapsing
test("normalizeQuery collapses spaces: 'CÉ LA VI' becomes 'celavi'", () => {
  assert.equal(normalizeQuery("CÉ LA VI"), "celavi");
});

test("normalizeQuery collapses spaces: '1 OAK' becomes '1oak'", () => {
  assert.equal(normalizeQuery("1 OAK"), "1oak");
});

// NORM-03: Digit preservation
test("normalizeQuery preserves digits: '1oak' stays '1oak'", () => {
  assert.equal(normalizeQuery("1oak"), "1oak");
});

// NORM-04: Case normalization
test("normalizeQuery lowercases: 'CeLaVi' becomes 'celavi'", () => {
  assert.equal(normalizeQuery("CeLaVi"), "celavi");
});

// Edge cases
test("normalizeQuery handles empty string", () => {
  assert.equal(normalizeQuery(""), "");
});

test("normalizeQuery handles whitespace-only string", () => {
  assert.equal(normalizeQuery("  "), "");
});

// stripAccents: strips accents but preserves spaces and casing
test("stripAccents preserves spaces and case: 'CÉ LA VI' becomes 'CE LA VI'", () => {
  assert.equal(stripAccents("CÉ LA VI"), "CE LA VI");
});

test("stripAccents strips macron but preserves spaces: 'Shinjūku' becomes 'Shinjuku'", () => {
  assert.equal(stripAccents("Shinjūku"), "Shinjuku");
});
