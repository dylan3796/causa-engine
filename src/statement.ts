/**
 * The orchestrator — the composition of the two engines:
 *
 *   OUTCOME ENGINE   extract → join → verify   (identify contracted outcomes,
 *                    then INTERPRET candidates the customer never defined)
 *   CAUSAL ENGINE    estimate → economics → verdict   (baseline always
 *                    measured, counterfactuals settled, verdict stamped)
 *
 * Each stage is a pure function of (records, config). The output is one
 * settled statement: the Claimed → Verified → Attributable funnel per
 * workflow, evidence attached, verdict stamped, replayable — plus the outcome
 * engine's proposed candidates awaiting confirmation.
 */
import type { ExtractRuleSet } from "./extract/extractors";
import { buildGraph, buildOutcomeIndex } from "./join/graph";
import { actorSplit } from "./join/contribution";
import { computeShapleyCredit } from "./join/shapley";
import { computeCoverage } from "./join/coverage";
import { verifyClaims } from "./verify/verify";
import { runIntegrity } from "./verify/integrity";
import { interpretCandidates, type IdentifiedWorkflow } from "./outcomes/identify";
import { estimate } from "./causal/estimator";
import { computeDispute, computeEconomics } from "./economics";
import type { VerdictRule } from "./verdict/engine";
import { decideVerdict } from "./verdict/engine";
import { hashValue } from "./hash";
import { ENGINE_VERSION } from "./version";
import type {
  EngineInputs,
  LedgerStatement,
  OutcomeContract,
  ReplayRecord,
  SourceId,
  WorkflowStatement,
} from "./types";
import { EngineError } from "./types";

export interface EngineConfig {
  contracts: OutcomeContract[];
  extractRuleSets: ExtractRuleSet[];
  verdictRules: VerdictRule[];
  /** Display labels for activity sources, e.g. langsmith → "LangSmith". */
  activitySourceLabels: Partial<Record<SourceId, string>>;
  /** Widened window for quality-bar boundary interpretation (candidates). */
  boundaryWindowDays: number;
}

export function runStatement(inputs: EngineInputs, config: EngineConfig): LedgerStatement {
  const replay: ReplayRecord = {
    inputHash: hashValue({ actors: inputs.actors, runs: inputs.runs, outcomes: inputs.outcomes }),
    configHash: hashValue(config),
    engineVersion: ENGINE_VERSION,
  };

  const ruleSetById = new Map(config.extractRuleSets.map((rs) => [rs.id, rs]));

  // Contract-independent indexes over the outcome records, built once.
  const outcomeIndex = buildOutcomeIndex(inputs.outcomes);

  const workflows: WorkflowStatement[] = [];
  const identified: IdentifiedWorkflow[] = [];

  for (const contract of config.contracts) {
    const ruleSet = ruleSetById.get(contract.join.extractorRuleSetId);
    if (!ruleSet) throw new EngineError("extract", `unknown extractor rule set ${contract.join.extractorRuleSetId}`);

    // Outcome engine: join the records, identify contracted outcomes.
    const graph = buildGraph(contract, inputs.runs, outcomeIndex, ruleSet, inputs.actors);
    const report = verifyClaims(graph);

    // Causal engine: baseline ladder (always measured), economics, verdict.
    const estimatorResult = estimate(graph, report);
    const economics = computeEconomics(contract, report, graph.workflowRuns);
    const dispute = computeDispute(contract, report, estimatorResult);
    const verdict = decideVerdict(config.verdictRules, { contract, report, estimator: estimatorResult, economics, dispute }, replay);

    identified.push({ graph, report, dispute });

    const verified = report.verified.length;
    if (!(report.claimed >= verified && verified >= estimatorResult.attributable)) {
      throw new EngineError(
        "statement",
        `${contract.workflowId}: claimed ≥ verified ≥ attributable violated (${report.claimed}/${verified}/${estimatorResult.attributable})`
      );
    }

    workflows.push({
      workflowId: contract.workflowId,
      claimed: report.claimed,
      verified,
      attributable: estimatorResult.attributable,
      drop: report.drop,
      qualityFailures: report.qualityFailures,
      qualityPassPct: report.qualityPassPct,
      spendCents: economics.spendCents,
      costPerVerifiedCents: economics.costPerVerifiedCents,
      modelSplit: economics.modelSplit,
      actorSplit: actorSplit(graph, report.verified),
      actorShapley:
        contract.credit?.rule === "shapley-coalition-v1"
          ? computeShapleyCredit(graph, verified, contract.credit.maxActors)
          : undefined,
      estimator: estimatorResult,
      verdict,
      coverage: computeCoverage(graph, report.claimed - report.drop.unjoinable, report.claimed),
      dispute,
      integrity: runIntegrity(graph, report),
    });
  }

  // Outcome engine, interpretation stage: propose what nobody defined.
  const candidates = interpretCandidates(identified, config.boundaryWindowDays);

  const activityRunsBySource: Record<string, number> = {};
  for (const run of inputs.runs) {
    const label = config.activitySourceLabels[run.source];
    if (!label) throw new EngineError("statement", `activity run ${run.id} has unlabeled source ${run.source}`);
    activityRunsBySource[label] = (activityRunsBySource[label] ?? 0) + 1;
  }

  const sum = (pick: (w: WorkflowStatement) => number) => workflows.reduce((acc, w) => acc + pick(w), 0);
  return {
    engineVersion: ENGINE_VERSION,
    replay,
    headers: {
      claimed: sum((w) => w.claimed),
      verified: sum((w) => w.verified),
      attributable: sum((w) => w.attributable),
      spendCents: sum((w) => w.spendCents),
      adjustmentCents: sum((w) => w.dispute?.adjustmentCents ?? 0),
      projectedVerdictImpactDollars: sum((w) => w.verdict.impactPerMonthDollars),
    },
    workflows,
    candidates,
    activityRunsBySource,
    totalRuns: inputs.runs.length,
  };
}
