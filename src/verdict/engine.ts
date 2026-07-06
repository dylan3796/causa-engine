/**
 * The deterministic verdict engine (CAUSA.md §6.3). Verdicts come from
 * replayable logic — ordered rules as data, first match wins, every output
 * carrying the metric snapshot it evaluated and a replay record. LLMs are
 * structurally excluded from this stage: a verdict you can't replay is a
 * verdict you can't defend in a billing dispute.
 */
import { R3_dollars } from "../numeric";
import type { MetricRecord, Predicate } from "../predicates";
import { evalPredicate } from "../predicates";
import type {
  DisputeBlock,
  EconomicsReport,
  EstimatorResult,
  OutcomeContract,
  ReplayRecord,
  VerdictKind,
  VerdictResult,
  VerificationReport,
} from "../types";
import { EngineError } from "../types";

export type ImpactFormula =
  | { kind: "flatFeeRecovery" }
  | { kind: "renegotiationDelta" }
  | { kind: "rerouteDelta" }
  | { kind: "expandProjection" }
  | { kind: "repriceDelta"; targetRateCents: number };

export interface VerdictRule {
  id: string;
  verdict: VerdictKind;
  priority: number;
  when: Predicate;
  impact: ImpactFormula;
}

export interface VerdictContext {
  contract: OutcomeContract;
  report: VerificationReport;
  estimator: EstimatorResult;
  economics: EconomicsReport;
  dispute?: DisputeBlock;
}

/** The typed metric registry verdict predicates evaluate against. */
export function verdictMetrics(ctx: VerdictContext): MetricRecord {
  const { contract, report, estimator, economics, dispute } = ctx;
  const verified = report.verified.length;

  // Worst per-slice point delta (verified − expected, unrounded). Workflows
  // without slice designs get their single-population delta.
  const minSlicePointDelta = estimator.perSlice
    ? Math.min(...estimator.perSlice.map((s) => s.pointDelta))
    : verified - estimator.counterfactualCount;

  const metrics: MetricRecord = {
    billingKind: contract.billing.kind,
    qualityPassPct: report.qualityPassPct,
    costPerVerifiedCents: economics.costPerVerifiedCents,
    incrementalityPct: Math.round((100 * estimator.attributable) / verified),
    minSlicePointDelta,
    expandConfigured: contract.expand !== undefined,
  };
  if (dispute) {
    metrics.rateCents = dispute.billedPerOutcomeCents;
    metrics.fairPriceCents = dispute.fairPriceCents;
    metrics.priceDeltaCents = dispute.deltaPerOutcomeCents;
  }
  if (economics.modelSwitch) {
    metrics.modelSwitchParity = economics.modelSwitch.parity;
    metrics.modelSwitchSavingsCents = economics.modelSwitch.savingsPerVerifiedCents;
  }
  if (estimator.baselineCostPerOutcomeCents !== undefined) {
    metrics.baselineCostPerOutcomeCents = estimator.baselineCostPerOutcomeCents;
    metrics.costVsBaselinePct = Math.round(
      (100 * economics.costPerVerifiedCents) / estimator.baselineCostPerOutcomeCents
    );
  }
  return metrics;
}

function computeImpact(formula: ImpactFormula, ctx: VerdictContext): number {
  const { contract, report, estimator, economics, dispute } = ctx;
  switch (formula.kind) {
    case "flatFeeRecovery": {
      if (contract.billing.kind !== "flatMonthly") {
        throw new EngineError("verdict", "flatFeeRecovery requires flatMonthly billing");
      }
      return R3_dollars(contract.billing.feeCents / 100);
    }
    case "renegotiationDelta": {
      if (!dispute) throw new EngineError("verdict", "renegotiationDelta requires a dispute block");
      return R3_dollars((dispute.deltaPerOutcomeCents * report.verified.length) / 100);
    }
    case "rerouteDelta": {
      if (!economics.modelSwitch) throw new EngineError("verdict", "rerouteDelta requires a model-switch companion");
      return R3_dollars((economics.modelSwitch.savingsPerVerifiedCents * estimator.attributable) / 100);
    }
    case "expandProjection": {
      if (!contract.expand) throw new EngineError("verdict", "expandProjection requires expand params");
      return R3_dollars(
        (contract.expand.adjacentVolume *
          (contract.expand.adjacentBaselineCostCents - economics.costPerVerifiedCents)) /
          100
      );
    }
    case "repriceDelta": {
      if (!dispute) throw new EngineError("verdict", "repriceDelta requires a dispute block");
      return R3_dollars(
        ((dispute.billedPerOutcomeCents - formula.targetRateCents) * report.verified.length) / 100
      );
    }
  }
}

export function decideVerdict(rules: VerdictRule[], ctx: VerdictContext, replay: ReplayRecord): VerdictResult {
  const metrics = verdictMetrics(ctx);
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
  for (const rule of ordered) {
    if (!evalPredicate(rule.when, metrics)) continue;
    return {
      verdict: rule.verdict,
      ruleId: rule.id,
      impactPerMonthDollars: computeImpact(rule.impact, ctx),
      inputs: Object.fromEntries(
        Object.entries(metrics).filter(([, v]) => v !== undefined)
      ) as VerdictResult["inputs"],
      replay,
    };
  }
  throw new EngineError(
    "verdict",
    `no verdict rule matched workflow ${ctx.contract.workflowId} — the rule set must be total`
  );
}
