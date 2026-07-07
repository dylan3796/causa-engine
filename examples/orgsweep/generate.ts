/**
 * Org sweep — the "many agents, no contracts" scenario the observatory
 * exists for. Three agents across one organization, exported in
 * deliberately heterogeneous shapes:
 *
 *   agent_traces.ndjson   support-bot + kb-bot mixed in one trace export
 *   sdr_outreach_log.csv  sdr-bot, with completely different column names
 *   helpdesk.csv          ticket events        (ticket_id / status / updated_at)
 *   crm_events.csv        prospect events      (prospect_ref / event / created_at)
 *   docs.csv              document events      (doc_id / event / date)
 *
 * Nobody defined an outcome. The engine must triangulate the join keys,
 * quantify each agent's observed output and cost, and propose the contracts.
 * Deterministic: all values derive from the row index.
 */

const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const H = 3_600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

export function orgsweepFiles(): Record<string, string> {
  const traces: string[] = [];
  // support-bot: 900 runs over tickets TCK-1..700 (120 of them keyless), 4¢ each.
  for (let i = 1; i <= 900; i++) {
    const keyless = i > 780;
    const ticket = keyless ? "" : `TCK-${((i - 1) % 700) + 1}`;
    traces.push(
      JSON.stringify({
        run_id: `sb-${i}`,
        agent: "support-bot",
        model: "gpt-5",
        ts: iso(T0 + (i % 26) * D + 9 * H),
        cost_usd: "0.04",
        ticket_id: ticket,
      })
    );
  }
  // kb-bot: 300 runs over docs DOC-1..240, 2¢ each.
  for (let i = 1; i <= 300; i++) {
    traces.push(
      JSON.stringify({
        run_id: `kb-${i}`,
        agent: "kb-bot",
        model: "claude-fable-5",
        ts: iso(T0 + (i % 26) * D + 10 * H),
        cost_usd: "0.02",
        doc_id: `DOC-${((i - 1) % 240) + 1}`,
      })
    );
  }

  // sdr-bot: different column vocabulary entirely; 500 rows over PR-1..440 (60 keyless), 10¢ each.
  const sdr: string[] = ["agent_name,time,amount,prospect_ref"];
  for (let i = 1; i <= 500; i++) {
    const keyless = i > 440;
    sdr.push(`sdr-bot,${iso(T0 + (i % 26) * D + 8 * H)},0.10,${keyless ? "" : `PR-${i}`}`);
  }

  // Outcomes — three systems, three shapes. Every event lands 2h after the
  // (deterministic) run that touches its entity.
  const helpdesk: string[] = ["ticket_id,status,updated_at"];
  for (let i = 1; i <= 640; i++) helpdesk.push(`TCK-${i},resolved,${iso(T0 + (i % 26) * D + 12 * H)}`);
  for (let i = 1; i <= 30; i++) helpdesk.push(`TCK-${i},reopened,${iso(T0 + (i % 26) * D + 20 * H)}`);

  const crm: string[] = ["prospect_ref,event,created_at"];
  for (let i = 1; i <= 260; i++) crm.push(`PR-${i},meeting_booked,${iso(T0 + (i % 26) * D + 11 * H)}`);
  for (let i = 1; i <= 80; i++) crm.push(`PR-${i},opportunity_created,${iso(T0 + (i % 26) * D + 15 * H)}`);

  const docs: string[] = ["doc_id,event,date"];
  for (let i = 1; i <= 240; i++) docs.push(`DOC-${i},published,${iso(T0 + (i % 26) * D + 13 * H)}`);

  return {
    "agent_traces.ndjson": traces.join("\n") + "\n",
    "sdr_outreach_log.csv": sdr.join("\n") + "\n",
    "helpdesk.csv": helpdesk.join("\n") + "\n",
    "crm_events.csv": crm.join("\n") + "\n",
    "docs.csv": docs.join("\n") + "\n",
  };
}
