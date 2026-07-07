/**
 * Build the statement viewer (web/index.html) from LIVE engine output. Both
 * example runs are settled here and injected into the template, so the page
 * can never drift from what the engine actually produces:
 *   - Meridian  — the reference fixture (runMeridian)
 *   - Northwind — a fresh customer, generated to CSV and settled through the
 *                 real Tier-0 intake path (writeNorthwind → loadEngagement → runStatement)
 *
 * This is a codegen step (`npm run build:viewer`); web/index.html is committed
 * so the viewer deploys as a static site with zero build.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMeridian } from "../src/fixtures/meridian";
import { loadEngagement } from "../src/intake/engagement";
import { runStatement } from "../src/statement";
import { ENGINE_VERSION } from "../src/version";
import { writeNorthwind } from "../examples/northwind/generate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Meridian — the reference fixture.
const meridian = runMeridian();

// Northwind — generated to CSV, then settled through the real intake path.
const northwindDir = join(root, "examples", "northwind");
writeNorthwind(northwindDir);
const nw = loadEngagement(join(northwindDir, "engagement.json"));
const northwind = runStatement(nw.inputs, nw.config);
if (nw.report.totals.rejected < 1) {
  throw new Error("Northwind should exercise intake rejects; none were produced — check the generator.");
}

const RUNS = [
  {
    key: "meridian",
    name: "Meridian",
    desc: "The reference customer · 4 workflows · June 2026 · ~14k agent runs",
    period: "June 2026",
    subject: "Reference dataset — reproduced exactly by the engine from ~30k synthetic event-level records.",
    data: meridian,
  },
  {
    key: "northwind",
    name: "Northwind",
    desc: "A fresh test customer · an AP invoice agent · July 2026",
    period: "July 2026",
    subject:
      "A brand-new customer the engine had never seen — two CSV exports and one engagement file, settled through the real Tier-0 intake path (" +
      nw.report.totals.rejected +
      " dirty rows rejected, not swallowed).",
    data: northwind,
  },
];

const template = readFileSync(join(root, "web", "template.html"), "utf8");
const html = template
  .replace("__RUNS__", JSON.stringify(RUNS))
  .replace("__ENGINE_VERSION__", JSON.stringify(ENGINE_VERSION));
if (html.includes("__RUNS__") || html.includes("__ENGINE_VERSION__")) {
  throw new Error("template placeholder left unreplaced");
}
writeFileSync(join(root, "web", "index.html"), html);

console.log(
  `viewer built → web/index.html · Meridian ${meridian.headers.claimed}→${meridian.headers.verified}→${meridian.headers.attributable} · ` +
    `Northwind ${northwind.headers.claimed}→${northwind.headers.verified}→${northwind.headers.attributable} · engine ${ENGINE_VERSION}`
);
