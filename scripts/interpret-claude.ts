/**
 * LLM interpretation adapter — OUTSIDE the sealed engine (src/ makes no
 * network calls, test-enforced). Doctrine: LLMs are sanctioned for ingestion
 * and interpretation only, never verdicts. This adapter reads the requests
 * JSON that `causa interpret` produces, asks Claude to answer them, and
 * validates the output with the SAME protocol guardrails the heuristic
 * interpreter faces (validateProposals) — an LLM proposal that tries to
 * invent a counterfactual design, set pricing, or skip its rationale is
 * rejected before it ever reaches an engagement. A human still confirms by
 * deleting unwanted proposals before `causa adopt`.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/interpret-claude.ts <requests.json> [--out <proposals.json>] [--model <id>]
 *
 * The output file is a drop-in replacement for the heuristic's
 * interpretation-proposals.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  validateProposals,
  type InterpretationProposal,
  type InterpretationRequest,
} from "../src/interpret/protocol";

const SYSTEM = `You are the interpretation stage of Causa, an independent settlement layer for AI-agent outcomes. You answer interpretation requests: given observatory evidence about agents and the outcome events their work touches, you propose outcome definitions and actor rosters for a human to confirm.

Hard rules (your output is machine-validated against these; violations are rejected):
- Interpretation proposes; it never settles. You only produce actor rosters and draft contracts.
- Proposed contracts MUST use counterfactual {"kind":"rules","wouldHaveHappenedAnyway":{"op":"or","of":[]}} — the Grade-D evidence floor. Never propose holdouts, experiments, or baselines: asserting an experiment existed would be fabricating evidence.
- billing MUST be {"kind":"usage"} — pricing is a settlement term between humans.
- contract.id MUST start with "interpreted-". contract.workflowId MUST equal the actor id (it is also the only entry in actorIds) — that routes the derived claims.
- join.extractorRuleSetId MUST be "interpreted-keys". declaredEventTypes lists ONLY the contracted event type plus any quality-bar event type.
- Every proposal declares interpreter {"name":"claude-adapter","model":"<the model you run on>"}, a confidence of "high"|"medium"|"low", and a rationale array explaining your judgment from the evidence given.
- A quality bar is judgment: propose {"kind":"noEventWithin","eventType":X,"days":7} only when a co-occurring event type on the same entity plausibly negates the outcome (reopened, refunded, churned...). Otherwise qualityBar is null and your rationale says the customer should define one if outcomes can regress.

Respond with ONLY a JSON array of InterpretationProposal objects:
[{
  "requestId": string,                     // must reference a request id from the input
  "interpreter": {"name": "claude-adapter", "model": string},
  "confidence": "high"|"medium"|"low",
  "rationale": string[],
  "payload":
    {"kind":"actors","actors":[{"id":string,"class":"agent"|"human","name":string}]}
  | {"kind":"contract","joinField":string,"contract":{
       "id":string,"workflowId":string,
       "event":{"source":string,"eventType":string},
       "qualityBar":{"kind":"noEventWithin","eventType":string,"days":number}|null,
       "counterfactual":{"kind":"rules","wouldHaveHappenedAnyway":{"op":"or","of":[]}},
       "join":{"entityKind":string,"extractorRuleSetId":"interpreted-keys"},
       "billing":{"kind":"usage"},
       "windowDays":number,
       "actorIds":[string],
       "declaredEventTypes":string[]
    }}
}]
No prose, no markdown fences — the array only.`;

function parseArgs(argv: string[]) {
  const positional = argv.filter((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--")));
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    requestsPath: positional[0],
    outPath: flag("--out") ?? "interpretation-proposals.json",
    model: flag("--model") ?? "claude-opus-4-8",
  };
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("no JSON array found in the model response");
  return JSON.parse(text.slice(start, end + 1));
}

async function main() {
  const { requestsPath, outPath, model } = parseArgs(process.argv.slice(2));
  if (!requestsPath) {
    console.error("usage: tsx scripts/interpret-claude.ts <requests.json> [--out <proposals.json>] [--model <id>]");
    process.exitCode = 2;
    return;
  }
  const requests = JSON.parse(readFileSync(resolve(requestsPath), "utf8")) as InterpretationRequest[];

  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Interpretation requests (self-contained evidence):\n\n${JSON.stringify(requests, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("model declined the request (stop_reason: refusal)");
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const proposals = extractJsonArray(text) as InterpretationProposal[];
  // The same doctrine gate the heuristic faces — nothing unvalidated reaches an engagement.
  validateProposals(proposals, requests);

  writeFileSync(resolve(outPath), JSON.stringify(proposals, null, 2) + "\n");
  console.log(
    `claude-adapter (${model}): ${requests.length} requests → ${proposals.length} proposals, validated — ${outPath}`
  );
  console.log("Review and DELETE unconfirmed proposals, then: causa adopt <engagement.json> " + outPath);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
