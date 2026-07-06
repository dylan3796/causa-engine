import { describe, expect, it } from "vitest";
import { decideVerdict, type VerdictContext, type VerdictRule } from "@/src/verdict/engine";
import { VERDICT_RULES } from "@/src/fixtures/meridian/config";
import type { EstimatorResult, ReplayRecord, VerificationReport, VerifiedOutcome } from "@/src/types";
import { makeContract } from "./helpers";

const REPLAY: ReplayRecord = { inputHash: "a", configHash: "b", engineVersion: "test" };

function stubVerified(n: number): VerifiedOutcome[] {
  return Array.from({ length: n }, (_, i) => ({
    claimRunId: `r${i}`,
    actorId: "agent-1",
    entityKey: `k${i}`,
    outcomeEventId: `e${i}`,
    occurredAt: "2026-06-02T00:00:00.000Z",
    slice: "agent_only" as const,
  }));
}

function stubReport(claimed: number, verified: number, qualityPassPct: number): VerificationReport {
  return {
    workflowId: "wf",
    claimed,
    verified: stubVerified(verified),
    drop: { didNotHappen: claimed - verified, failedQualityBar: 0, unjoinable: 0, duplicateClaim: 0 },
    qualityFailures: {},
    qualityPassPct,
  };
}

function stubEstimator(overrides: Partial<EstimatorResult>): EstimatorResult {
  return {
    grade: "D",
    designKind: "rules",
    counterfactualCount: 0,
    attributable: 0,
    incrementality: { num: 0, den: 1 },
    cells: {},
    assumptions: [],
    notes: [],
    ...overrides,
  };
}

describe("the Meridian verdict rule set", () => {
  it("RETIRE fires on a flat-fee workflow with a non-incremental slice", () => {
    const ctx: VerdictContext = {
      contract: makeContract({ billing: { kind: "flatMonthly", feeCents: 290000 } }),
      report: stubReport(472, 314, 67),
      estimator: stubEstimator({
        attributable: 118,
        counterfactualCount: 196,
        perSlice: [
          { slice: "assisted", verified: 160, counterfactual: 42, attributable: 118, pointDelta: 118, cells: {} },
          { slice: "agent_only", verified: 154, counterfactual: 154, attributable: 0, pointDelta: -57.75, cells: {} },
        ],
      }),
      economics: { spendCents: 290000, costPerVerifiedCents: 924 },
    };
    const v = decideVerdict(VERDICT_RULES, ctx, REPLAY);
    expect(v.verdict).toBe("RETIRE");
    expect(v.impactPerMonthDollars).toBe(2900);
    expect(v.replay.engineVersion).toBe("test");
  });

  it("RENEGOTIATE fires on a per-outcome price gap of at least 5 cents", () => {
    const ctx: VerdictContext = {
      contract: makeContract({ billing: { kind: "perOutcome", rateCents: 150 } }),
      report: stubReport(3214, 2802, 87),
      estimator: stubEstimator({ attributable: 1989, counterfactualCount: 813 }),
      economics: { spendCents: 482100, costPerVerifiedCents: 172 },
      dispute: {
        claimed: 3214,
        qualityFailures: 61,
        qualityFailuresByReason: { ticket_reopened_within_7d: 61 },
        adjustmentCents: 9150,
        billedPerOutcomeCents: 150,
        fairPriceCents: 106,
        incrementalityPct: 71,
        deltaPerOutcomeCents: 44,
      },
    };
    const v = decideVerdict(VERDICT_RULES, ctx, REPLAY);
    expect(v.verdict).toBe("RENEGOTIATE");
    expect(v.impactPerMonthDollars).toBe(1233);
    expect(v.inputs.priceDeltaCents).toBe(44);
  });

  it("REROUTE fires on model-switch parity with cheaper marginals", () => {
    const ctx: VerdictContext = {
      contract: makeContract({ billing: { kind: "usage" } }),
      report: stubReport(640, 601, 94),
      estimator: stubEstimator({ attributable: 570, counterfactualCount: 31 }),
      economics: {
        spendCents: 198400,
        costPerVerifiedCents: 330,
        modelSwitch: {
          incumbentModel: "claude-fable-5",
          altModel: "qwen-3",
          incumbentAcceptPct: 94,
          altAcceptPct: 94,
          parity: true,
          savingsPerVerifiedCents: 189,
        },
      },
    };
    const v = decideVerdict(VERDICT_RULES, ctx, REPLAY);
    expect(v.verdict).toBe("REROUTE");
    expect(v.impactPerMonthDollars).toBe(1077);
  });

  it("EXPAND fires on 100% quality at a fraction of the baseline cost", () => {
    const ctx: VerdictContext = {
      contract: makeContract({
        billing: { kind: "usage" },
        expand: { adjacentVolume: 200, adjacentBaselineCostCents: 1112 },
      }),
      report: stubReport(486, 486, 100),
      estimator: stubEstimator({ attributable: 486, baselineCostPerOutcomeCents: 1190 }),
      economics: { spendCents: 20400, costPerVerifiedCents: 42 },
    };
    const v = decideVerdict(VERDICT_RULES, ctx, REPLAY);
    expect(v.verdict).toBe("EXPAND");
    expect(v.impactPerMonthDollars).toBe(2140);
  });

  it("REPRICE exists as the fifth stamp: fair price near rate, but rate far off market", () => {
    const ctx: VerdictContext = {
      contract: makeContract({ billing: { kind: "perOutcome", rateCents: 150 } }),
      report: stubReport(1000, 1000, 100),
      estimator: stubEstimator({ attributable: 980, counterfactualCount: 20 }),
      economics: { spendCents: 150000, costPerVerifiedCents: 150 },
      dispute: {
        claimed: 1000,
        qualityFailures: 0,
        qualityFailuresByReason: {},
        adjustmentCents: 0,
        billedPerOutcomeCents: 150,
        fairPriceCents: 147,
        incrementalityPct: 98,
        deltaPerOutcomeCents: 3,
      },
    };
    const v = decideVerdict(VERDICT_RULES, ctx, REPLAY);
    expect(v.verdict).toBe("REPRICE");
    expect(v.impactPerMonthDollars).toBe(510); // (150 − 99)¢ × 1,000 / 100
  });
});

describe("rule mechanics", () => {
  it("first match wins by priority", () => {
    const rules: VerdictRule[] = [
      { id: "b", verdict: "EXPAND", priority: 2, when: { op: "exists", metric: "qualityPassPct" }, impact: { kind: "flatFeeRecovery" } },
      { id: "a", verdict: "RETIRE", priority: 1, when: { op: "exists", metric: "qualityPassPct" }, impact: { kind: "flatFeeRecovery" } },
    ];
    const ctx: VerdictContext = {
      contract: makeContract({ billing: { kind: "flatMonthly", feeCents: 100 } }),
      report: stubReport(10, 5, 50),
      estimator: stubEstimator({ attributable: 5 }),
      economics: { spendCents: 100, costPerVerifiedCents: 20 },
    };
    expect(decideVerdict(rules, ctx, REPLAY).ruleId).toBe("a");
  });

  it("throws when no rule matches — the rule set must be total", () => {
    const ctx: VerdictContext = {
      contract: makeContract({ billing: { kind: "usage" } }),
      report: stubReport(10, 5, 50),
      estimator: stubEstimator({ attributable: 5 }),
      economics: { spendCents: 100, costPerVerifiedCents: 20 },
    };
    expect(() => decideVerdict(VERDICT_RULES, ctx, REPLAY)).toThrow(/no verdict rule matched/);
  });
});
