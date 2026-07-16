/**
 * The Tier-0 CLI: two exports and a join key in, a settled statement out.
 *
 *   causa preflight <engagement.json> [--out <dir>]   what's verifiable, grade ceiling
 *   causa settle    <engagement.json> [--out <dir>]   intake → preflight → statement
 *   causa interpret <engagement.json> [--out <dir>]   observatory evidence → requests +
 *                                                     heuristic proposals + review doc
 *   causa adopt     <engagement.json> <proposals.json> [--out <dir>]
 *                                                     apply CONFIRMED proposals → a new
 *                                                     engagement file (input untouched)
 *
 * Outputs land in <out> (default: <engagement dir>/out). The interpret/adopt
 * loop: run interpret, review interpretation.md, DELETE unconfirmed proposals
 * from interpretation-proposals.json, run adopt, then settle the adopted file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEngagement, renderIntakeReport, type EngagementConfig } from "./intake/engagement";
import { preflight, renderPreflight } from "./intake/preflight";
import { observe } from "./outcomes/observatory";
import {
  applyProposals,
  buildInterpretationRequests,
  renderInterpretation,
  validateProposals,
  type InterpretationProposal,
} from "./interpret/protocol";
import { interpretHeuristically } from "./interpret/heuristic";
import { runStatement } from "./statement";
import { renderStatement } from "./report";
import { canonicalJson } from "./hash";

export function runCli(argv: string[]): number {
  const [command, engagementPath, ...rest] = argv;
  if (!command || !engagementPath || !["settle", "preflight", "interpret", "adopt"].includes(command)) {
    console.error("usage: causa <settle|preflight|interpret> <engagement.json> [--out <dir>]");
    console.error("       causa adopt <engagement.json> <proposals.json> [--out <dir>]");
    return 2;
  }
  const outFlag = rest.indexOf("--out");
  const outDir = resolve(outFlag >= 0 && rest[outFlag + 1] ? rest[outFlag + 1] : join(dirname(resolve(engagementPath)), "out"));
  mkdirSync(outDir, { recursive: true });

  const readEngagementConfig = (): EngagementConfig =>
    JSON.parse(readFileSync(resolve(engagementPath), "utf8")) as EngagementConfig;

  if (command === "interpret") {
    const { inputs } = loadEngagement(engagementPath);
    const engagement = readEngagementConfig();
    const observatory = observe(inputs);
    const requests = buildInterpretationRequests(engagement, observatory);
    const proposals = interpretHeuristically(requests, observatory);
    validateProposals(proposals, requests);
    writeFileSync(join(outDir, "interpretation-requests.json"), JSON.stringify(requests, null, 2) + "\n");
    writeFileSync(join(outDir, "interpretation-proposals.json"), JSON.stringify(proposals, null, 2) + "\n");
    writeFileSync(join(outDir, "interpretation.md"), renderInterpretation(requests, proposals));
    console.log(`interpretation: ${requests.length} requests → ${proposals.length} proposals (heuristic-v1) — review ${join(outDir, "interpretation.md")}`);
    console.log(`to adopt: delete unconfirmed proposals from interpretation-proposals.json, then: causa adopt ${engagementPath} ${join(outDir, "interpretation-proposals.json")}`);
    return 0;
  }

  if (command === "adopt") {
    const positional = rest.filter((a, i) => !a.startsWith("--") && (outFlag < 0 || i !== outFlag + 1));
    const proposalsPath = positional[0];
    if (!proposalsPath) {
      console.error("usage: causa adopt <engagement.json> <proposals.json> [--out <dir>]");
      return 2;
    }
    const engagement = readEngagementConfig();
    const proposals = JSON.parse(readFileSync(resolve(proposalsPath), "utf8")) as InterpretationProposal[];
    const adopted = applyProposals(engagement, proposals);
    // Next to the source engagement, so its relative file references still resolve.
    const adoptedPath = resolve(engagementPath).replace(/\.json$/, "") + ".adopted.json";
    writeFileSync(adoptedPath, JSON.stringify(adopted.engagement, null, 2) + "\n");
    for (const note of adopted.notes) console.log(`adopt: ${note}`);
    console.log(`adopted engagement → ${adoptedPath} (settle it: causa settle ${adoptedPath})`);
    return 0;
  }

  const { inputs, config, report } = loadEngagement(engagementPath);
  writeFileSync(join(outDir, "intake-report.md"), renderIntakeReport(report));
  console.log(
    `intake: ${report.totals.rowsRead} rows → ${report.totals.recordsProduced} records (${report.totals.rejected} rejected) — ${join(outDir, "intake-report.md")}`
  );

  const pre = preflight(inputs, config);
  writeFileSync(join(outDir, "preflight.md"), renderPreflight(pre));
  for (const c of pre.contracts) {
    console.log(
      `preflight: ${c.workflowId} — ${c.verifiable ? "verifiable" : "NOT VERIFIABLE"} · grade ceiling ${c.gradeCeiling} · ${c.joinableClaims}/${c.claims} claims joinable`
    );
  }

  if (command === "preflight") return 0;

  const statement = runStatement(inputs, config);
  writeFileSync(join(outDir, "statement.md"), renderStatement(statement));
  writeFileSync(join(outDir, "statement.json"), JSON.stringify(JSON.parse(canonicalJson(statement)), null, 2) + "\n");
  console.log(
    `settled: ${statement.headers.claimed} claimed → ${statement.headers.verified} verified → ${statement.headers.attributable} attributable · ` +
      `$${(statement.headers.spendCents / 100).toFixed(2)} spend · $${statement.headers.projectedVerdictImpactDollars}/mo verdict impact`
  );
  console.log(`statement: ${join(outDir, "statement.md")}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
