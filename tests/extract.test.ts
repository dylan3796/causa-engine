import { describe, expect, it } from "vitest";
import { extractEntities, type ExtractRuleSet } from "@/src/extract/extractors";
import type { ActivityRun } from "@/src/types";

const RULES: ExtractRuleSet = {
  id: "keys",
  rules: [
    { from: "toolCallArg", tool: "resolve_ticket", argPath: "ticket.id", entityKind: "ticket" },
    { from: "regex", on: "text", pattern: "tickets/(\\d+)", group: 1, entityKind: "ticket" },
    { from: "field", field: "ticket_id", entityKind: "ticket" },
  ],
};

function run(payload: ActivityRun["payload"]): ActivityRun {
  return {
    id: "r1",
    source: "langsmith",
    actorId: "a",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T00:05:00.000Z",
    costCents: 0,
    payload,
  };
}

describe("key extraction", () => {
  it("mines keys from structured tool-call args", () => {
    const r = run({ toolCalls: [{ name: "resolve_ticket", argsJson: JSON.stringify({ ticket: { id: "42" } }) }] });
    expect(extractEntities(r, RULES)).toEqual([{ kind: "ticket", id: "42" }]);
  });

  it("mines keys buried in prose via regex", () => {
    const r = run({ text: "Closed https://x.zendesk.com/agent/tickets/777 after reply." });
    expect(extractEntities(r, RULES)).toEqual([{ kind: "ticket", id: "777" }]);
  });

  it("mines keys from CSV-style fields", () => {
    const r = run({ fields: { ticket_id: "9" } });
    expect(extractEntities(r, RULES)).toEqual([{ kind: "ticket", id: "9" }]);
  });

  it("first matching rule wins per entity kind", () => {
    const r = run({
      toolCalls: [{ name: "resolve_ticket", argsJson: JSON.stringify({ ticket: { id: "1" } }) }],
      text: "also mentions tickets/2",
      fields: { ticket_id: "3" },
    });
    expect(extractEntities(r, RULES)).toEqual([{ kind: "ticket", id: "1" }]);
  });

  it("a run with no extractable key is honestly unjoinable", () => {
    const r = run({
      toolCalls: [{ name: "resolve_ticket", argsJson: JSON.stringify({ ticket: {} }) }],
      text: "resolved a billing issue",
    });
    expect(extractEntities(r, RULES)).toEqual([]);
  });

  it("malformed tool args do not crash extraction", () => {
    const r = run({ toolCalls: [{ name: "resolve_ticket", argsJson: "{not json" }] });
    expect(extractEntities(r, RULES)).toEqual([]);
  });
});
