import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("all Docker Node stages use an explicit supported security release", () => {
  const docker = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  const stages = [...docker.matchAll(/^FROM\s+node:([^\s]+)/gm)];
  assert.equal(stages.length, 2, "Validate both build and runtime stages");
  const minimums: Record<number, [number, number]> = {22:[23,4],24:[22,1],26:[12,1]};
  for (const [, tag] of stages) {
    const version = /^(\d+)\.(\d+)\.(\d+)-/.exec(tag);
    assert.ok(version, "Floating Node tags cannot preserve the security baseline");
    const [, major, minor, patch] = version.map(Number);
    const minimum = minimums[major];
    assert.ok(minimum, "Node release line must be supported");
    assert.ok(minor > minimum[0] || (minor === minimum[0] && patch >= minimum[1]), "Node image predates the October security release");
  }
});
