/**
 * Preflight — the doctrine's promise made mechanical (CAUSA.md §6.5): before
 * anything settles, tell the customer what is verifiable with what they've
 * connected and the evidence-grade ceiling it implies. Runs the join, counts
 * what lands, and checks each counterfactual design's data — without settling.
 */
import { buildGraph, buildOutcomeIndex, type OutcomeIndex } from "../join/graph";
import { computeCoverage } from "../join/coverage";
import type { EngineConfig } from "../statement";
import type { CounterfactualDesign, EngineInputs, Grade, OutcomeContract } from "../types";
import { EngineError } from "../types";

interface DesignCheck {
  kind: CounterfactualDesign["kind"];
  grade: Grade;
  ready: boolean;
  missing?: string;
}

export interface ContractPreflight {
  workflowId: string;
  runsTotal: number;
  runsWithKey: number;
  runKeyPct: number;
  claims: number;
  joinableClaims: number;
  contractEvents: number;
  designs: DesignCheck[];
  gradeCeiling: Grade;
  verifiable: boolean;
  notes: string[];
}

export interface PreflightReport {
  contracts: ContractPreflight[];
}

const DESIGN_GRADE: Record<CounterfactualDesign["kind"], Grade> = {
  holdout: "A",
  naturalExperiment: "B",
  preAgentBaseline: "C",
  rules: "D",
};

function armReady(index: OutcomeIndex, experimentId: string, arm: string): boolean {
  return (index.entityArms.get(experimentId)?.get(arm)?.size ?? 0) > 0;
}

function checkDesign(index: OutcomeIndex, design: CounterfactualDesign): DesignCheck {
  const base = { kind: design.kind, grade: DESIGN_GRADE[design.kind] };
  switch (design.kind) {
    case "holdout": {
      const missing = [design.treatedArm, design.controlArm].filter((arm) => !armReady(index, design.experimentId, arm));
      return missing.length === 0
        ? { ...base, ready: true }
        : { ...base, ready: false, missing: `no recorded entities in arm(s) ${missing.join(", ")} of ${design.experimentId}` };
    }
    case "naturalExperiment": {
      if (design.form === "twoGroupRoutingGap") {
        return armReady(index, design.experimentId, design.controlArm)
          ? { ...base, ready: true }
          : { ...base, ready: false, missing: `no recorded entities in control arm of ${design.experimentId}` };
      }
      const missing: string[] = [];
      for (const slice of design.slices) {
        for (const arm of Object.values(slice.arms)) {
          if (!armReady(index, slice.experimentId, arm)) missing.push(`${slice.experimentId}/${arm}`);
        }
      }
      return missing.length === 0
        ? { ...base, ready: true }
        : { ...base, ready: false, missing: `no recorded entities in ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}` };
    }
    case "preAgentBaseline":
      return design.months.length > 0
        ? { ...base, ready: true }
        : { ...base, ready: false, missing: "no baseline months declared" };
    case "rules":
      return { ...base, ready: true };
  }
}

function preflightContract(
  contract: OutcomeContract,
  inputs: EngineInputs,
  index: OutcomeIndex,
  config: EngineConfig
): ContractPreflight {
  const ruleSet = config.extractRuleSets.find((rs) => rs.id === contract.join.extractorRuleSetId);
  if (!ruleSet) throw new EngineError("preflight", `unknown extractor rule set ${contract.join.extractorRuleSetId}`);
  const graph = buildGraph(contract, inputs.runs, index, ruleSet, inputs.actors);

  const claims = graph.workflowRuns.filter((r) => r.claim?.workflowId === contract.workflowId);
  const joinableClaims = claims.filter((r) => (graph.entityKeysByRun.get(r.id) ?? []).length > 0).length;
  const contractEvents = inputs.outcomes.filter(
    (ev) => ev.source === contract.event.source && ev.eventType === contract.event.eventType
  ).length;

  const designs = [contract.counterfactual, ...(contract.corroboration ?? [])].map((d) => checkDesign(index, d));
  const firstReady = designs.find((d) => d.ready);
  const gradeCeiling: Grade = firstReady ? firstReady.grade : "D";

  const coverage = computeCoverage(graph, joinableClaims, claims.length);
  const notes: string[] = [];
  if (claims.length === 0) notes.push("No claims found — check the claim mapping (claim.when filter, workflowId).");
  if (contractEvents === 0) notes.push(`No ${contract.event.eventType} events found in ${contract.event.source} — the contract cannot verify.`);
  if (joinableClaims < claims.length) {
    notes.push(`${claims.length - joinableClaims} of ${claims.length} claims carry no extractable join key — they will settle as unjoinable.`);
  }
  for (const d of designs.filter((x) => !x.ready)) {
    notes.push(`${d.kind} (Grade ${d.grade}) cannot run: ${d.missing}.`);
  }

  return {
    workflowId: contract.workflowId,
    runsTotal: coverage.runsTotal,
    runsWithKey: coverage.runsWithKey,
    runKeyPct: coverage.runKeyPct,
    claims: claims.length,
    joinableClaims,
    contractEvents,
    designs,
    gradeCeiling,
    verifiable: claims.length > 0 && contractEvents > 0 && joinableClaims > 0,
    notes,
  };
}

export function preflight(inputs: EngineInputs, config: EngineConfig): PreflightReport {
  const index = buildOutcomeIndex(inputs.outcomes);
  return { contracts: config.contracts.map((c) => preflightContract(c, inputs, index, config)) };
}

export function renderPreflight(report: PreflightReport): string {
  const lines: string[] = [];
  lines.push(`# Preflight — what's verifiable with what's connected`);
  lines.push("");
  for (const c of report.contracts) {
    lines.push(`## ${c.workflowId}`);
    lines.push(`- Verifiable: ${c.verifiable ? "YES" : "NO"} · evidence-grade ceiling: **${c.gradeCeiling}**`);
    lines.push(`- Activity: ${c.runsTotal} runs, ${c.runsWithKey} with a join key (${c.runKeyPct}%)`);
    lines.push(`- Claims: ${c.claims} (${c.joinableClaims} joinable) · contract events found: ${c.contractEvents}`);
    for (const d of c.designs) {
      lines.push(`- Design ${d.kind} (Grade ${d.grade}): ${d.ready ? "ready" : `NOT READY — ${d.missing}`}`);
    }
    for (const n of c.notes) lines.push(`- Note: ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}
