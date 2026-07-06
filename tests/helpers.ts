/** Micro-world builders for estimator/verify tests — tiny, hand-computable cases. */
import type { Actor, ActivityRun, OutcomeContract, OutcomeEvent } from "@/src/types";
import type { ExtractRuleSet } from "@/src/extract/extractors";
import { buildGraph, buildOutcomeIndex } from "@/src/join/graph";
import { verifyClaims } from "@/src/verify/verify";

export const T0 = Date.parse("2026-06-01T00:00:00.000Z");
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const iso = (ms: number) => new Date(ms).toISOString();

export const AGENT: Actor = { id: "agent-1", class: "agent", name: "Agent" };
export const HUMAN: Actor = { id: "human-1", class: "human", name: "Human" };

export const TICKET_RULES: ExtractRuleSet = {
  id: "test-keys",
  rules: [{ from: "field", field: "ticket_id", entityKind: "ticket" }],
};

export function makeContract(overrides: Partial<OutcomeContract> = {}): OutcomeContract {
  return {
    id: "test-contract",
    workflowId: "wf",
    event: { source: "zendesk", eventType: "resolved" },
    qualityBar: { kind: "noEventWithin", eventType: "reopened", days: 7 },
    counterfactual: { kind: "rules", wouldHaveHappenedAnyway: { op: "or", of: [] } },
    join: { entityKind: "ticket", extractorRuleSetId: "test-keys" },
    billing: { kind: "perOutcome", rateCents: 100 },
    windowDays: 30,
    actorIds: [AGENT.id],
    declaredEventTypes: ["created", "resolved", "reopened"],
    ...overrides,
  };
}

let seq = 0;
export function claimRun(ticketId: string | null, startMs: number, opts: Partial<ActivityRun> = {}): ActivityRun {
  return {
    id: `r-${++seq}`,
    source: "langsmith",
    actorId: AGENT.id,
    startedAt: iso(startMs),
    endedAt: iso(startMs + 5 * 60_000),
    costCents: 10,
    payload: ticketId === null ? { text: "no key logged" } : { fields: { ticket_id: ticketId } },
    claim: { workflowId: "wf", claimedEventType: "resolved", claimedAt: iso(startMs) },
    ...opts,
  };
}

export function touchRun(actorId: string, ticketId: string, startMs: number): ActivityRun {
  return {
    id: `r-${++seq}`,
    source: "log_upload",
    actorId,
    startedAt: iso(startMs),
    endedAt: iso(startMs + 5 * 60_000),
    costCents: 0,
    payload: { fields: { ticket_id: ticketId } },
  };
}

export function ev(
  ticketId: string,
  eventType: string,
  atMs: number,
  assignment?: { experimentId: string; arm: string }
): OutcomeEvent {
  return {
    id: `e-${++seq}`,
    source: "zendesk",
    entity: { kind: "ticket", id: ticketId },
    eventType,
    occurredAt: iso(atMs),
    assignment,
  };
}

export function world(contract: OutcomeContract, runs: ActivityRun[], outcomes: OutcomeEvent[], actors: Actor[] = [AGENT, HUMAN]) {
  const graph = buildGraph(contract, runs, buildOutcomeIndex(outcomes), TICKET_RULES, actors);
  const report = verifyClaims(graph);
  return { graph, report };
}
