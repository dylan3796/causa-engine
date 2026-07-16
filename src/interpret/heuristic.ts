/**
 * heuristic-v1 — the deterministic reference interpreter. It answers the
 * same requests an LLM adapter would, from the same evidence, with rules
 * simple enough to defend line by line:
 *
 *   - actor roster: everything that ran is an agent until a human says
 *     otherwise (humans cannot be inferred from activity exports);
 *   - outcome definition: adopt each agent's highest-volume joined output;
 *   - quality bar: a co-occurring event type on the same entity whose name
 *     is in the negation lexicon (reopened, refunded, churned, …) negates
 *     the outcome within 7 days.
 *
 * Because it is deterministic and pure, it runs everywhere the engine runs —
 * including the browser playground — and it is the floor an LLM interpreter
 * has to beat, not a mock.
 */
import type { Actor, OutcomeContract } from "../types";
import type { ObservatoryReport } from "../outcomes/observatory";
import {
  INTERPRETED_RULESET_ID,
  type InterpretationProposal,
  type InterpretationRequest,
} from "./protocol";

export const HEURISTIC_INTERPRETER = { name: "heuristic-v1" };

/** Event-type vocabulary that negates an outcome when seen on the same entity. */
export const NEGATION_LEXICON = [
  "reopened",
  "reopen",
  "returned",
  "refunded",
  "refund",
  "churned",
  "bounced",
  "rejected",
  "reverted",
  "canceled",
  "cancelled",
  "disputed",
  "chargeback",
  "escalated",
] as const;

const slugId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function interpretHeuristically(
  requests: InterpretationRequest[],
  observatory: ObservatoryReport
): InterpretationProposal[] {
  const proposals: InterpretationProposal[] = [];

  for (const req of requests) {
    if (req.kind === "actorRoster") {
      const actors: Actor[] = observatory.agents.map((a) => ({
        id: a.actorId,
        class: "agent",
        name: a.actorId,
      }));
      proposals.push({
        requestId: req.id,
        interpreter: HEURISTIC_INTERPRETER,
        confidence: "medium",
        rationale: [
          "Every id that produced activity runs is rostered as an agent — humans cannot be inferred from activity exports and must be added manually.",
        ],
        payload: { kind: "actors", actors },
      });
      continue;
    }

    if (req.kind !== "outcomeDefinition" || !req.subject) continue;
    const { actorId, source, eventType, entityKind } = req.subject;
    const agent = observatory.agents.find((a) => a.actorId === actorId);
    if (!agent) continue;
    const joinKey = observatory.joinKeys
      .filter((jk) => jk.entityKind === entityKind)
      .sort((a, b) => b.matchPct - a.matchPct || (a.field < b.field ? -1 : 1))[0];
    if (!joinKey) continue;

    // Negation: a co-occurring event type on the same entity kind whose name
    // hits the lexicon. Deterministic pick: highest count, then lexicographic.
    const negation = agent.outputs
      .filter(
        (o) =>
          o.entityKind === entityKind &&
          o.eventType !== eventType &&
          NEGATION_LEXICON.some((n) => o.eventType.toLowerCase().includes(n))
      )
      .sort((a, b) => b.count - a.count || (a.eventType < b.eventType ? -1 : 1))[0];

    const contract: OutcomeContract = {
      id: `interpreted-${slugId(actorId)}-${slugId(eventType)}`,
      workflowId: actorId,
      event: { source, eventType },
      qualityBar: negation ? { kind: "noEventWithin", eventType: negation.eventType, days: 7 } : null,
      counterfactual: { kind: "rules", wouldHaveHappenedAnyway: { op: "or", of: [] } },
      join: { entityKind, extractorRuleSetId: INTERPRETED_RULESET_ID },
      billing: { kind: "usage" },
      windowDays: observatory.windowDays,
      actorIds: [actorId],
      declaredEventTypes: [eventType, ...(negation ? [negation.eventType] : [])],
    };

    proposals.push({
      requestId: req.id,
      interpreter: HEURISTIC_INTERPRETER,
      confidence: negation ? "medium" : "high",
      rationale: [
        `Highest-volume joined output for ${actorId}: ${eventType} in ${source} on ${entityKind} (join field "${joinKey.field}", ${joinKey.matchPct}% match).`,
        negation
          ? `Quality bar proposed: "${negation.eventType}" (${negation.count} observed on the same entities) reads as negating the outcome within 7 days — confirm the window with the customer.`
          : `No co-occurring event type on ${entityKind} matches the negation lexicon — no quality bar proposed; define one with the customer if outcomes can regress.`,
        "Counterfactual: Grade-D rules floor (nothing assumed away). Billing: usage until priced by humans.",
      ],
      payload: { kind: "contract", contract, joinField: joinKey.field },
    });
  }

  return proposals;
}
