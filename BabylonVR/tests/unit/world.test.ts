// The island's shape is what every save and every multiplayer session agrees on: trees, rocks and buildings are kept by
// position and by node number, so a change in heightAt or in the open sea's layout breaks old saves and mixed-version
// rooms. These fix sample points; if one fails, the change was to the world itself (bump LAYOUT in net/save.ts on purpose,
// then refresh the fixture with: GEN=1 npx vitest run tests/unit/world.test.ts).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { heightAt } from "../../src/castaway/world/island";
import { featuresNear, SEA_END } from "../../src/castaway/world/seafeatures";
import { coldAt, inland, LAND_R } from "../../src/castaway/world/arctic";

const FIX = fileURLToPath(new URL("./world.fixture.json", import.meta.url));
const points: [number, number][] = [];
for (let r = 0; r <= 9000; r += r < 600 ? 37 : 613) for (let a = 0; a < 6.28; a += 0.7) points.push([+(Math.cos(a) * r).toFixed(1), +(Math.sin(a) * r).toFixed(1)]);
// (the levels far away: desert, volcano)
points.push([0, 15200], [40, 20030], [0, -14000], [3000, 0], [-3000, 0]);

const sample = () => ({
  heights: points.map(([x, z]) => +heightAt(x, z).toFixed(4)),
  islets: featuresNear(0, 0, SEA_END + 300).map((f) => [f.kind, Math.round(f.x), Math.round(f.z), +f.r.toFixed(2)]),
});

describe("the world's shape", () => {
  if (process.env.GEN) { it("writes the fixture", () => { writeFileSync(FIX, JSON.stringify(sample())); }); return; }
  const fix = existsSync(FIX) ? JSON.parse(readFileSync(FIX, "utf8")) : null;
  it("has a fixture", () => expect(fix).not.toBeNull());
  it("heights at fixed points are unchanged", () => { expect(sample().heights).toEqual(fix.heights); });
  it("the open sea's islets and wrecks are where they were", () => { expect(sample().islets).toEqual(fix.islets); });
  it("is deterministic", () => { const a = sample(), b = sample(); expect(a).toEqual(b); });
});

describe("the far sea", () => {
  it("is warm at home and cold at the Arctic", () => {
    expect(coldAt(0, 0)).toBe(0);
    expect(coldAt(LAND_R, 0)).toBeGreaterThan(0.9);
  });
  it("has land past the Arctic coast", () => {
    expect(inland(0, 0)).toBeLessThan(0);
    expect(inland(LAND_R + 800, 0)).toBeGreaterThan(0);
    expect(heightAt(LAND_R + 800, 0)).toBeGreaterThan(0);
  });
});
