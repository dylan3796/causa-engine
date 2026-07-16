/**
 * The interpretation protocol — how undefined outcomes become contracts.
 *
 * Not all outcomes arrive clearly defined; often the engine interprets what
 * the systems of record show and proposes the definition. Doctrine
 * (CAUSA.md §6): INTERPRETATION PROPOSES; IT NEVER SETTLES. The protocol
 * encodes that as validation, not convention:
 *
 *   - a proposal can only contribute intake mappings, actor rosters, and
 *     draft contracts — never verdict rules, never pricing;
 *   - a proposed contract enters at the evidence floor: counterfactual kind
 *     "rules" (Grade D). Real designs (holdouts, rollouts, baselines) are
 *     confirmed by humans from recorded data — an interpreter asserting an
 *     experiment existed would be fabricating evidence;
 *   - billing is "usage": what an outcome is worth is a settlement term
 *     between humans, not an inference;
 *   - every proposal declares its interpreter (provenance), its confidence,
 *     and its rationale; adopted contract ids keep the "interpreted-" prefix
 *     so the statement never hides where a definition came from.
 *
 * The interpreter itself is pluggable: heuristic-v1 (deterministic, in this
 * repo, runs everywhere including the browser) or an LLM adapter (lives
 * OUTSIDE src/ — the sealed core makes no network calls, test-enforced).
 * Either way the output faces the same validation, and a human deletes what
 * they do not confirm before `causa adopt` applies the rest.
 */
import type { Actor, OutcomeContract, SourceId } from "../types";
import { EngineError } from "../types";
import type { EngagementConfig } from "../intake/build";
import type { VerdictRule } from "../verdict/engine";
import type { ObservatoryReport } from "../outcomes/observatory";

/* --------------------------------- requests ---------------------------------- */

export interface InterpretationRequest {
  id: string;
  kind: "actorRoster" | "outcomeDefinition";
  question: string;
  /** Evidence lines from the observatory — the request is self-contained. */
  context: string[];
  samples: string[];
  /** Machine-usable anchor for outcomeDefinition requests. */
  subject?: { actorId: string; source: SourceId; eventType: string; entityKind: string };
}

/* --------------------------------- proposals --------------------------------- */

/**
 * A contract proposal carries only the judgment calls: what the outcome is,
 * what negates it, which field joins it. The mechanics — claim mappings,
 * extractor rule sets, labels — are derived deterministically at adoption,
 * so an external interpreter cannot get them wrong. The Tier-0 claim posture
 * for interpreted engagements: every run of a contracted actor asserts its
 * outcome (workflowId = the actor id, resolved from the actor column), and
 * verification does the filtering. Hence contract.workflowId must be one of
 * contract.actorIds — that is what routes the claims.
 */
export interface ContractProposalPayload {
  kind: "contract";
  contract: OutcomeContract;
  /** The run payload field that joins to the contract's entity kind. */
  joinField: string;
}

export interface ActorsProposalPayload {
  kind: "actors";
  actors: Actor[];
}

export type ProposalPayload = ContractProposalPayload | ActorsProposalPayload;

export interface InterpretationProposal {
  requestId: string;
  interpreter: { name: string; model?: string };
  /** Declared by the interpreter, never computed — honesty, not statistics. */
  confidence: "high" | "medium" | "low";
  rationale: string[];
  payload: ProposalPayload;
}

/* -------------------------------- validation --------------------------------- */

/**
 * The doctrine as code. Throws on any proposal that tries to settle instead
 * of propose. Called by `causa adopt`, the playground, and the LLM adapter —
 * no interpreter output reaches an engagement without passing here.
 */
export function validateProposals(
  proposals: InterpretationProposal[],
  requests?: InterpretationRequest[]
): void {
  const requestIds = requests ? new Set(requests.map((r) => r.id)) : undefined;
  for (const [i, p] of proposals.entries()) {
    const at = `proposal ${i} (${p.requestId})`;
    if (!p.interpreter?.name) throw new EngineError("interpret", `${at}: interpreter provenance is required`);
    if (!["high", "medium", "low"].includes(p.confidence)) {
      throw new EngineError("interpret", `${at}: confidence must be declared (high|medium|low)`);
    }
    if (!Array.isArray(p.rationale) || p.rationale.length === 0) {
      throw new EngineError("interpret", `${at}: a proposal without rationale is not reviewable`);
    }
    if (requestIds && !requestIds.has(p.requestId)) {
      throw new EngineError("interpret", `${at}: references no known request`);
    }
    if (p.payload.kind === "contract") {
      const c = p.payload.contract;
      if (!c.id.startsWith("interpreted-")) {
        throw new EngineError("interpret", `${at}: interpreted contract ids must carry the "interpreted-" prefix — provenance stays visible`);
      }
      if (c.counterfactual.kind !== "rules") {
        throw new EngineError(
          "interpret",
          `${at}: interpretation enters at the evidence floor (Grade D rules). Counterfactual designs are confirmed by humans from recorded data, never proposed by an interpreter.`
        );
      }
      if (c.billing.kind !== "usage") {
        throw new EngineError("interpret", `${at}: pricing is a settlement term between humans — interpreted contracts bill as "usage"`);
      }
      if (c.corroboration !== undefined || c.modelSwitchCompanion !== undefined || c.expand !== undefined) {
        throw new EngineError("interpret", `${at}: declared aggregates and companion designs come from the customer, not the interpreter`);
      }
      if (c.actorIds.length === 0 || !c.actorIds.includes(c.workflowId)) {
        throw new EngineError("interpret", `${at}: an interpreted contract's workflowId must be one of its actorIds — that is what routes the derived claims`);
      }
      if (!p.payload.joinField) throw new EngineError("interpret", `${at}: a contract proposal must name its join field`);
    } else if (p.payload.kind === "actors") {
      if (p.payload.actors.length === 0) throw new EngineError("interpret", `${at}: empty actor roster`);
    } else {
      const never: never = p.payload;
      throw new EngineError("interpret", `${at}: unknown payload ${JSON.stringify(never)} — interpretation may only propose mappings, rosters, and draft contracts`);
    }
  }
}

/* ------------------------------ default policy ------------------------------- */

/**
 * The verdict policy adopted engagements start with, when the customer has
 * defined none. Deliberately conservative and clearly labeled: a fresh
 * interpreted contract has Grade-D evidence and unpriced billing, so the only
 * honest decisions are "nothing verifies — retire or fix the join" and
 * "evidence in hand — renegotiate terms on it". The impact both carry is the
 * spend the decision governs, not a projected saving nobody measured.
 */
export const TIER0_DEFAULT_VERDICT_RULES: VerdictRule[] = [
  {
    id: "tier0-retire-nothing-verified",
    verdict: "RETIRE",
    priority: 1,
    when: { op: "cmp", metric: "qualityPassPct", cmp: "eq", value: 0 },
    impact: { kind: "spendAtStake" },
  },
  {
    id: "tier0-renegotiate-on-floor-evidence",
    verdict: "RENEGOTIATE",
    priority: 99,
    when: { op: "exists", metric: "qualityPassPct" },
    impact: { kind: "spendAtStake" },
  },
];

export const INTERPRETED_RULESET_ID = "interpreted-keys";

/* --------------------------------- adoption ---------------------------------- */

const prettyLabel = (token: string): string => {
  const words = token.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Apply CONFIRMED proposals to an engagement, returning a new config (the
 * input is never mutated). Confirmation is the caller's act: whatever
 * proposals remain in the list are treated as confirmed by the human running
 * the adopt step.
 */
export function applyProposals(
  engagement: EngagementConfig,
  proposals: InterpretationProposal[]
): { engagement: EngagementConfig; notes: string[] } {
  validateProposals(proposals);
  const notes: string[] = [];

  const actors = [...engagement.actors];
  const actorIds = new Set(actors.map((a) => a.id));
  const contracts = [...engagement.contracts];
  const workflowIds = new Set(contracts.map((c) => c.workflowId));
  const extractRuleSets = engagement.extractRuleSets.map((rs) => ({ ...rs, rules: [...rs.rules] }));
  const activitySources = engagement.activitySources.map((s) => ({ ...s, map: { ...s.map } }));
  const activitySourceLabels = { ...engagement.activitySourceLabels };

  let adoptedContracts = 0;
  for (const p of proposals) {
    if (p.payload.kind === "actors") {
      for (const actor of p.payload.actors) {
        if (actorIds.has(actor.id)) continue;
        actorIds.add(actor.id);
        actors.push(actor);
      }
      notes.push(`Adopted actor roster (${p.payload.actors.length} actors) from ${p.interpreter.name}.`);
      continue;
    }

    const { contract, joinField } = p.payload;
    if (workflowIds.has(contract.workflowId)) {
      throw new EngineError("interpret", `adopt: workflow ${contract.workflowId} already has a contract — interpretation never overwrites confirmed definitions`);
    }
    workflowIds.add(contract.workflowId);
    adoptedContracts += 1;

    // The shared extractor rule set for interpreted joins.
    let ruleSet = extractRuleSets.find((rs) => rs.id === INTERPRETED_RULESET_ID);
    if (!ruleSet) {
      ruleSet = { id: INTERPRETED_RULESET_ID, rules: [] };
      extractRuleSets.push(ruleSet);
    }
    const rule = { from: "field" as const, field: joinField, entityKind: contract.join.entityKind };
    if (!ruleSet.rules.some((r) => JSON.stringify(r) === JSON.stringify(rule))) ruleSet.rules.push(rule);

    contracts.push({ ...contract, join: { ...contract.join, extractorRuleSetId: INTERPRETED_RULESET_ID } });
    notes.push(
      `Adopted contract ${contract.id} (${p.confidence} confidence, ${p.interpreter.name}): ${contract.event.eventType} in ${contract.event.source}, joined on ${contract.join.entityKind} via "${joinField}" — Grade D floor until a counterfactual design is confirmed.`
    );
  }

  // Derived mechanics — the Tier-0 claim posture: every run of a contracted
  // actor asserts its outcome (workflowId resolves from the actor mapping),
  // and verification does the filtering. Existing claim mappings are never
  // touched; interpretation adds, it does not overwrite.
  if (adoptedContracts > 0) {
    for (const spec of activitySources) {
      if (spec.map.claim) continue;
      spec.map.claim = { workflowId: spec.map.actorId, claimedEventType: { const: "outcome" } };
      notes.push(
        `Claim mapping derived on ${spec.file}: every run claims its workflow's outcome (workflowId ← ${typeof spec.map.actorId === "string" ? `column "${spec.map.actorId}"` : JSON.stringify(spec.map.actorId)}); verification does the filtering.`
      );
    }
  }

  // Every const-sourced activity file needs a display label for the statement.
  for (const spec of activitySources) {
    if (typeof spec.source === "object" && "const" in spec.source) {
      const s = spec.source.const;
      if (!activitySourceLabels[s]) activitySourceLabels[s] = prettyLabel(s);
    }
  }

  const verdictRules =
    engagement.verdictRules.length > 0 ? engagement.verdictRules : TIER0_DEFAULT_VERDICT_RULES;
  if (engagement.verdictRules.length === 0) {
    notes.push(
      "No verdict policy defined — adopted the Tier-0 defaults (RETIRE when nothing verifies, otherwise RENEGOTIATE on the evidence; impact = spend at stake). Replace with contract-specific rules deliberately."
    );
  }

  return {
    engagement: {
      ...engagement,
      actors,
      contracts,
      extractRuleSets,
      activitySources,
      activitySourceLabels,
      verdictRules,
    },
    notes,
  };
}

/* ------------------------------ request building ----------------------------- */

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Build the questions an interpreter must answer, from observatory evidence.
 * Requests are self-contained (question + context + samples) so an external
 * interpreter needs nothing but this JSON.
 */
export function buildInterpretationRequests(
  engagement: EngagementConfig,
  observatory: ObservatoryReport
): InterpretationRequest[] {
  const requests: InterpretationRequest[] = [];

  if (engagement.actors.length === 0 && observatory.agents.length > 0) {
    requests.push({
      id: "req-actor-roster",
      kind: "actorRoster",
      question: "These actor ids appear in the activity exports with no declared roster. Which are agents (and which, if any, are humans)?",
      context: observatory.agents.map(
        (a) => `${a.actorId}: ${a.runs} runs · ${usd(a.spendCents)} spend · models [${a.models.join(", ")}] · ${a.joinPct}% of runs join an outcome entity`
      ),
      samples: [],
    });
  }

  for (const agent of observatory.agents) {
    if (agent.outputs.length === 0) continue;
    // One definition question per agent: its highest-volume observed output.
    const top = [...agent.outputs].sort((a, b) => b.count - a.count || (a.eventType < b.eventType ? -1 : 1))[0];
    if (top.count < 10) continue;
    const joinKey = observatory.joinKeys
      .filter((jk) => jk.entityKind === top.entityKind)
      .sort((a, b) => b.matchPct - a.matchPct || (a.field < b.field ? -1 : 1))[0];
    if (!joinKey) continue;
    const coTypes = agent.outputs
      .filter((o) => o.entityKind === top.entityKind && o.eventType !== top.eventType)
      .map((o) => `${o.eventType} (${o.count})`);
    requests.push({
      id: `req-outcome-${slug(agent.actorId)}`,
      kind: "outcomeDefinition",
      question: `${agent.actorId}'s runs join ${top.count} "${top.eventType}" events in ${top.source} on ${top.entityKind} entities. Adopt this as the agent's outcome definition? Do any co-occurring event types negate the outcome (a quality bar)?`,
      context: [
        `join key: run field "${joinKey.field}" matches ${top.entityKind} ids (${joinKey.matchPct}% of ${joinKey.runsWithField} runs carrying it, ${joinKey.distinctEntities} distinct entities)`,
        `observed cost per touched outcome: ${usd(top.costPerOutcomeCents)} (${agent.runs} runs, ${usd(agent.spendCents)} spend)`,
        coTypes.length > 0
          ? `co-occurring event types on ${top.entityKind}: ${coTypes.join(", ")}`
          : `no co-occurring event types observed on ${top.entityKind}`,
        "Observed association, not attribution — an adopted contract starts at the Grade-D evidence floor.",
      ],
      samples: joinKey.samples,
      subject: { actorId: agent.actorId, source: top.source, eventType: top.eventType, entityKind: top.entityKind },
    });
  }

  return requests;
}

/* --------------------------------- rendering --------------------------------- */

export function renderInterpretation(
  requests: InterpretationRequest[],
  proposals: InterpretationProposal[]
): string {
  const lines: string[] = [];
  lines.push("# Interpretation — proposed definitions awaiting confirmation");
  lines.push("");
  lines.push(
    "Interpretation proposes; it never settles. Review each proposal, DELETE the ones you do not confirm from the proposals file, then run `causa adopt` — the remainder become the engagement's contracts, at the Grade-D evidence floor, billed as usage until priced by humans."
  );
  lines.push("");
  for (const req of requests) {
    lines.push(`## ${req.id} — ${req.kind}`);
    lines.push("");
    lines.push(req.question);
    lines.push("");
    for (const c of req.context) lines.push(`- ${c}`);
    if (req.samples.length > 0) lines.push(`- samples: ${req.samples.join(" · ")}`);
    lines.push("");
    const answers = proposals.filter((p) => p.requestId === req.id);
    if (answers.length === 0) lines.push("_No proposal — the interpreter declined to answer._");
    for (const p of answers) {
      const head = `**Proposal** (${p.interpreter.name}${p.interpreter.model ? ` · ${p.interpreter.model}` : ""}, confidence ${p.confidence})`;
      if (p.payload.kind === "actors") {
        lines.push(`${head}: roster of ${p.payload.actors.length} — ${p.payload.actors.map((a) => `${a.id} (${a.class})`).join(", ")}`);
      } else {
        const c = p.payload.contract;
        lines.push(
          `${head}: contract \`${c.id}\` — event \`${c.event.eventType}\` in ${c.event.source}, joined on \`${c.join.entityKind}\` via run field \`${p.payload.joinField}\`, quality bar ${c.qualityBar ? JSON.stringify(c.qualityBar) : "none"}, window ${c.windowDays}d, billing usage, counterfactual Grade-D rules floor`
        );
      }
      for (const r of p.rationale) lines.push(`  - ${r}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
