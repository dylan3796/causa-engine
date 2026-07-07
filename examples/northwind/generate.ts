/**
 * Northwind — a fictional customer used to exercise the engine on data it has
 * never seen (a bought AP invoice agent billed $2.00/invoice, with a recorded
 * 10% holdout, quality failures, a double-billed claim, uncontracted refunds,
 * and deliberately dirty rows the intake must reject). Deterministic: no clock,
 * no randomness — every value is derived from the row index.
 *
 * writeNorthwind(dir) emits customer-shaped exports (data/runs.csv +
 * data/outcomes.csv) that engagement.json maps back through the real Tier-0
 * intake path.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const T0 = Date.parse("2026-07-01T00:00:00.000Z");
const H = 3_600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

export function writeNorthwind(dir: string): void {
  mkdirSync(join(dir, "data"), { recursive: true });

  const runs: string[] = ["run_id,actor,started_at,cost_usd,invoice_id,claim_wf"];
  const outcomes: string[] = ["source,entity_kind,entity_id,event_type,occurred_at,experiment_id,arm"];
  const out = (src: string, id: string, type: string, at: number, exp = "", arm = "") =>
    outcomes.push(`${src},invoice,${id},${type},${iso(at)},${exp},${arm}`);

  let runSeq = 0;
  const claim = (invoiceId: string, at: number) =>
    runs.push(`r-${String(++runSeq).padStart(4, "0")},ap-agent,${iso(at)},0.04,${invoiceId},invoices`);

  // 450 treated invoices; claims on the first 400 (+1 duplicate later).
  for (let i = 1; i <= 450; i++) {
    const id = `INV-${1000 + i}`;
    const created = T0 + (i % 25) * D + 8 * H;
    out("stripe", id, "invoice_created", created, "northwind-holdout", "treated");
    if (i > 400) continue; // treated but never claimed
    const runAt = created + 2 * H;
    if (i <= 392) claim(id, runAt);
    else runs.push(`r-${String(++runSeq).padStart(4, "0")},ap-agent,${iso(runAt)},0.04,,invoices`); // 8 unjoinable: no key
    if (i <= 380) out("stripe", id, "invoice_posted", runAt + 3 * H); // 381..392 claim but nothing posts
    if (i <= 9) out("stripe", id, "correction_logged", runAt + 3 * H + (6 + (i % 6)) * D); // late: day 6-11, past the 5d bar
    else if (i > 360 && i <= 380) out("stripe", id, "correction_logged", runAt + 3 * H + (1 + (i % 4)) * D); // inside the bar
    if (i > 20 && i <= 26) out("stripe", id, "refund_issued", runAt + 3 * H + 2 * D); // nobody contracts refunds
  }
  // The double-bill: a second claim on INV-1001, later the same week.
  claim("INV-1001", T0 + 4 * D);

  // 250 non-claiming steps on treated invoices.
  for (let i = 1; i <= 250; i++) {
    const id = `INV-${1000 + ((i * 7) % 450) + 1}`;
    runs.push(`r-${String(++runSeq).padStart(4, "0")},ap-agent,${iso(T0 + (i % 27) * D + 14 * H)},0.01,${id},`);
  }
  // Dirty rows the intake must reject, not swallow:
  runs.push("r-9999,ap-agent,last tuesday,0.04,INV-1400,invoices"); // bad timestamp
  runs.push("r-9998,ap-agent,2026-07-30 25:99:00,0.04,INV-1401,invoices"); // bad timestamp
  runs.push("r-0001,ap-agent,2026-07-30T10:00:00Z,0.04,INV-1402,invoices"); // duplicate run id

  // Holdout: 50 invoices the agent never touches; humans post 18, 3 corrected within the bar.
  for (let i = 1; i <= 50; i++) {
    const id = `INV-${2000 + i}`;
    const created = T0 + (i % 25) * D + 9 * H;
    out("stripe", id, "invoice_created", created, "northwind-holdout", "control");
    if (i <= 18) {
      const posted = created + 26 * H;
      out("stripe", id, "invoice_posted", posted);
      if (i <= 3) out("stripe", id, "correction_logged", posted + 2 * D);
    }
  }
  outcomes.push("this row is ragged"); // one more dirty row

  writeFileSync(join(dir, "data", "runs.csv"), runs.join("\n") + "\n");
  writeFileSync(join(dir, "data", "outcomes.csv"), outcomes.join("\n") + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = new URL(".", import.meta.url).pathname;
  writeNorthwind(here);
  console.log(`wrote ${here}data/runs.csv and outcomes.csv`);
}
