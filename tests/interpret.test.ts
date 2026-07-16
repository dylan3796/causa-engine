/**
 * The interpretation stage: requests from observatory evidence, proposals
 * under doctrine guardrails (interpretation proposes; it never settles),
 * adoption, and the full org-sweep graduation: raw heterogeneous exports →
 * observatory → interpret → adopt → SETTLED statement. Every funnel figure
 * hand-derived from the generator's arithmetic before the code ran.
 */
import { describe, expect, it } from "vitest";
import { orgsweepFiles } from "@/examples/orgsweep/generate";
import { autoEngagement } from "@/src/intake/autodetect";
import { buildEngagement } from "@/src/intake/build";
import { observe } from "@/src/outcomes/observatory";
import {
  TIER0_DEFAULT_VERDICT_RULES,
  applyProposals,
  buildInterpretationRequests,
  validateProposals,
  type InterpretationProposal,
} from "@/src/interpret/protocol";
import { interpretHeuristically } from "@/src/interpret/heuristic";
import { runStatement } from "@/src/statement";

function sweep() {
  const files = orgsweepFiles();
  const { engagement } = autoEngagement(Object.entries(files).map(([name, content]) => ({ name, content })));
  const loaded = buildEngagement(engagement, (f) => files[f]);
  const observatory = observe(loaded.inputs);
  const requests = buildInterpretationRequests(engagement, observatory);
  const proposals = interpretHeuristically(requests, observatory);
  return { files, engagement, observatory, requests, proposals };
}

function contractProposal(overrides: Record<string, unknown> = {}): InterpretationProposal {
  return {
    requestId: "req-outcome-x",
    interpreter: { name: "test" },
    confidence: "high",
    rationale: ["because"],
    payload: {
      kind: "contract",
      joinField: "ticket_id",
      contract: {
        id: "interpreted-x-resolved",
        workflowId: "x",
        event: { source: "helpdesk", eventType: "resolved" },
        qualityBar: null,
        counterfactual: { kind: "rules", wouldHaveHappenedAnyway: { op: "or", of: [] } },
        join: { entityKind: "ticket", extractorRuleSetId: "interpreted-keys" },
        billing: { kind: "usage" },
        windowDays: 30,
        actorIds: ["x"],
        declaredEventTypes: ["resolved"],
        ...overrides,
      },
    },
  } as InterpretationProposal;
}

describe("protocol guardrails — interpretation proposes, it never settles", () => {
  it("a proposed counterfactual design is rejected: interpretation enters at the evidence floor", () => {
    const p = contractProposal({
      counterfactual: { kind: "holdout", experimentId: "hx", treatedArm: "t", controlArm: "c" },
    });
    expect(() => validateProposals([p])).toThrow(/evidence floor/);
  });

  it("proposed pricing is rejected: billing stays usage until humans price it", () => {
    const p = contractProposal({ billing: { kind: "perOutcome", rateCents: 100 } });
    expect(() => validateProposals([p])).toThrow(/settlement term/);
  });

  it("provenance stays visible: contract ids must carry the interpreted- prefix", () => {
    const p = contractProposal({ id: "support-resolved" });
    expect(() => validateProposals([p])).toThrow(/interpreted-/);
  });

  it("fabricated companion evidence is rejected", () => {
    const p = contractProposal({
      corroboration: [
        {
          kind: "preAgentBaseline",
          basis: "displacement",
          months: [{ month: "2025-01", volume: 1, costPerOutcomeCents: 1 }],
          match: { volumeTolerancePct: 25, minMonths: 1 },
          seasonality: { comparisonMonth: "2025-01", maxDivergencePct: 15 },
        },
      ],
    });
    expect(() => validateProposals([p])).toThrow(/come from the customer/);
  });

  it("a proposal without rationale or with undeclared confidence is not reviewable", () => {
    expect(() => validateProposals([{ ...contractProposal(), rationale: [] }])).toThrow(/rationale/);
    expect(() =>
      validateProposals([{ ...contractProposal(), confidence: "certain" as never }])
    ).toThrow(/confidence/);
  });

  it("workflowId must route the derived claims (must be one of actorIds)", () => {
    const p = contractProposal({ workflowId: "some-other-name" });
    expect(() => validateProposals([p])).toThrow(/routes the derived claims/);
  });
});

describe("heuristic-v1 on the org sweep", () => {
  it("asks one roster question and one definition question per agent, self-contained", () => {
    const { requests } = sweep();
    expect(requests.map((r) => r.id).sort()).toEqual([
      "req-actor-roster",
      "req-outcome-kb-bot",
      "req-outcome-sdr-bot",
      "req-outcome-support-bot",
    ]);
    const support = requests.find((r) => r.id === "req-outcome-support-bot")!;
    expect(support.context.join(" ")).toMatch(/ticket_id/);
    expect(support.context.join(" ")).toMatch(/reopened \(30\)/); // negation evidence is in the request
  });

  it("proposes the lexicon quality bar only where a negating event co-occurs", () => {
    const { requests, proposals } = sweep();
    validateProposals(proposals, requests);
    const byId = new Map(
      proposals
        .filter((p) => p.payload.kind === "contract")
        .map((p) => [p.payload.kind === "contract" ? p.payload.contract.id : "", p])
    );
    const support = byId.get("interpreted-support-bot-resolved")!;
    expect(support.payload.kind === "contract" && support.payload.contract.qualityBar).toEqual({
      kind: "noEventWithin",
      eventType: "reopened",
      days: 7,
    });
    expect(support.confidence).toBe("medium"); // a proposed bar is a judgment call
    const kb = byId.get("interpreted-kb-bot-published")!;
    expect(kb.payload.kind === "contract" && kb.payload.contract.qualityBar).toBeNull();
    // sdr-bot's top output by volume: meeting_booked (260) over opportunity_created (80)
    expect(byId.has("interpreted-sdr-bot-meeting-booked")).toBe(true);
  });
});

describe("adopt → settle: the org sweep graduates onto the ledger", () => {
  it("settles with hand-derived funnels, Tier-0 default policy, and honest integrity flags", () => {
    const { files, engagement, requests, proposals } = sweep();
    validateProposals(proposals, requests);
    const adopted = applyProposals(engagement, proposals);
    expect(adopted.engagement.verdictRules).toEqual(TIER0_DEFAULT_VERDICT_RULES);

    const loaded = buildEngagement(adopted.engagement, (f) => files[f]);
    const statement = runStatement(loaded.inputs, loaded.config);

    expect(statement.headers).toMatchObject({
      claimed: 1700,
      verified: 1110,
      attributable: 1110,
      spendCents: 9200,
      projectedVerdictImpactDollars: 92, // spend at stake: $50 + $36 + $6
    });

    const byId = new Map(statement.workflows.map((w) => [w.workflowId, w]));
    // support-bot: 900 runs = 610 verified (tickets 31..640) + 30 quality-failed
    // (reopens on 1..30) + 60 didn't happen (641..700 unresolved) + 120 keyless
    // + 80 double-claims (runs 701..780 re-touch tickets 1..80).
    expect(byId.get("support-bot")).toMatchObject({
      claimed: 900,
      verified: 610,
      attributable: 610,
      drop: { didNotHappen: 60, failedQualityBar: 30, unjoinable: 120, duplicateClaim: 80 },
    });
    // kb-bot: 300 runs over 240 docs — 60 re-touches are double-claims.
    expect(byId.get("kb-bot")).toMatchObject({
      claimed: 300,
      verified: 240,
      drop: { didNotHappen: 0, failedQualityBar: 0, unjoinable: 0, duplicateClaim: 60 },
    });
    // sdr-bot: 500 runs → 260 meetings, 180 prospects without one, 60 keyless.
    expect(byId.get("sdr-bot")).toMatchObject({
      claimed: 500,
      verified: 260,
      drop: { didNotHappen: 180, failedQualityBar: 0, unjoinable: 60, duplicateClaim: 0 },
    });

    for (const w of statement.workflows) {
      expect(w.estimator.grade).toBe("D"); // interpretation enters at the floor
      expect(w.verdict.verdict).toBe("RENEGOTIATE");
      expect(w.verdict.ruleId).toBe("tier0-renegotiate-on-floor-evidence");
    }

    // The every-run-claims posture double-bills re-touched entities — the
    // integrity module flags it instead of letting it hide. Correct positives.
    expect(
      byId.get("support-bot")!.integrity.findings.some((f) => f.check === "duplicate-claim-rate" && f.severity === "flag")
    ).toBe(true);
    expect(
      byId.get("kb-bot")!.integrity.findings.some((f) => f.check === "duplicate-claim-rate" && f.severity === "flag")
    ).toBe(true);

    // Discovery still works on the adopted engagement: sdr-bot's uncontracted
    // opportunity_created events surface as a proposal.
    const opp = statement.candidates.find((c) => c.kind === "uncontractedOutcome" && c.eventType === "opportunity_created");
    expect(opp?.count).toBe(80);
  });

  it("never overwrites confirmed definitions and derives claims only where none exist", () => {
    const { files, engagement, proposals } = sweep();
    const adopted = applyProposals(engagement, proposals);
    // Adopting the same proposals again must refuse: the workflows exist now.
    expect(() => applyProposals(adopted.engagement, proposals.filter((p) => p.payload.kind === "contract"))).toThrow(
      /never overwrites/
    );
    // Idempotence of the derived mechanics: reloading the adopted engagement
    // yields identical inputs (claims resolve from the actor columns).
    const a = buildEngagement(adopted.engagement, (f) => files[f]);
    const b = buildEngagement(adopted.engagement, (f) => files[f]);
    expect(JSON.stringify(a.inputs)).toBe(JSON.stringify(b.inputs));
  });
});
