/**
 * Robustness surface: break-even sensitivity, post-stratification,
 * DiD placebo, and leave-one-out — every expectation hand-derived first.
 * Robustness is evidence about fragility; it must never move the ledger.
 */
import { describe, expect, it } from "vitest";
import { estimate } from "@/src/causal/estimator";
import { breakEven } from "@/src/causal/robustness";
import type { ActivityRun, OutcomeEvent } from "@/src/types";
import { AGENT, DAY, HOUR, T0, claimRun, ev, makeContract, world } from "./helpers";

describe("break-even sensitivity", () => {
  it("factor = verified / counterfactual: how much larger the measured counterfactual must be to erase the delta", () => {
    expect(breakEven(45, 18)).toMatchObject({ factor: 2.5 });
  });

  it("no finite factor when the measured counterfactual is zero", () => {
    const be = breakEven(10, 0)!;
    expect(be.factor).toBeNull();
    expect(be.note).toMatch(/no finite break-even/i);
  });

  it("factor ≤ 1 reads as already at break-even", () => {
    expect(breakEven(10, 10)!.note).toMatch(/at or below break-even/i);
  });
});

describe("Grade A — post-stratification (regression adjustment for categorical covariates)", () => {
  function stratWorld(spec: {
    treated: Array<{ stratum: string; n: number; verified: number }>;
    control: Array<{ stratum: string; n: number; k: number }>;
  }) {
    const contract = makeContract({
      counterfactual: {
        kind: "holdout",
        experimentId: "hx",
        treatedArm: "treated",
        controlArm: "control",
        stratifyBy: { field: "queue" },
      },
    });
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (const cell of spec.treated) {
      for (let i = 1; i <= cell.n; i++) {
        const id = `t-${cell.stratum}-${i}`;
        outcomes.push(ev(id, "created", T0, { experimentId: "hx", arm: "treated" }, { queue: cell.stratum }));
        if (i <= cell.verified) {
          runs.push(claimRun(id, T0 + HOUR));
          outcomes.push(ev(id, "resolved", T0 + 2 * HOUR));
        }
      }
    }
    for (const cell of spec.control) {
      for (let i = 1; i <= cell.n; i++) {
        const id = `c-${cell.stratum}-${i}`;
        outcomes.push(ev(id, "created", T0, { experimentId: "hx", arm: "control" }, { queue: cell.stratum }));
        if (i <= cell.k) outcomes.push(ev(id, "resolved", T0 + 2 * HOUR));
      }
    }
    const { graph, report } = world(contract, runs, outcomes);
    return estimate(graph, report);
  }

  it("mix-balanced arms: post-stratified counterfactual equals the primary", () => {
    // Treated 20 (10 q1 + 10 q2), control 10 (5+5) with rates 0.2/0.6.
    // Primary cf = R1(4/10 × 20) = 8; post-strat = 0.2·10 + 0.6·10 = 8.
    const r = stratWorld({
      treated: [
        { stratum: "q1", n: 10, verified: 6 },
        { stratum: "q2", n: 10, verified: 6 },
      ],
      control: [
        { stratum: "q1", n: 5, k: 1 },
        { stratum: "q2", n: 5, k: 3 },
      ],
    });
    const ps = r.robustness!.postStratified!;
    expect(r.counterfactualCount).toBe(8);
    expect(ps.counterfactual).toBe(8);
    expect(ps.agreesWithPrimary).toBe(true);
    expect(ps.maxShareDivergencePts).toBe(0);
  });

  it("mix-imbalanced arms: the adjusted counterfactual diverges and the divergence is disclosed", () => {
    // Treated mix 80/20 on q1/q2, control mix 20/80; rates q1 0/2, q2 4/8.
    // Primary cf = R1(4/10 × 20) = 8; post-strat = 0·16 + 0.5·4 = 2.
    const r = stratWorld({
      treated: [
        { stratum: "q1", n: 16, verified: 10 },
        { stratum: "q2", n: 4, verified: 2 },
      ],
      control: [
        { stratum: "q1", n: 2, k: 0 },
        { stratum: "q2", n: 8, k: 4 },
      ],
    });
    const ps = r.robustness!.postStratified!;
    expect(r.counterfactualCount).toBe(8);
    expect(ps.counterfactual).toBe(2);
    expect(ps.agreesWithPrimary).toBe(false);
    expect(ps.maxShareDivergencePts).toBe(60);
    expect(ps.note).toMatch(/mix-imbalanced/);
  });

  it("a treated stratum with no control entities skips the adjustment and says so", () => {
    const r = stratWorld({
      treated: [
        { stratum: "q1", n: 5, verified: 3 },
        { stratum: "q3", n: 5, verified: 3 },
      ],
      control: [{ stratum: "q1", n: 5, k: 1 }],
    });
    expect(r.robustness!.postStratified).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/skipped: treated stratum 'q3' has no control entities/);
  });
});

describe("Grade B — DiD placebo and interval", () => {
  function didWorld(opts: {
    prePre?: { treated: number; control: number };
    placeboArms?: { prePreTreated: string; prePreControl: string };
    maxAbsDeltaPts?: number;
  }) {
    const contract = makeContract({
      counterfactual: {
        kind: "naturalExperiment",
        form: "didStagedRollout",
        slices: [
          {
            slice: "agent_only",
            experimentId: "dx",
            arms: { treatedPre: "tp", controlPre: "cp", controlPost: "cq", treatedPost: "tq" },
            placebo: opts.placeboArms
              ? { arms: opts.placeboArms, maxAbsDeltaPts: opts.maxAbsDeltaPts ?? 5 }
              : { arms: { prePreTreated: "ppt", prePreControl: "ppc" }, maxAbsDeltaPts: opts.maxAbsDeltaPts ?? 5 },
          },
        ],
      },
    });
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    const cell = (prefix: string, arm: string, n: number, k: number) => {
      for (let i = 1; i <= n; i++) {
        const id = `${prefix}${i}`;
        outcomes.push(ev(id, "created", T0 - 40 * DAY, { experimentId: "dx", arm }));
        if (i <= k) outcomes.push(ev(id, "resolved", T0 - 39 * DAY));
      }
    };
    cell("a", "tp", 10, 2);
    cell("b", "cp", 10, 2);
    cell("c", "cq", 10, 3);
    if (opts.prePre) {
      cell("p", "ppt", 10, opts.prePre.treated);
      cell("q", "ppc", 10, opts.prePre.control);
    }
    for (let i = 1; i <= 10; i++) {
      const id = `d${i}`;
      outcomes.push(ev(id, "created", T0, { experimentId: "dx", arm: "tq" }));
      if (i <= 6) {
        runs.push(claimRun(id, T0 + HOUR));
        outcomes.push(ev(id, "resolved", T0 + 2 * HOUR));
      }
    }
    const { graph, report } = world(contract, runs, outcomes);
    return estimate(graph, report);
  }

  it("placebo over pre-pre → pre estimates zero when nothing happened: pass", () => {
    // (0.2 − 0.2) − (0.2 − 0.2) = 0pts, limit ±5.
    const r = didWorld({ prePre: { treated: 2, control: 2 } });
    expect(r.robustness!.placebo).toMatchObject({ deltaPts: 0, pass: true });
  });

  it("a moving placebo fails loudly: the design registered an effect where truth is zero", () => {
    // (0.2 − 0.0) − (0.2 − 0.2) = +20pts, limit ±5.
    const r = didWorld({ prePre: { treated: 0, control: 2 } });
    expect(r.robustness!.placebo).toMatchObject({ deltaPts: 20, pass: false });
    expect(r.robustness!.placebo!.notes.join(" ")).toMatch(/FAIL/);
  });

  it("missing pre-pre arm data: placebo not run, disclosed in notes, estimate unaffected", () => {
    const r = didWorld({ placeboArms: { prePreTreated: "nope1", prePreControl: "nope2" } });
    expect(r.robustness!.placebo).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/placebo configured but its pre-pre arm data is missing/);
    expect(r.counterfactualCount).toBe(3); // R1((0.2 + 0.1) × 10)
  });

  it("states the pre-period gap the DiD nets out, and carries a did-wald-additive interval", () => {
    const r = didWorld({ prePre: { treated: 2, control: 2 } });
    expect(r.notes.join(" ")).toMatch(/pre-period treated−control gap \+0pts/);
    expect(r.interval).toMatchObject({ method: "did-wald-additive", level: 0.95 });
    expect(r.interval!.lo).toBeGreaterThanOrEqual(0);
    expect(r.interval!.hi).toBeLessThanOrEqual(1);
    expect(r.interval!.lo).toBeLessThan(r.interval!.hi);
  });
});

describe("Grade C — leave-one-out over matched months", () => {
  function baselineWorld(basis: "displacement" | "occurrence") {
    const contract = makeContract({
      qualityBar: null,
      counterfactual: {
        kind: "preAgentBaseline",
        basis,
        months: [
          { month: "2025-01", volume: 10, costPerOutcomeCents: 900 },
          { month: "2025-02", volume: 11, costPerOutcomeCents: 1100 },
          { month: "2025-03", volume: 9, costPerOutcomeCents: 1000 },
          { month: "2025-04", volume: 100, costPerOutcomeCents: 5000 },
        ],
        match: { volumeTolerancePct: 25, minMonths: 2 },
        seasonality: { comparisonMonth: "2025-01", maxDivergencePct: 15 },
      },
    });
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= 10; i++) {
      runs.push(claimRun(`w${i}`, T0 + HOUR));
      outcomes.push(ev(`w${i}`, "resolved", T0 + 2 * HOUR));
    }
    const { graph, report } = world(contract, runs, outcomes);
    return estimate(graph, report);
  }

  it("occurrence basis: LOO bounds the attributable count across dropped months", () => {
    // Matched volumes {9,10,11}: median 10 → attr 0; dropping 10 or 11 → median 9 → attr 1.
    const r = baselineWorld("occurrence");
    expect(r.counterfactualCount).toBe(10);
    expect(r.robustness!.leaveOneOut).toMatchObject({ lo: 0, hi: 1, metric: "attributable" });
  });

  it("displacement basis: LOO bounds the baseline unit cost the dispute and EXPAND consume", () => {
    // Matched costs {900, 1000, 1100}: median 1000; LOO medians {900, 1000}.
    const r = baselineWorld("displacement");
    expect(r.baselineCostPerOutcomeCents).toBe(1000);
    expect(r.robustness!.leaveOneOut).toMatchObject({
      lo: 900,
      hi: 1000,
      metric: "baselineCostPerOutcomeCents",
    });
    expect(r.robustness!.breakEven!.factor).toBeNull(); // displacement cf is structurally 0
  });
});
