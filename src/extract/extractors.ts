/**
 * Key extraction — the front half of the join. Join keys hide in
 * unstructured tool-call payloads (CAUSA.md §6.2); these rules mine them.
 * Rules are ordered data; for each entity kind the FIRST matching rule wins.
 * A run with no extractable key for the contract's entity kind is honestly
 * unjoinable — that is what produces coverage rates like "61% joinable".
 */
import type { ActivityRun, EntityRef, SourceId } from "../types";

export type ExtractRule =
  | { from: "toolCallArg"; source?: SourceId; tool: string; argPath: string; entityKind: string }
  | { from: "regex"; source?: SourceId; on: "text" | "toolArgs"; pattern: string; group: number; entityKind: string }
  | { from: "field"; source?: SourceId; field: string; entityKind: string };

export interface ExtractRuleSet {
  id: string;
  rules: ExtractRule[];
}

function argAtPath(argsJson: string, path: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return undefined;
  }
  let cur: unknown = parsed;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === "string" || typeof cur === "number") return String(cur);
  return undefined;
}

function applyRule(run: ActivityRun, rule: ExtractRule): string | undefined {
  if (rule.source && rule.source !== run.source) return undefined;
  switch (rule.from) {
    case "toolCallArg": {
      for (const call of run.payload.toolCalls ?? []) {
        if (call.name !== rule.tool) continue;
        const v = argAtPath(call.argsJson, rule.argPath);
        if (v !== undefined) return v;
      }
      return undefined;
    }
    case "regex": {
      const haystack =
        rule.on === "text"
          ? run.payload.text ?? ""
          : (run.payload.toolCalls ?? []).map((c) => c.argsJson).join("\n");
      const m = new RegExp(rule.pattern).exec(haystack);
      return m?.[rule.group] ?? undefined;
    }
    case "field":
      return run.payload.fields?.[rule.field];
  }
}

/** All entities referenced by a run — first matching rule per entity kind wins. */
export function extractEntities(run: ActivityRun, ruleSet: ExtractRuleSet): EntityRef[] {
  const byKind = new Map<string, string>();
  for (const rule of ruleSet.rules) {
    if (byKind.has(rule.entityKind)) continue;
    const id = applyRule(run, rule);
    if (id !== undefined && id !== "") byKind.set(rule.entityKind, id);
  }
  return [...byKind.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([kind, id]) => ({ kind, id }));
}
