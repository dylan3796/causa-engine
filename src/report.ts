/**
 * The evidence surface: render a settled statement as a human-readable
 * document. This is where results get verified — every number with the cells
 * it came from, every estimate with its design, assumptions, corroborating
 * baselines, and uncertainty, every verdict with the rule and metric snapshot
 * that produced it, and the replay fingerprint that makes it reproducible.
 * Deterministic: same statement → byte-identical report.
 */
import type { CandidateOutcome, EstimatorResult, LedgerStatement, WorkflowStatement } from "./types";

/** Deterministic thousands grouping — no locale machinery inside the engine. */
const int = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const usd = (cents: number) => {
  const dollars = Math.floor(cents / 100);
  const rem = Math.abs(cents % 100);
  return `$${int(dollars)}.${String(rem).padStart(2, "0")}`;
};
const usd0 = (dollars: number) => `$${int(dollars)}`;

function estimatorLines(e: EstimatorResult, indent = ""): string[] {
  const lines: string[] = [];
  lines.push(`${indent}- Design: ${e.designKind} · Grade ${e.grade}`);
  lines.push(
    `${indent}- Counterfactual: ${int(e.counterfactualCount)} of ${int(e.incrementality.den)} verified would have happened anyway → ${int(e.attributable)} attributable (${((100 * e.incrementality.num) / e.incrementality.den).toFixed(1)}% incremental)`
  );
  if (e.interval) {
    lines.push(
      `${indent}- 95% interval on incrementality: ${(100 * e.interval.lo).toFixed(1)}%–${(100 * e.interval.hi).toFixed(1)}% (${e.interval.method})`
    );
  }
  for (const [name, cell] of Object.entries(e.cells)) {
    lines.push(`${indent}- Cell ${name}: ${int(cell.k)} / ${int(cell.n)}`);
  }
  if (e.perSlice) {
    for (const s of e.perSlice) {
      lines.push(
        `${indent}- Slice ${s.slice}: ${int(s.verified)} verified, ${int(s.counterfactual)} expected anyway → ${int(s.attributable)} attributable (point delta ${s.pointDelta >= 0 ? "+" : ""}${s.pointDelta.toFixed(1)})`
      );
    }
  }
  for (const a of e.assumptions) lines.push(`${indent}- Assumption: ${a}`);
  for (const n of e.notes) lines.push(`${indent}- Note: ${n}`);
  return lines;
}

function workflowSection(w: WorkflowStatement): string[] {
  const lines: string[] = [];
  lines.push(`## ${w.workflowId}`);
  lines.push("");
  lines.push(
    `**Funnel:** ${int(w.claimed)} claimed → ${int(w.verified)} verified → ${int(w.attributable)} attributable`
  );
  lines.push(
    `**Drops:** ${int(w.drop.didNotHappen)} didn't happen · ${int(w.drop.failedQualityBar)} failed the quality bar · ${int(w.drop.unjoinable)} unjoinable · ${int(w.drop.duplicateClaim)} duplicate claims`
  );
  for (const [reason, count] of Object.entries(w.qualityFailures).sort(([a], [b]) => (a < b ? -1 : 1))) {
    lines.push(`  - quality failure ${reason}: ${int(count)}`);
  }
  lines.push(
    `**Economics:** ${usd(w.spendCents)} spend · ${usd(w.costPerVerifiedCents)}/verified · quality pass ${w.qualityPassPct}%`
  );
  if (w.modelSplit) {
    for (const m of w.modelSplit) {
      lines.push(
        `  - ${m.model}: ${int(m.verified)} verified (share ${m.share.toFixed(2)}) · marginal ${usd(m.marginalCostPerVerifiedCents)}/verified`
      );
    }
  }
  if (w.actorSplit) {
    lines.push(
      `  - actor split (${w.actorSplit.rule}): agent ${w.actorSplit.agent.toFixed(2)} (${int(w.actorSplit.agentTouches)} touches) / human ${w.actorSplit.human.toFixed(2)} (${int(w.actorSplit.humanTouches)} touches)`
    );
  }
  lines.push("");
  lines.push(`**Evidence (${w.estimator.designKind}, Grade ${w.estimator.grade}):**`);
  lines.push(...estimatorLines(w.estimator));
  if (w.estimator.corroboration) {
    for (const c of w.estimator.corroboration) {
      lines.push(`- Corroborating baseline (${c.designKind}, Grade ${c.grade}):`);
      lines.push(...estimatorLines(c, "  "));
    }
  }
  if (w.dispute) {
    lines.push("");
    lines.push(
      `**Dispute:** billed ${usd(w.dispute.billedPerOutcomeCents)}/outcome · fair price ${usd(w.dispute.fairPriceCents)} at ${w.dispute.incrementalityPct}% incrementality · delta ${usd(w.dispute.deltaPerOutcomeCents)} · ${int(w.dispute.qualityFailures)} quality failures → ${usd(w.dispute.adjustmentCents)} adjustment`
    );
  }
  lines.push("");
  lines.push(
    `**Verdict:** ${w.verdict.verdict} (rule \`${w.verdict.ruleId}\`) · projected impact ${usd0(w.verdict.impactPerMonthDollars)}/mo`
  );
  const inputs = Object.entries(w.verdict.inputs)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
  lines.push(`  - inputs: ${inputs}`);
  lines.push(
    `**Coverage:** ${int(w.coverage.runsWithKey)}/${int(w.coverage.runsTotal)} runs carry a join key (${w.coverage.runKeyPct}%) · ${int(w.coverage.claimsJoined)}/${int(w.coverage.claimsTotal)} claims joined`
  );
  lines.push("");
  return lines;
}

function candidateSection(c: CandidateOutcome): string[] {
  const lines: string[] = [];
  const scope = c.workflowId ? ` · via ${c.workflowId}` : "";
  lines.push(`### ${c.kind}: ${c.eventType} (${c.source})${scope} — ${int(c.count)}${c.pctOfVerified !== undefined ? ` (${c.pctOfVerified}% of verified)` : ""}`);
  for (const line of c.context) lines.push(`- ${line}`);
  if (c.draft) {
    lines.push(
      `- Draft contract: event \`${c.draft.eventType}\` in ${c.draft.source}, joined on \`${c.draft.entityKind}\`, quality bar ${c.draft.suggestedQualityBar ? JSON.stringify(c.draft.suggestedQualityBar) : "to be defined"} — awaiting confirmation`
    );
  }
  if (c.sampleEntities.length > 0) lines.push(`- Samples: ${c.sampleEntities.join(", ")}`);
  if (c.firstSeen && c.lastSeen) lines.push(`- Seen: ${c.firstSeen} → ${c.lastSeen}`);
  lines.push("");
  return lines;
}

export function renderStatement(s: LedgerStatement): string {
  const lines: string[] = [];
  lines.push(`# Settled statement`);
  lines.push("");
  lines.push(
    `**${int(s.headers.claimed)} claimed → ${int(s.headers.verified)} verified → ${int(s.headers.attributable)} attributable** · spend ${usd(s.headers.spendCents)} · adjustment identified ${usd(s.headers.adjustmentCents)} · projected verdict impact ${usd0(s.headers.projectedVerdictImpactDollars)}/mo`
  );
  lines.push("");
  lines.push(
    `Replay: input \`${s.replay.inputHash}\` · config \`${s.replay.configHash}\` · engine \`${s.engineVersion}\` — same inputs, same config, same engine ⇒ byte-identical statement.`
  );
  lines.push("");

  for (const w of s.workflows) lines.push(...workflowSection(w));

  lines.push(`## Proposed outcomes (awaiting confirmation)`);
  lines.push("");
  lines.push(
    `The outcome engine interprets what the systems of record show beyond the confirmed contracts. Proposals never settle money until confirmed.`
  );
  lines.push("");
  for (const c of s.candidates) lines.push(...candidateSection(c));

  lines.push(`## Activity ingested`);
  lines.push("");
  for (const [label, count] of Object.entries(s.activityRunsBySource).sort(([a], [b]) => (a < b ? -1 : 1))) {
    lines.push(`- ${label}: ${int(count)} runs`);
  }
  lines.push(`- Total: ${int(s.totalRuns)} runs`);
  lines.push("");
  return lines.join("\n");
}
