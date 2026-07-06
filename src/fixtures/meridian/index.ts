/**
 * Run the full pipeline over the Meridian fixtures and shape the result into
 * the ledger JSON that lib/data.ts consumes. assertMatchesPublished() is the
 * golden gate: the generate script runs it before writing JSON, the test
 * suite runs it again, and lib/data.ts pins the same numbers at next build.
 */
import { runStatement } from "../../statement";
import type { LedgerStatement, WorkflowStatement } from "../../types";
import { EngineError } from "../../types";
import { R4_pct, centsToDollars } from "../../numeric";
import { generateMeridianInputs } from "./generate";
import { MERIDIAN_CONFIG } from "./config";
import { CELLS, PUBLISHED } from "./workbook";

export interface LedgerWorkflowJson {
  id: string;
  claimed: number;
  verified: number;
  attributable: number;
  spend: number;
  costPerVerified: number;
  grade: string;
  verdict: string;
  impactPerMonth: number;
  qualityPassPct: number;
  incrementalityPct: number;
  deltaVsMay: number;
  sparkline: number[];
  modelSplit?: Array<{ model: string; costPerVerified: number; share: number }>;
}

export interface MeridianLedgerJson {
  engineVersion: string;
  replay: { inputHash: string; configHash: string };
  headers: {
    claimed: number;
    verified: number;
    attributable: number;
    spend: number;
    adjustmentIdentified: number;
    projectedVerdictImpact: number;
  };
  workflows: LedgerWorkflowJson[];
  meetingsAttributionSplit: { agent: number; human: number };
  dispute: {
    claimed: number;
    reopenedWithin7Days: number;
    adjustment: number;
    billedPerResolution: number;
    fairPrice: number;
    incrementalityPct: number;
    renegotiationDeltaPerResolution: number;
  };
  connect: { runs: number; windowDays: number; jiraJoinablePct: number };
  activityRuns: Record<string, number>;
  discoveredFigures: { stripeRefunds: number; lateReopenPct: number; jiraRejections: number };
  benchmark: { yourCostPerResolvedTicket: number };
}

let statementCache: LedgerStatement | null = null;

export function runMeridian(): LedgerStatement {
  if (!statementCache) {
    statementCache = runStatement(generateMeridianInputs(), MERIDIAN_CONFIG);
  }
  return statementCache;
}

const PRIOR_CENTS: Record<string, readonly number[]> = {
  support: CELLS.support.priorCostPerVerifiedCents,
  workspace: CELLS.workspace.priorCostPerVerifiedCents,
  docgen: CELLS.docgen.priorCostPerVerifiedCents,
  meetings: CELLS.meetings.priorCostPerVerifiedCents,
};

function toWorkflowJson(w: WorkflowStatement): LedgerWorkflowJson {
  const prior = PRIOR_CENTS[w.workflowId];
  if (!prior) throw new EngineError("ledger", `no prior-period series for ${w.workflowId}`);
  return {
    id: w.workflowId,
    claimed: w.claimed,
    verified: w.verified,
    attributable: w.attributable,
    spend: centsToDollars(w.spendCents),
    costPerVerified: centsToDollars(w.costPerVerifiedCents),
    grade: w.estimator.grade,
    verdict: w.verdict.verdict,
    impactPerMonth: w.verdict.impactPerMonthDollars,
    qualityPassPct: w.qualityPassPct,
    incrementalityPct: R4_pct(w.attributable, w.verified),
    // R5: both operands are already-rounded cents.
    deltaVsMay: (w.costPerVerifiedCents - prior[prior.length - 1]) / 100,
    sparkline: [...prior, w.costPerVerifiedCents].map(centsToDollars),
    modelSplit: w.modelSplit?.map((m) => ({
      model: m.model,
      costPerVerified: centsToDollars(m.marginalCostPerVerifiedCents),
      share: m.share,
    })),
  };
}

export function buildMeridianLedgerJson(): MeridianLedgerJson {
  const s = runMeridian();
  const byId = new Map(s.workflows.map((w) => [w.workflowId, w]));
  const support = byId.get("support");
  const docgen = byId.get("docgen");
  const meetings = byId.get("meetings");
  if (!support?.dispute || !support.modelSplit || !docgen || !meetings?.actorSplit) {
    throw new EngineError("ledger", "Meridian statement is missing support dispute, model split, or meetings actor split");
  }

  const boundary = s.candidates.find((c) => c.kind === "qualityBarBoundary" && c.source === "zendesk");
  const uncounted = s.candidates.find((c) => c.kind === "unpricedQualityFailures" && c.source === "jira");
  const refunds = s.candidates.find((c) => c.kind === "uncontractedOutcome" && c.source === "stripe");
  if (!boundary || boundary.pctOfVerified === undefined || !uncounted || !refunds) {
    throw new EngineError("ledger", "expected candidates (late reopens, uncounted rejections, refunds) not all found");
  }

  return {
    engineVersion: s.engineVersion,
    replay: { inputHash: s.replay.inputHash, configHash: s.replay.configHash },
    headers: {
      claimed: s.headers.claimed,
      verified: s.headers.verified,
      attributable: s.headers.attributable,
      spend: centsToDollars(s.headers.spendCents),
      adjustmentIdentified: centsToDollars(s.headers.adjustmentCents),
      projectedVerdictImpact: s.headers.projectedVerdictImpactDollars,
    },
    workflows: s.workflows.map(toWorkflowJson),
    meetingsAttributionSplit: { agent: meetings.actorSplit.agent, human: meetings.actorSplit.human },
    dispute: {
      claimed: support.dispute.claimed,
      // The specific reason, not the failure total — other reasons must never
      // inflate the published "reopened within 7 days" figure.
      reopenedWithin7Days: support.dispute.qualityFailuresByReason["ticket_reopened_within_7d"] ?? 0,
      adjustment: centsToDollars(support.dispute.adjustmentCents),
      billedPerResolution: centsToDollars(support.dispute.billedPerOutcomeCents),
      fairPrice: centsToDollars(support.dispute.fairPriceCents),
      incrementalityPct: support.dispute.incrementalityPct,
      renegotiationDeltaPerResolution: centsToDollars(support.dispute.deltaPerOutcomeCents),
    },
    connect: { runs: s.totalRuns, windowDays: 30, jiraJoinablePct: docgen.coverage.runKeyPct },
    activityRuns: {
      LangSmith: s.activityRunsBySource["LangSmith"],
      Langfuse: s.activityRunsBySource["Langfuse"],
      OpenTelemetry: s.activityRunsBySource["OpenTelemetry"],
      "Log upload": s.activityRunsBySource["Log upload"],
    },
    discoveredFigures: {
      stripeRefunds: refunds.count,
      lateReopenPct: boundary.pctOfVerified,
      jiraRejections: uncounted.count,
    },
    benchmark: {
      // The dominant model's marginal cost per verified outcome — the
      // benchmark compares by-model unit costs (cost-per-outcome-by-model is
      // the doctrine's native primitive, CAUSA.md §6.4), not the blended row
      // rate, which for a BOUGHT workflow also carries the vendor's margin
      // and failed-claim billing.
      yourCostPerResolvedTicket: centsToDollars(support.modelSplit[0].marginalCostPerVerifiedCents),
    },
  };
}

/** The golden gate: every published figure must fall out of the pipeline. */
export function assertMatchesPublished(ledger: MeridianLedgerJson): void {
  const fail = (msg: string) => {
    throw new EngineError("golden", msg);
  };
  const eq = (label: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) fail(`${label}: engine produced ${actual}, published ledger says ${expected}`);
  };

  const H = PUBLISHED.headers;
  eq("headers.claimed", ledger.headers.claimed, H.claimed);
  eq("headers.verified", ledger.headers.verified, H.verified);
  eq("headers.attributable", ledger.headers.attributable, H.attributable);
  eq("headers.spend", ledger.headers.spend, H.spend);
  eq("headers.adjustmentIdentified", ledger.headers.adjustmentIdentified, H.adjustmentIdentified);
  eq("headers.projectedVerdictImpact", ledger.headers.projectedVerdictImpact, H.projectedVerdictImpact);

  for (const [id, pub] of Object.entries(PUBLISHED.workflows)) {
    const w = ledger.workflows.find((x) => x.id === id);
    if (!w) return fail(`workflow ${id} missing from engine output`);
    eq(`${id}.claimed`, w.claimed, pub.claimed);
    eq(`${id}.verified`, w.verified, pub.verified);
    eq(`${id}.attributable`, w.attributable, pub.attributable);
    eq(`${id}.spend`, w.spend, pub.spend);
    eq(`${id}.costPerVerified`, w.costPerVerified, pub.costPerVerified);
    eq(`${id}.grade`, w.grade, pub.grade);
    eq(`${id}.verdict`, w.verdict, pub.verdict);
    eq(`${id}.impactPerMonth`, w.impactPerMonth, pub.impactPerMonth);
    eq(`${id}.qualityPassPct`, w.qualityPassPct, pub.qualityPassPct);
    eq(`${id}.deltaVsMay`, w.deltaVsMay, pub.deltaVsMay);
    eq(`${id}.incrementalityPct`, w.incrementalityPct, pub.incrementalityPct);
    const pubSplit = "modelSplit" in pub ? pub.modelSplit : undefined;
    if (pubSplit) {
      if (!w.modelSplit) return fail(`${id}.modelSplit missing`);
      eq(`${id}.modelSplit.length`, w.modelSplit.length, pubSplit.length);
      pubSplit.forEach((m, i) => {
        eq(`${id}.modelSplit[${i}].model`, w.modelSplit![i].model, m.model);
        eq(`${id}.modelSplit[${i}].costPerVerified`, w.modelSplit![i].costPerVerified, m.costPerVerified);
        eq(`${id}.modelSplit[${i}].share`, w.modelSplit![i].share, m.share);
      });
    } else if (w.modelSplit) {
      fail(`${id}.modelSplit: engine produced a split the published ledger does not have`);
    }
  }

  const D = PUBLISHED.dispute;
  eq("dispute.claimed", ledger.dispute.claimed, D.claimed);
  eq("dispute.reopenedWithin7Days", ledger.dispute.reopenedWithin7Days, D.reopenedWithin7Days);
  eq("dispute.adjustment", ledger.dispute.adjustment, D.adjustment);
  eq("dispute.billedPerResolution", ledger.dispute.billedPerResolution, D.billedPerResolution);
  eq("dispute.fairPrice", ledger.dispute.fairPrice, D.fairPrice);
  eq("dispute.incrementalityPct", ledger.dispute.incrementalityPct, D.incrementalityPct);
  eq("dispute.renegotiationDelta", ledger.dispute.renegotiationDeltaPerResolution, D.renegotiationDeltaPerResolution);

  eq("meetingsSplit.agent", ledger.meetingsAttributionSplit.agent, PUBLISHED.meetingsAttributionSplit.agent);
  eq("meetingsSplit.human", ledger.meetingsAttributionSplit.human, PUBLISHED.meetingsAttributionSplit.human);

  eq("connect.runs", ledger.connect.runs, PUBLISHED.connect.runs);
  eq("connect.jiraJoinablePct", ledger.connect.jiraJoinablePct, PUBLISHED.connect.jiraJoinablePct);
  for (const [label, count] of Object.entries(PUBLISHED.activityRuns)) {
    eq(`activityRuns.${label}`, ledger.activityRuns[label], count);
  }

  eq("discoveries.stripeRefunds", ledger.discoveredFigures.stripeRefunds, PUBLISHED.discoveredFigures.stripeRefunds);
  eq("discoveries.lateReopenPct", ledger.discoveredFigures.lateReopenPct, PUBLISHED.discoveredFigures.lateReopenPct);
  eq("discoveries.jiraRejections", ledger.discoveredFigures.jiraRejections, PUBLISHED.discoveredFigures.jiraRejections);
  eq("benchmark.yourCost", ledger.benchmark.yourCostPerResolvedTicket, PUBLISHED.benchmark.yourCostPerResolvedTicket);
}
