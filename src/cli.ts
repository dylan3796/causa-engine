/**
 * The Tier-0 CLI: two exports and a join key in, a settled statement out.
 *
 *   causa preflight <engagement.json> [--out <dir>]   what's verifiable, grade ceiling
 *   causa settle    <engagement.json> [--out <dir>]   intake → preflight → statement
 *
 * Outputs land in <out> (default: <engagement dir>/out): intake-report.md,
 * preflight.md, statement.md, statement.json (canonical, replayable).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEngagement, renderIntakeReport } from "./intake/engagement";
import { preflight, renderPreflight } from "./intake/preflight";
import { runStatement } from "./statement";
import { renderStatement } from "./report";
import { canonicalJson } from "./hash";

export function runCli(argv: string[]): number {
  const [command, engagementPath, ...rest] = argv;
  if (!command || !engagementPath || !["settle", "preflight"].includes(command)) {
    console.error("usage: causa <settle|preflight> <engagement.json> [--out <dir>]");
    return 2;
  }
  const outFlag = rest.indexOf("--out");
  const outDir = resolve(outFlag >= 0 && rest[outFlag + 1] ? rest[outFlag + 1] : join(dirname(resolve(engagementPath)), "out"));
  mkdirSync(outDir, { recursive: true });

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
