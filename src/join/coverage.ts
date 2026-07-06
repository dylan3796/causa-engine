/**
 * Joinability, stated honestly — "61% joinable is a feature" (CAUSA.md §6.2).
 * Run-side coverage: what share of the workflow's agent runs carry an
 * extractable key for the contract's entity kind.
 */
import { R4_pct } from "../numeric";
import type { ContributionGraph } from "./graph";
import type { CoverageReport } from "../types";

export function computeCoverage(graph: ContributionGraph, claimsJoined: number, claimsTotal: number): CoverageReport {
  let runsWithKey = 0;
  for (const run of graph.workflowRuns) {
    if ((graph.entityKeysByRun.get(run.id) ?? []).length > 0) runsWithKey += 1;
  }
  const runsTotal = graph.workflowRuns.length;
  return {
    workflowId: graph.contract.workflowId,
    runsTotal,
    runsWithKey,
    runKeyPct: runsTotal === 0 ? 0 : R4_pct(runsWithKey, runsTotal),
    claimsTotal,
    claimsJoined,
  };
}
