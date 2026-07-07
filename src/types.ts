/**
 * Canonical data model for the attribution core.
 *
 * The data contract floor (CAUSA.md §6.5): per workflow, verification needs
 * exactly three things — activity records (who/what ran, when), outcome
 * records (what happened to which entity, per the quality bar), and the join
 * key linking them. Join keys are deliberately NOT first-class on activity
 * records: they hide in semi-structured payloads and are mined by extraction
 * rules. Outcome events natively know their entity.
 *
 * Contracts, experiment designs, extraction rules, and verdict rules are all
 * serializable data; only their small interpreters are code. Replay =
 * (records hash, config hash, engine version).
 */
import type { Predicate } from "./predicates";

/* ---------------------------------- identity --------------------------------- */

/**
 * A source system identifier (lowercase token, e.g. "zendesk", "netsuite").
 * Real organizations run systems we haven't named — the engine accepts any
 * well-formed token; the list below is the KNOWN vocabulary, not a gate.
 */
export type SourceId = string;

export const KNOWN_SOURCE_IDS: readonly string[] = [
  "langsmith",
  "langfuse",
  "otel",
  "log_upload",
  "zendesk",
  "salesforce",
  "jira",
  "servicenow",
  "stripe",
  "gdrive",
];

export type ActorClass = "agent" | "human";

export interface Actor {
  id: string;
  class: ActorClass;
  name: string;
  vendor?: string;
}

export interface EntityRef {
  kind: string; // e.g. "zendesk_ticket", "sf_prospect", "jira_issue"
  id: string;
}

export const entityKey = (e: EntityRef): string => `${e.kind}:${e.id}`;

/* --------------------------------- activity ---------------------------------- */

export interface ToolCall {
  name: string;
  argsJson: string;
}

export interface ActivityRun {
  id: string;
  source: SourceId;
  actorId: string;
  /** Recorded attribute of every run (CAUSA.md §6.4) — cost-per-outcome-by-model is a native primitive. */
  model?: string;
  startedAt: string; // ISO 8601 — the engine never reads a clock
  endedAt: string;
  costCents: number;
  /** Join keys hide in here; extraction rules mine them. */
  payload: {
    toolCalls?: ToolCall[];
    text?: string;
    fields?: Record<string, string>;
  };
  /** A claim: the run (or vendor invoice line) asserting an outcome. Most runs are non-claiming steps. */
  claim?: {
    workflowId: string;
    claimedEventType: string;
    claimedAt: string;
  };
}

/* --------------------------------- outcomes ---------------------------------- */

export interface OutcomeEvent {
  id: string;
  source: SourceId;
  entity: EntityRef;
  eventType: string;
  occurredAt: string;
  fields?: Record<string, string | number>;
  /** Recorded experiment metadata — the engine READS assignments, never randomizes. */
  assignment?: { experimentId: string; arm: string };
}

/* --------------------------- the outcome contract ---------------------------- */

/** Quality bar, evaluated over an entity's full event timeline. Windows are half-open: [t, t + N). */
export type QualityPredicate =
  | { kind: "noEventWithin"; eventType: string; days: number }
  | { kind: "eventWithin"; eventType: string; hours: number }
  | { kind: "requireEvent"; eventType: string }
  | { kind: "noEventOfType"; eventType: string }
  | { kind: "all"; of: QualityPredicate[] };

export type SliceId = "agent_only" | "assisted" | "human_only";

export interface MonthlySummary {
  month: string; // "2025-06"
  volume: number;
  costPerOutcomeCents: number;
}

export type CounterfactualDesign =
  /** Grade A: a reserved slice the agents never touch, assignment recorded per unit. */
  | { kind: "holdout"; experimentId: string; treatedArm: string; controlArm: string }
  /** Grade B: staged rollout — additive difference-in-differences per slice over pod × period cells. */
  | {
      kind: "naturalExperiment";
      form: "didStagedRollout";
      slices: Array<{
        slice: SliceId;
        experimentId: string;
        arms: { treatedPre: string; controlPre: string; controlPost: string; treatedPost: string };
      }>;
    }
  /** Grade B: a recorded routing change left a slice uncovered — its outcome rate projects the counterfactual. */
  | { kind: "naturalExperiment"; form: "twoGroupRoutingGap"; experimentId: string; controlArm: string }
  /** Grade C: matched pre-agent monthly baseline (declared aggregates, honestly labeled). */
  | {
      kind: "preAgentBaseline";
      basis: "displacement" | "occurrence";
      months: MonthlySummary[];
      match: { volumeTolerancePct: number; minMonths: number };
      seasonality: { comparisonMonth: string; maxDivergencePct: number };
    }
  /** Grade D: rule-based counterfactual over per-outcome metrics. Where every engagement starts. */
  | { kind: "rules"; wouldHaveHappenedAnyway: Predicate };

export type BillingConfig =
  | { kind: "perOutcome"; rateCents: number }
  | { kind: "flatMonthly"; feeCents: number }
  | { kind: "usage" };

export interface JoinSpec {
  entityKind: string;
  extractorRuleSetId: string;
}

export interface OutcomeContract {
  id: string;
  workflowId: string;
  /** What has to happen — the event, in a system already trusted. */
  event: { source: SourceId; eventType: string };
  /** What makes it count. */
  qualityBar: QualityPredicate | null;
  /** Would it have happened anyway. */
  counterfactual: CounterfactualDesign;
  /**
   * Additional baseline designs, always measured when their data exists:
   * they corroborate the primary estimate on the statement, and they are the
   * fallback ladder when the primary design's data is missing — a statement
   * never ships without a measured baseline.
   */
  corroboration?: CounterfactualDesign[];
  join: JoinSpec;
  billing: BillingConfig;
  /** Max run→outcome lag for the join, days. */
  windowDays: number;
  /** The workflow's known actors; agent-class runs by these actors define run-side coverage. */
  actorIds: string[];
  /**
   * Event types this contract already accounts for (unit/assignment carriers,
   * quality events). Joined events OUTSIDE every contract's set surface as
   * discovered outcomes.
   */
  declaredEventTypes: string[];
  /** Optional model-switch companion experiment: quality parity + marginal cost per arm (feeds REROUTE). */
  modelSwitchCompanion?: { incumbentModel: string; altModel: string };
  /** Optional expansion parameters (feeds EXPAND's projected impact). */
  expand?: { adjacentVolume: number; adjacentBaselineCostCents: number };
}

/* ------------------------------ engine outputs ------------------------------- */

export type Grade = "A" | "B" | "C" | "D";
export type VerdictKind = "REPRICE" | "RENEGOTIATE" | "EXPAND" | "REROUTE" | "RETIRE";

export interface ReplayRecord {
  inputHash: string;
  configHash: string;
  engineVersion: string;
}

export interface VerifiedOutcome {
  claimRunId: string;
  actorId: string;
  model?: string;
  entityKey: string;
  outcomeEventId: string;
  occurredAt: string;
  slice: SliceId;
}

export interface VerificationReport {
  workflowId: string;
  claimed: number;
  verified: VerifiedOutcome[];
  drop: {
    didNotHappen: number;
    failedQualityBar: number;
    unjoinable: number;
    /** A claim asserting an outcome already settled by an earlier claim — a double-bill, not a miss. */
    duplicateClaim: number;
  };
  /** Quality-bar failures by reason, e.g. { ticket_reopened_within_7d: 61 }. */
  qualityFailures: Record<string, number>;
  /** Up to five failing entities per reason — evidence the customer can check in the source system. */
  qualityFailureSamples?: Record<string, string[]>;
  /** Up to five double-billed entities. */
  duplicateSamples?: string[];
  qualityPassPct: number;
}

export interface CellCount {
  n: number;
  k: number;
}

export interface SliceEstimate {
  slice: SliceId;
  verified: number;
  /** R1-rounded integer counterfactual for the slice (clamped at 0). */
  counterfactual: number;
  attributable: number;
  /** Unrounded point delta verified − expected; negative values drive RETIRE. */
  pointDelta: number;
  cells: Record<string, CellCount>;
}

export interface EstimatorResult {
  grade: Grade;
  designKind: "holdout" | "naturalExperiment" | "preAgentBaseline" | "rules";
  /** Integer count of verified outcomes that would have happened anyway (post-clamp, funnel-consistent). */
  counterfactualCount: number;
  attributable: number;
  /** Exact rational: attributable / verified. */
  incrementality: { num: number; den: number };
  interval?: { lo: number; hi: number; level: 0.95; method: "wilson-newcombe" };
  perSlice?: SliceEstimate[];
  /** Declared, from the design — the "evidence attached" doctrine. */
  assumptions: string[];
  cells: Record<string, CellCount>;
  notes: string[];
  /** Grade C: matched-baseline unit cost, consumed by the EXPAND verdict rule. */
  baselineCostPerOutcomeCents?: number;
  /** Every other baseline design that could run — measured and attached, never averaged in. */
  corroboration?: CorroborationResult[];
}

export type CorroborationResult = Omit<EstimatorResult, "corroboration">;

export interface ModelSplitEntry {
  model: string;
  verified: number;
  share: number; // R4, 2dp
  marginalCostPerVerifiedCents: number; // R2 over verified claiming runs
}

export interface EconomicsReport {
  spendCents: number;
  costPerVerifiedCents: number;
  modelSplit?: ModelSplitEntry[];
  /** Model-switch companion (Grade B provenance): parity + savings, feeds REROUTE. */
  modelSwitch?: {
    incumbentModel: string;
    altModel: string;
    incumbentAcceptPct: number;
    altAcceptPct: number;
    parity: boolean;
    savingsPerVerifiedCents: number;
  };
}

export interface DisputeBlock {
  claimed: number;
  qualityFailures: number;
  /** Failures by reason so specific figures (e.g. "reopened within 7 days") never absorb other reasons. */
  qualityFailuresByReason: Record<string, number>;
  adjustmentCents: number;
  billedPerOutcomeCents: number;
  fairPriceCents: number;
  incrementalityPct: number;
  deltaPerOutcomeCents: number;
}

export interface VerdictResult {
  verdict: VerdictKind;
  ruleId: string;
  impactPerMonthDollars: number;
  /** The metric snapshot the rule evaluated — the replayable inputs. */
  inputs: Record<string, number | string | boolean>;
  replay: ReplayRecord;
}

export interface CoverageReport {
  workflowId: string;
  runsTotal: number;
  runsWithKey: number;
  runKeyPct: number;
  claimsTotal: number;
  claimsJoined: number;
}

export interface WorkflowStatement {
  workflowId: string;
  claimed: number;
  verified: number;
  attributable: number;
  drop: VerificationReport["drop"];
  qualityFailures: Record<string, number>;
  qualityPassPct: number;
  spendCents: number;
  costPerVerifiedCents: number;
  modelSplit?: ModelSplitEntry[];
  actorSplit?: { agent: number; human: number; rule: string; agentTouches: number; humanTouches: number };
  estimator: EstimatorResult;
  verdict: VerdictResult;
  coverage: CoverageReport;
  dispute?: DisputeBlock;
}

/**
 * A proposed outcome definition, drafted by the outcome engine for the
 * customer to confirm. Not all outcomes arrive clearly defined up front —
 * the engine interprets what the systems of record show and proposes the
 * contract; a human accepts it. Interpretation proposes; it never settles.
 */
export interface DraftContract {
  source: SourceId;
  eventType: string;
  entityKind: string;
  suggestedQualityBar: QualityPredicate | null;
}

export interface CandidateOutcome {
  kind: "uncontractedOutcome" | "qualityBarBoundary" | "unpricedQualityFailures" | "duplicateClaims";
  source: SourceId;
  eventType: string;
  count: number;
  /** The workflow whose activity surfaced this candidate. */
  workflowId?: string;
  /** For qualityBarBoundary: percent of verified affected in the widened window. */
  pctOfVerified?: number;
  /** The interpretation: a proposed contract (or contract change) to confirm. */
  draft?: DraftContract;
  /** Human-readable provenance — why the engine believes this is an outcome. */
  context: string[];
  /** Up to five example entities, so the proposal is checkable in the source system. */
  sampleEntities: string[];
  firstSeen?: string;
  lastSeen?: string;
}

export interface LedgerStatement {
  engineVersion: string;
  replay: ReplayRecord;
  headers: {
    claimed: number;
    verified: number;
    attributable: number;
    spendCents: number;
    adjustmentCents: number;
    projectedVerdictImpactDollars: number;
  };
  workflows: WorkflowStatement[];
  /** The outcome engine's interpretations: proposed outcomes awaiting confirmation. */
  candidates: CandidateOutcome[];
  activityRunsBySource: Record<string, number>;
  totalRuns: number;
}

/* --------------------------------- inputs ------------------------------------ */

export interface EngineInputs {
  periodStart: string; // inclusive, ISO
  periodEnd: string; // exclusive, ISO
  actors: Actor[];
  runs: ActivityRun[];
  outcomes: OutcomeEvent[];
}

export class EngineError extends Error {
  constructor(stage: string, message: string) {
    super(`[engine:${stage}] ${message}`);
  }
}

/**
 * A contract's counterfactual design references experiment data that simply
 * is not present (e.g. no recorded assignments). This — and only this — may
 * be downgraded to the Grade-D evidence ceiling. Integrity violations
 * (contaminated holdouts, join/design disagreement) stay fatal: a verdict
 * built on corrupted evidence must fail loudly, never degrade quietly.
 */
export class MissingDesignDataError extends EngineError {}
