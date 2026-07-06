/**
 * Property/invariant tests, driven by the engine's own seeded PRNG —
 * deterministic across runs, no property-testing dependency.
 */
import { describe, expect, it } from "vitest";
import { distributeCents, randInt, substream } from "@/src/prng";
import { wilson } from "@/src/causal/stats";
import { canonicalJson, hashValue } from "@/src/hash";
import { R1_count, clamp } from "@/src/numeric";

describe("invariants", () => {
  it("distributeCents always sums exactly and never goes negative (200 cases)", () => {
    const rand = substream("prop", "distribute");
    for (let i = 0; i < 200; i++) {
      const n = randInt(rand, 1, 200);
      const total = randInt(rand, 0, 500_000);
      const parts = distributeCents(total, n, rand);
      expect(parts.length).toBe(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });

  it("Wilson bounds bracket the point estimate for arbitrary cells (200 cases)", () => {
    const rand = substream("prop", "wilson");
    for (let i = 0; i < 200; i++) {
      const n = randInt(rand, 1, 10_000);
      const k = randInt(rand, 0, n);
      const { lo, hi } = wilson(k, n);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(k / n + 1e-12);
      expect(hi).toBeGreaterThanOrEqual(k / n - 1e-12);
    }
  });

  it("two-group counterfactual math keeps the funnel ordered for arbitrary cells (200 cases)", () => {
    const rand = substream("prop", "twogroup");
    for (let i = 0; i < 200; i++) {
      const nC = randInt(rand, 1, 5_000);
      const kC = randInt(rand, 0, nC);
      const verified = randInt(rand, 0, 5_000);
      const cf = Math.min(verified, R1_count((kC / nC) * verified));
      const attributable = clamp(verified - cf, 0, verified);
      expect(cf).toBeGreaterThanOrEqual(0);
      expect(cf).toBeLessThanOrEqual(verified);
      expect(attributable + cf).toBe(verified);
    }
  });

  it("canonical serialization is insensitive to key order", () => {
    const a = { z: 1, a: { d: [3, 2], b: "x" }, m: null };
    const b = { m: null, a: { b: "x", d: [3, 2] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hashValue(a)).toBe(hashValue(b));
  });

  it("substreams are independent: adding one stream never shifts another", () => {
    const s1 = substream("seed", "alpha");
    const first = [s1(), s1(), s1()];
    substream("seed", "beta")(); // interleave another stream
    const s2 = substream("seed", "alpha");
    expect([s2(), s2(), s2()]).toEqual(first);
  });
});
