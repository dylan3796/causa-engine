import { describe, expect, it } from "vitest";
import { computeDispute, computeEconomics } from "@/src/economics";
import { estimate } from "@/src/causal/estimator";
import { HOUR, T0, claimRun, ev, makeContract, world } from "./helpers";

describe("economics", () => {
  it("usage billing sums run costs; model split carries shares and marginals", () => {
    const contract = makeContract({ billing: { kind: "usage" }, qualityBar: null });
    const runs = [
      claimRun("t1", T0, { model: "model-a", costCents: 100 }),
      claimRun("t2", T0, { model: "model-a", costCents: 120 }),
      claimRun("t3", T0, { model: "model-b", costCents: 40 }),
      claimRun("t4", T0, { model: "model-b", costCents: 300 }), // claim never verifies
    ];
    const outcomes = [
      ev("t1", "resolved", T0 + HOUR),
      ev("t2", "resolved", T0 + HOUR),
      ev("t3", "resolved", T0 + HOUR),
    ];
    const { graph, report } = world(contract, runs, outcomes);
    const econ = computeEconomics(contract, report, graph.workflowRuns);
    expect(econ.spendCents).toBe(560);
    expect(econ.costPerVerifiedCents).toBe(187); // R2(560/3)
    expect(econ.modelSplit).toEqual([
      { model: "model-a", verified: 2, share: 0.67, marginalCostPerVerifiedCents: 110 },
      { model: "model-b", verified: 1, share: 0.33, marginalCostPerVerifiedCents: 40 },
    ]);
  });

  it("per-outcome billing pays for claims, not verifications", () => {
    const contract = makeContract({ billing: { kind: "perOutcome", rateCents: 100 } });
    const runs = [claimRun("t1", T0), claimRun("t2", T0)];
    const outcomes = [ev("t1", "resolved", T0 + HOUR)];
    const { graph, report } = world(contract, runs, outcomes);
    const econ = computeEconomics(contract, report, graph.workflowRuns);
    expect(econ.spendCents).toBe(200); // 2 claims × 100¢, one never happened
    expect(econ.costPerVerifiedCents).toBe(200);
  });

  it("dispute chain: fair price = R1(rate × incrementality), rounded before the delta", () => {
    const contract = makeContract({ billing: { kind: "perOutcome", rateCents: 100 } });
    const runs = Array.from({ length: 12 }, (_, i) => claimRun(`t${i}`, T0));
    const outcomes = runs.flatMap((r, i) => {
      const id = `t${i}`;
      if (i >= 10) return []; // 2 didNotHappen
      const resolved = [ev(id, "resolved", T0 + HOUR)];
      if (i >= 8) resolved.push(ev(id, "reopened", T0 + 2 * HOUR)); // 2 fail quality
      return resolved;
    });
    const { graph, report } = world(contract, runs, outcomes);
    expect(report.verified.length).toBe(8);
    const estimator = estimate(graph, report); // rules design: nothing would have happened anyway
    const dispute = computeDispute(contract, report, { ...estimator, attributable: 6 })!;
    expect(dispute.fairPriceCents).toBe(75); // R1(100 × 6/8)
    expect(dispute.deltaPerOutcomeCents).toBe(25);
    expect(dispute.adjustmentCents).toBe(200); // 2 quality failures × 100¢
    expect(dispute.incrementalityPct).toBe(75);
  });

  it("model-switch companion checks quality parity on raw percentage points", () => {
    const contract = makeContract({
      billing: { kind: "usage" },
      qualityBar: null,
      modelSwitchCompanion: { incumbentModel: "model-a", altModel: "model-b" },
    });
    const runs = [
      ...Array.from({ length: 10 }, (_, i) => claimRun(`a${i}`, T0, { model: "model-a", costCents: 50 })),
      ...Array.from({ length: 10 }, (_, i) => claimRun(`b${i}`, T0, { model: "model-b", costCents: 20 })),
    ];
    const outcomes = [
      ...Array.from({ length: 9 }, (_, i) => ev(`a${i}`, "resolved", T0 + HOUR)),
      ...Array.from({ length: 9 }, (_, i) => ev(`b${i}`, "resolved", T0 + HOUR)),
    ];
    const { graph, report } = world(contract, runs, outcomes);
    const econ = computeEconomics(contract, report, graph.workflowRuns);
    expect(econ.modelSwitch).toMatchObject({ parity: true, savingsPerVerifiedCents: 30 });
  });
});
