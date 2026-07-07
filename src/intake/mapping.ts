/**
 * Declarative row → record mapping for Tier-0 intake. Mappings are DATA in
 * the engagement config — a customer engagement is configuration, not code.
 * Every row either becomes a canonical record or lands in the reject list
 * with a reason and row number: intake obeys the same conservation ethos as
 * the funnel (rows read = records produced + rejects).
 */
import { roundHalfUp } from "../numeric";
import type { RawRow, RowReject } from "./csv";

/** Where a value comes from: a column/key name, a constant, or a column with a transform. */
export type FieldSpec =
  | string
  | { const: string }
  | { column: string; transform?: "trim" | "usdToCents" | "timestamp" };

export class RowError extends Error {}

function rawValue(row: RawRow, keyPath: string): unknown {
  // Dotted paths address nested NDJSON objects; CSV columns are flat keys.
  if (keyPath in row.values) return row.values[keyPath];
  let cur: unknown = row.values;
  for (const part of keyPath.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Normalize common timestamp shapes to ISO 8601. Naive timestamps are read as UTC. */
export function normalizeTimestamp(value: string): string {
  const v = value.trim();
  if (v === "") throw new RowError("empty timestamp");
  if (/^\d{13}$/.test(v)) return new Date(Number(v)).toISOString();
  if (/^\d{10}$/.test(v)) return new Date(Number(v) * 1000).toISOString();
  // "YYYY-MM-DD HH:MM(:SS)" — treat as UTC, note the assumption in the intake report.
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(v);
  if (naive) {
    const ms = Date.parse(`${naive[1]}T${naive[2]}Z`);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) throw new RowError(`unparseable timestamp "${v.slice(0, 40)}"`);
  return new Date(ms).toISOString();
}

/** "$1,234.56" / "1.5" → integer cents (half-up on sub-cent noise). */
export function usdToCents(value: string): number {
  const cleaned = value.trim().replace(/[$,]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) {
    throw new RowError(`unparseable money "${value.slice(0, 40)}"`);
  }
  const dollars = Number(cleaned);
  if (dollars < 0) throw new RowError(`negative cost "${value.slice(0, 40)}"`);
  return roundHalfUp(dollars * 100);
}

export function resolveField(row: RawRow, spec: FieldSpec, label: string): string {
  if (typeof spec === "object" && "const" in spec) return spec.const;
  const column = typeof spec === "string" ? spec : spec.column;
  const transform = typeof spec === "string" ? undefined : spec.transform;
  const raw = rawValue(row, column);
  if (raw === undefined || raw === null || raw === "") {
    throw new RowError(`missing ${label} (column "${column}")`);
  }
  const s = typeof raw === "string" ? raw : String(raw);
  switch (transform) {
    case undefined:
      return s;
    case "trim":
      return s.trim();
    case "timestamp":
      return normalizeTimestamp(s);
    case "usdToCents":
      return String(usdToCents(s));
  }
}

export function resolveOptional(row: RawRow, spec: FieldSpec | undefined, label: string): string | undefined {
  if (spec === undefined) return undefined;
  if (typeof spec === "object" && "const" in spec) return spec.const;
  const column = typeof spec === "string" ? spec : spec.column;
  const raw = rawValue(row, column);
  if (raw === undefined || raw === null || raw === "") return undefined;
  return resolveField(row, spec, label);
}

/**
 * Map rows through a builder, collecting rejects. The builder throws RowError
 * to reject a row; any other exception is a bug and propagates.
 */
export function mapRows<T>(
  rows: RawRow[],
  build: (row: RawRow) => T
): { records: T[]; rejects: RowReject[] } {
  const records: T[] = [];
  const rejects: RowReject[] = [];
  for (const row of rows) {
    try {
      records.push(build(row));
    } catch (err) {
      if (!(err instanceof RowError)) throw err;
      rejects.push({
        rowNum: row.rowNum,
        reason: err.message,
        sample: JSON.stringify(row.values).slice(0, 120),
      });
    }
  }
  return { records, rejects };
}
