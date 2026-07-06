import { describe, expect, it } from "vitest";
import { newcombeDiff, wilson } from "@/src/causal/stats";

describe("closed-form intervals", () => {
  it("Wilson 8/10 matches the known 95% interval", () => {
    const { lo, hi } = wilson(8, 10);
    expect(lo).toBeCloseTo(0.49, 2);
    expect(hi).toBeCloseTo(0.943, 2);
  });

  it("Wilson stays in [0,1] and contains the point estimate", () => {
    for (const [k, n] of [
      [0, 10],
      [10, 10],
      [1, 1000],
      [499, 1000],
    ] as const) {
      const { lo, hi } = wilson(k, n);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(k / n);
      expect(hi).toBeGreaterThanOrEqual(k / n);
    }
  });

  it("Newcombe difference contains the point difference", () => {
    const { lo, hi } = newcombeDiff(80, 100, 23, 100);
    const d = 0.8 - 0.23;
    expect(lo).toBeLessThan(d);
    expect(hi).toBeGreaterThan(d);
    expect(hi - lo).toBeLessThan(0.3);
  });
});
