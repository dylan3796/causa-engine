/**
 * Deterministic credit rules over the contribution graph. No Shapley in v1
 * (doctrine reserves Shapley-via-replay for later); credit is set logic over
 * qualifying touches, declared as an assumption on the output.
 */
import { R4_share2 } from "../numeric";
import { DAY_MS } from "../time";
import type { ContributionGraph, Touch } from "./graph";
import type { SliceId, VerifiedOutcome } from "../types";

export const CONTRIBUTION_RULE_ID = "touch-count-v1";

/** Touches that precede the outcome within the (half-open) contract window. */
export function qualifyingTouches(
  graph: ContributionGraph,
  entKey: string,
  outcomeAtMs: number
): Touch[] {
  const windowMs = graph.contract.windowDays * DAY_MS;
  return (graph.touchesByEntity.get(entKey) ?? []).filter(
    (t) => t.startedAtMs < outcomeAtMs && outcomeAtMs - t.startedAtMs < windowMs
  );
}

/** Slice assignment by set logic over touching actor classes. */
export function sliceOf(touches: Touch[]): SliceId {
  const hasAgent = touches.some((t) => t.actorClass === "agent");
  const hasHuman = touches.some((t) => t.actorClass === "human");
  if (hasAgent && hasHuman) return "assisted";
  if (hasAgent) return "agent_only";
  return "human_only";
}

/**
 * Workflow-level actor split: share of qualifying touches on verified
 * outcomes, by actor class. Emitted only when humans actually touch the work.
 */
export function actorSplit(
  graph: ContributionGraph,
  verified: VerifiedOutcome[]
): { agent: number; human: number; rule: string; agentTouches: number; humanTouches: number } | undefined {
  let agentTouches = 0;
  let humanTouches = 0;
  for (const v of verified) {
    for (const t of qualifyingTouches(graph, v.entityKey, Date.parse(v.occurredAt))) {
      if (t.actorClass === "agent") agentTouches += 1;
      else humanTouches += 1;
    }
  }
  if (humanTouches === 0) return undefined;
  const total = agentTouches + humanTouches;
  return {
    agent: R4_share2(agentTouches, total),
    human: R4_share2(humanTouches, total),
    rule: CONTRIBUTION_RULE_ID,
    agentTouches,
    humanTouches,
  };
}
