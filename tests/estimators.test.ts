import { describe, expect, it } from "vitest";
import { estimate } from "@/src/causal/estimator";
import type { ActivityRun, OutcomeEvent } from "@/src/types";
import { AGENT, DAY, HOUR, HUMAN, T0, claimRun, ev, makeContract, touchRun, world } from "./helpers";

describe("Grade A — holdout", () => {
  function holdoutWorld(opts: { treated: number; verified: number; control: number; controlPass: number }) {
    const contract = makeContract({
      counterfactual: { kind: "holdout", experimentId: "hx", treatedArm: "treated", controlArm: "control" },
    });
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= opts.treated; i++) {
      const id = `t${i}`;
      outcomes.push(ev(id, "created", T0, { experimentId: "hx", arm: "treated" }));
      if (i <= opts.verified) {
        runs.push(claimRun(id, T0 + HOUR));
        outcomes.push(ev(id, "resolved", T0 + 2 * HOUR));
      }
    }
    for (let i = 1; i <= opts.control; i++) {
      const id = `c${i}`;
      outcomes.push(ev(id, "created", T0, { experimentId: "hx", arm: "control" }));
      if (i <= opts.controlPass) outcomes.push(ev(id, "resolved", T0 + 2 * HOUR));
    }
    return { contract, runs, outcomes };
  }

  it("projects the control rate onto the treated arm: cf = R1(k_c·n_t/n_c)", () => {
    const { contract, runs, outcomes } = holdoutWorld({ treated: 90, verified: 45, control: 10, controlPass: 2 });
    const { graph, report } = world(contract, runs, outcomes);
    const r = estimate(graph, report);
    expect(r.grade).toBe("A");
    expect(r.counterfactualCount).toBe(18); // 2 × 90 / 10
    expect(r.attributable).toBe(27);
    expect(r.cells).toEqual({ treated: { n: 90, k: 45 }, control: { n: 10, k: 2 } });
    expect(r.interval!.lo).toBeGreaterThanOrEqual(0);
    expect(r.interval!.hi).toBeLessThanOrEqual(1);
  });

  it("verifies exclusion instead of assuming it: an agent touch on the holdout throws", () => {
    const { contract, runs, outcomes } = holdoutWorld({ treated: 10, verified: 5, control: 5, controlPass: 1 });
    runs.push(touchRun(AGENT.id, "c1", T0 + HOUR));
    const { graph, report } = world(contract, runs, outcomes);
    expect(() => estimate(graph, report)).toThrow(/exclusion violated/);
  });
});

describe("Grade B — DiD staged rollout", () => {
  function didWorld(cells: { preT: number; preC: number; postC: number }, verified: number, postN: number) {
    const contract = makeContract({
      counterfactual: {
        kind: "naturalExperiment",
        form: "didStagedRollout",
        slices: [
          {
            slice: "agent_only",
            experimentId: "dx",
            arms: { treatedPre: "tp", controlPre: "cp", controlPost: "cq", treatedPost: "tq" },
          },
        ],
      },
    });
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    const cell = (prefix: string, arm: string, n: number, k: number) => {
      for (let i = 1; i <= n; i++) {
        const id = `${prefix}${i}`;
        outcomes.push(ev(id, "created", T0 - 20 * DAY, { experimentId: "dx", arm }));
        if (i <= k) outcomes.push(ev(id, "resolved", T0 - 19 * DAY));
      }
    };
    cell("a", "tp", 10, cells.preT);
    cell("b", "cp", 10, cells.preC);
    cell("c", "cq", 10, cells.postC);
    for (let i = 1; i <= postN; i++) {
      const id = `d${i}`;
      outcomes.push(ev(id, "created", T0, { experimentId: "dx", arm: "tq" }));
      if (i <= verified) {
        runs.push(claimRun(id, T0 + HOUR));
        outcomes.push(ev(id, "resolved", T0 + 2 * HOUR));
      }
    }
    return world(contract, runs, outcomes);
  }

  it("additive DiD: expected = preT + (postC − preC), projected on the post population", () => {
    // expected rate = 0.2 + (0.3 − 0.2) = 0.3 → cf = R1(3.0) = 3
    const { graph, report } = didWorld({ preT: 2, preC: 2, postC: 3 }, 6, 10);
    const r = estimate(graph, report);
    expect(r.grade).toBe("B");
    expect(r.perSlice![0].counterfactual).toBe(3);
    expect(r.attributable).toBe(3);
    expect(r.perSlice![0].pointDelta).toBeCloseTo(3, 6);
  });

  it("clamps a negative slice to zero attribution and preserves the negative point delta", () => {
    // expected rate 0.5 → cf raw 5 vs 2 verified → attributable 0, delta −3
    const { graph, report } = didWorld({ preT: 5, preC: 5, postC: 5 }, 2, 10);
    const r = estimate(graph, report);
    expect(r.attributable).toBe(0);
    expect(r.perSlice![0].pointDelta).toBeCloseTo(-3, 6);
    expect(r.counterfactualCount).toBe(report.verified.length);
  });
});

describe("Grade B — two-group routing gap", () => {
  function routingWorld(claims: number, verified: number) {
    const contract = makeContract({
      counterfactual: { kind: "naturalExperiment", form: "twoGroupRoutingGap", experimentId: "rx", controlArm: "off" },
    });
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= 20; i++) {
      const id = `o${i}`;
      outcomes.push(ev(id, "created", T0, { experimentId: "rx", arm: "off" }));
      if (i <= 5) outcomes.push(ev(id, "resolved", T0 + HOUR));
    }
    for (let i = 1; i <= claims; i++) {
      const id = `v${i}`;
      runs.push(claimRun(id, T0 + HOUR));
      if (i <= verified) outcomes.push(ev(id, "resolved", T0 + 2 * HOUR));
    }
    return world(contract, runs, outcomes);
  }

  it("projects the uncovered slice's rate onto covered attempts", () => {
    const { graph, report } = routingWorld(8, 8);
    const r = estimate(graph, report);
    expect(r.counterfactualCount).toBe(2); // R1(0.25 × 8 attempts)
    expect(r.attributable).toBe(6);
    expect(r.grade).toBe("B");
  });

  it("attempts, not verified successes, are the projection base — a low verification rate must not flatter the agent", () => {
    const { graph, report } = routingWorld(10, 8);
    const r = estimate(graph, report);
    // Projecting onto the 8 verified would give R1(2) = 2; attempts give R1(0.25 × 10) = 3.
    expect(r.counterfactualCount).toBe(3);
    expect(r.attributable).toBe(5);
    expect(r.cells.treated).toEqual({ n: 10, k: 8 });
  });
});

describe("Grade C — pre-agent baseline", () => {
  const months = [
    { month: "2025-01", volume: 10, costPerOutcomeCents: 900 },
    { month: "2025-02", volume: 11, costPerOutcomeCents: 1100 },
    { month: "2025-03", volume: 9, costPerOutcomeCents: 1000 },
    { month: "2025-04", volume: 100, costPerOutcomeCents: 5000 }, // volume unmatched
  ];

  function baselineWorld(verified: number) {
    const contract = makeContract({
      qualityBar: null,
      counterfactual: {
        kind: "preAgentBaseline",
        basis: "displacement",
        months,
        match: { volumeTolerancePct: 25, minMonths: 2 },
        seasonality: { comparisonMonth: "2025-01", maxDivergencePct: 15 },
      },
    });
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= verified; i++) {
      const id = `w${i}`;
      runs.push(claimRun(id, T0 + HOUR));
      outcomes.push(ev(id, "resolved", T0 + 2 * HOUR));
    }
    return world(contract, runs, outcomes);
  }

  it("matches months by volume and takes the lower-middle median cost", () => {
    const { graph, report } = baselineWorld(10);
    const r = estimate(graph, report);
    expect(r.grade).toBe("C");
    expect(r.cells.matchedMonths).toEqual({ n: 4, k: 3 });
    expect(r.baselineCostPerOutcomeCents).toBe(1000); // median of [900, 1000, 1100]
    expect(r.attributable).toBe(10); // displacement: attribution counts work performed
    expect(r.counterfactualCount).toBe(0);
    expect(r.assumptions.join(" ")).toMatch(/displacement/i);
  });
});

describe("Grade D — rules", () => {
  it("counts verified outcomes matching the would-have-happened-anyway predicate", () => {
    const contract = makeContract({
      counterfactual: {
        kind: "rules",
        wouldHaveHappenedAnyway: { op: "cmp", metric: "hasPriorHumanTouch", cmp: "eq", value: true },
      },
    });
    const runs = [
      claimRun("t1", T0 + 2 * HOUR),
      claimRun("t2", T0 + 2 * HOUR),
      touchRun(HUMAN.id, "t1", T0 + HOUR), // human was already on t1 before the agent
    ];
    const outcomes = [ev("t1", "resolved", T0 + 3 * HOUR), ev("t2", "resolved", T0 + 3 * HOUR)];
    const { graph, report } = world(contract, runs, outcomes);
    const r = estimate(graph, report);
    expect(r.grade).toBe("D");
    expect(r.counterfactualCount).toBe(1);
    expect(r.attributable).toBe(1);
  });
});
