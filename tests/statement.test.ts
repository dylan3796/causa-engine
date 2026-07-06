/**
 * Statement-level behavior: the two-engine composition. The evidence-grade
 * ceiling is for MISSING design data only — integrity violations fail the
 * whole statement. The baseline ladder always measures a counterfactual.
 * The outcome engine interprets candidates the customer never defined.
 */
import { describe, expect, it } from "vitest";
import { runStatement, type EngineConfig } from "@/src/statement";
import type { CounterfactualDesign, EngineInputs, MonthlySummary } from "@/src/types";
import { AGENT, HOUR, HUMAN, T0, TICKET_RULES, claimRun, ev, iso, makeContract, touchRun } from "./helpers";

const MONTHS: MonthlySummary[] = [
  { month: "2025-01", volume: 1, costPerOutcomeCents: 500 },
  { month: "2025-02", volume: 1, costPerOutcomeCents: 520 },
  { month: "2025-03", volume: 1, costPerOutcomeCents: 510 },
];

const BASELINE_DESIGN: CounterfactualDesign = {
  kind: "preAgentBaseline",
  basis: "displacement",
  months: MONTHS,
  match: { volumeTolerancePct: 25, minMonths: 1 },
  seasonality: { comparisonMonth: "2025-01", maxDivergencePct: 15 },
};

function microConfig(corroboration?: CounterfactualDesign[]): EngineConfig {
  return {
    contracts: [
      makeContract({
        billing: { kind: "flatMonthly", feeCents: 10000 },
        counterfactual: { kind: "holdout", experimentId: "hx", treatedArm: "treated", controlArm: "control" },
        corroboration,
      }),
    ],
    extractRuleSets: [TICKET_RULES],
    verdictRules: [
      {
        id: "hold",
        verdict: "EXPAND",
        priority: 1,
        when: { op: "exists", metric: "qualityPassPct" },
        impact: { kind: "flatFeeRecovery" },
      },
    ],
    activitySourceLabels: { langsmith: "LangSmith", log_upload: "Log upload" },
    boundaryWindowDays: 30,
  };
}

function microInputs(arms: "withArms" | "noArms"): EngineInputs {
  const withArms = arms === "withArms";
  return {
    periodStart: iso(T0),
    periodEnd: iso(T0 + 30 * 24 * HOUR),
    actors: [AGENT, HUMAN],
    runs: [claimRun("t1", T0)],
    outcomes: [
      ev("t1", "created", T0, withArms ? { experimentId: "hx", arm: "treated" } : undefined),
      ev("t1", "resolved", T0 + HOUR),
      ev("c1", "created", T0, withArms ? { experimentId: "hx", arm: "control" } : undefined),
    ],
  };
}

describe("evidence-grade ceiling vs integrity violations", () => {
  it("missing design data with no ladder bottoms out at Grade D and says so", () => {
    const statement = runStatement(microInputs("noArms"), microConfig());
    const wf = statement.workflows[0];
    expect(wf.estimator.grade).toBe("D");
    expect(wf.estimator.notes.join(" ")).toMatch(/Evidence-grade ceiling/);
    expect(wf.verified).toBe(1);
  });

  it("a contaminated holdout fails the statement instead of degrading quietly", () => {
    const inputs = microInputs("withArms");
    inputs.runs = [...inputs.runs, touchRun(AGENT.id, "c1", T0 + HOUR)]; // agent touches the control arm
    expect(() => runStatement(inputs, microConfig())).toThrow(/exclusion violated/);
  });

  it("with recorded arms intact, the holdout estimator runs at Grade A", () => {
    const statement = runStatement(microInputs("withArms"), microConfig());
    expect(statement.workflows[0].estimator.grade).toBe("A");
  });
});

describe("the baseline ladder — a baseline is always measured", () => {
  it("falls back to the best corroborating design when the primary's data is missing", () => {
    const statement = runStatement(microInputs("noArms"), microConfig([BASELINE_DESIGN]));
    const e = statement.workflows[0].estimator;
    expect(e.grade).toBe("C");
    expect(e.designKind).toBe("preAgentBaseline");
    expect(e.notes.join(" ")).toMatch(/fell back to corroborating preAgentBaseline/);
  });

  it("runs corroborating baselines alongside an intact primary and attaches them as evidence", () => {
    const statement = runStatement(microInputs("withArms"), microConfig([BASELINE_DESIGN]));
    const e = statement.workflows[0].estimator;
    expect(e.grade).toBe("A"); // primary settles
    expect(e.corroboration).toHaveLength(1);
    expect(e.corroboration![0].grade).toBe("C");
    // Corroboration is evidence, never averaged into the settlement.
    expect(e.attributable).toBe(statement.workflows[0].attributable);
  });
});

describe("the outcome engine interprets candidates", () => {
  it("drafts a contract for joined events no contract covers", () => {
    const inputs = microInputs("withArms");
    inputs.outcomes = [
      ...inputs.outcomes,
      ev("t1", "refund_processed", T0 + 5 * HOUR),
      ev("t1", "refund_processed", T0 + 8 * HOUR),
    ];
    const statement = runStatement(inputs, microConfig());
    const candidate = statement.candidates.find((c) => c.kind === "uncontractedOutcome");
    expect(candidate).toBeDefined();
    expect(candidate!.eventType).toBe("refund_processed");
    expect(candidate!.count).toBe(2);
    expect(candidate!.draft).toMatchObject({ eventType: "refund_processed", entityKind: "ticket" });
    expect(candidate!.sampleEntities).toEqual(["ticket:t1"]);
    expect(candidate!.context.join(" ")).toMatch(/No outcome contract covers/);
  });

  it("proposes a wider quality bar when outcomes fail just past it", () => {
    const config = microConfig();
    const inputs = microInputs("withArms");
    // Reopen on day 10 — outside the 7-day bar, inside the 30-day widened window.
    inputs.outcomes = [...inputs.outcomes, ev("t1", "reopened", T0 + HOUR + 10 * 24 * HOUR)];
    const statement = runStatement(inputs, config);
    const candidate = statement.candidates.find((c) => c.kind === "qualityBarBoundary");
    expect(candidate).toBeDefined();
    expect(candidate!.count).toBe(1);
    expect(candidate!.draft?.suggestedQualityBar).toEqual({ kind: "noEventWithin", eventType: "reopened", days: 30 });
  });
});
