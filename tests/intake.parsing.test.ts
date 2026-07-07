import { describe, expect, it } from "vitest";
import { parseCsv, parseNdjson } from "@/src/intake/csv";
import { normalizeTimestamp, usdToCents } from "@/src/intake/mapping";
import { RowError } from "@/src/intake/mapping";

describe("CSV parsing", () => {
  it("handles quoted fields, escaped quotes, embedded commas and newlines", () => {
    const { rows, rejects } = parseCsv('id,note\n1,"hello, ""world"""\n2,"line1\nline2"\n');
    expect(rejects).toEqual([]);
    expect(rows[0].values).toEqual({ id: "1", note: 'hello, "world"' });
    expect(rows[1].values).toEqual({ id: "2", note: "line1\nline2" });
  });

  it("handles CRLF and a UTF-8 BOM", () => {
    const { rows, columns } = parseCsv('﻿a,b\r\n1,2\r\n');
    expect(columns).toEqual(["a", "b"]);
    expect(rows[0].values).toEqual({ a: "1", b: "2" });
  });

  it("rejects ragged rows with the row number, keeping the rest", () => {
    const { rows, rejects } = parseCsv("a,b\n1,2\n3\n4,5\n");
    expect(rows.map((r) => r.values)).toEqual([
      { a: "1", b: "2" },
      { a: "4", b: "5" },
    ]);
    expect(rejects).toHaveLength(1);
    expect(rejects[0].rowNum).toBe(2);
    expect(rejects[0].reason).toMatch(/ragged_row/);
  });
});

describe("NDJSON parsing", () => {
  it("parses objects and rejects malformed lines without dropping the file", () => {
    const { rows, rejects } = parseNdjson('{"id":"1"}\nnot json\n{"id":"2","nested":{"k":"v"}}\n\n');
    expect(rows).toHaveLength(2);
    expect(rows[1].values.nested).toEqual({ k: "v" });
    expect(rejects).toHaveLength(1);
    expect(rejects[0].reason).toBe("invalid_json");
  });
});

describe("transforms", () => {
  it("normalizes common timestamp shapes to ISO (naive read as UTC)", () => {
    expect(normalizeTimestamp("2026-06-01T12:00:00.000Z")).toBe("2026-06-01T12:00:00.000Z");
    expect(normalizeTimestamp("2026-06-01 12:00:00")).toBe("2026-06-01T12:00:00.000Z");
    expect(normalizeTimestamp("1780315200")).toBe(new Date(1780315200 * 1000).toISOString());
    expect(normalizeTimestamp("1780315200000")).toBe(new Date(1780315200000).toISOString());
    expect(() => normalizeTimestamp("yesterday-ish")).toThrow(RowError);
  });

  it("parses money to integer cents and refuses garbage", () => {
    expect(usdToCents("1.5")).toBe(150);
    expect(usdToCents("$1,234.56")).toBe(123456);
    expect(usdToCents("0")).toBe(0);
    expect(() => usdToCents("-3")).toThrow(RowError);
    expect(() => usdToCents("about five")).toThrow(RowError);
  });
});
