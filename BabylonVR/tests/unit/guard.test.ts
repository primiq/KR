// What arrives over the network is checked before the game sees it (net/guard.ts).
import { describe, expect, it } from "vitest";
import { eventOk, RateLimit, stateOk } from "../../src/castaway/net/guard";

const st = [12.3, 4.5, -8, 1.2, -0.1, 3.4, "hatchet", 7, 3, 100, 0, 0];
describe("player states", () => {
  it("accepts real ones (with and without a VR pose)", () => {
    expect(stateOk(st)).toBe(true);
    expect(stateOk(st.slice(0, 10))).toBe(true);
    expect(stateOk([...st.slice(0, 10), { h: [0, 1.6, 0, 0.1, 0, 0], r: [0.2, 1.2, -0.3, 0, 0, 0, 1], l: 0 }, 0])).toBe(true);
  });
  it("refuses broken ones", () => {
    expect(stateOk([NaN, ...st.slice(1)])).toBe(false);
    expect(stateOk([1e9, ...st.slice(1)])).toBe(false);
    expect(stateOk([...st.slice(0, 6), "x".repeat(100), ...st.slice(7)])).toBe(false);
    expect(stateOk("nope")).toBe(false);
  });
});
describe("events", () => {
  it("accepts real ones, a painting included", () => {
    expect(eventOk({ k: "ps", n: "a1", id: "rock", c: 1, x: 1, y: 2, z: 3 })).toBe(true);
    expect(eventOk({ k: "pt", d: "data:image/png;base64," + "A".repeat(200000) })).toBe(true);
  });
  it("refuses broken or oversized ones", () => {
    expect(eventOk({ k: "ps", x: NaN })).toBe(false);
    expect(eventOk({ k: "ps", x: Infinity })).toBe(false);
    expect(eventOk({ k: "x".repeat(20) })).toBe(false);
    expect(eventOk([1, 2])).toBe(false);
    expect(eventOk({ k: "a", s: "x".repeat(700000) })).toBe(false);
    expect(eventOk({ k: "a", l: new Array(6000).fill(0) })).toBe(false);
  });
  it("caps a flood at the burst", () => {
    const rl = new RateLimit(80, 240); let n = 0;
    for (let i = 0; i < 2000; i++) if (rl.take(1)) n++;
    expect(n).toBe(240);
  });
});
