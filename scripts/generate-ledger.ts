/**
 * Codegen: run the attribution engine over the Meridian fixtures, prove the
 * output reconciles with the published ledger, and write it to
 * lib/engine/generated/meridian-ledger.json for lib/data.ts to consume.
 *
 * This runs as `npm run reconcile` (and automatically via prebuild/predev).
 * It fails loudly if any engine-derived number drifts from the published
 * ledger — failing loudly is the product behaving.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMatchesPublished, buildMeridianLedgerJson, runMeridian } from "../src/fixtures/meridian";
import { renderStatement } from "../src/report";
import { canonicalJson } from "../src/hash";

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = join(here, "..", "generated");
const ledgerPath = join(generatedDir, "meridian-ledger.json");
const statementPath = join(generatedDir, "meridian-statement.md");

const ledger = buildMeridianLedgerJson();
assertMatchesPublished(ledger);
// (The byte-determinism double-run gate lives in the golden test — npm test —
// so the dev/build loop pays for one pipeline execution, not two.)

mkdirSync(generatedDir, { recursive: true });
writeFileSync(ledgerPath, JSON.stringify(JSON.parse(canonicalJson(ledger)), null, 2) + "\n");

const s = runMeridian();
writeFileSync(statementPath, renderStatement(s));

console.log(
  `reconciled: ${s.headers.claimed} claimed → ${s.headers.verified} verified → ${s.headers.attributable} attributable · ` +
    `$${(s.headers.spendCents / 100).toLocaleString("en-US")} spend · $${s.headers.projectedVerdictImpactDollars.toLocaleString("en-US")}/mo verdict impact · ` +
    `replay ${s.replay.inputHash.slice(0, 8)}/${s.replay.configHash.slice(0, 8)} @ engine ${s.engineVersion}`
);
console.log(`ledger    → ${ledgerPath}`);
console.log(`evidence  → ${statementPath}  (the settled statement, human-readable — verify results here)`);
