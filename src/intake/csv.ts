/**
 * Dependency-free tabular readers for Tier-0 intake: CSV (RFC 4180-ish —
 * quoted fields, escaped quotes, embedded newlines, CRLF, BOM) and NDJSON.
 * Both return rows plus per-row rejects; nothing is silently dropped.
 */

export interface RawRow {
  /** 1-based line/record number in the source file (header excluded for CSV). */
  rowNum: number;
  values: Record<string, unknown>;
}

export interface RowReject {
  rowNum: number;
  reason: string;
  sample: string;
}

export interface TableReadResult {
  rows: RawRow[];
  rejects: RowReject[];
  columns: string[];
}

export function parseCsv(content: string): TableReadResult {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Drop fully-empty trailing records (file ends with newline).
  while (records.length > 0 && records[records.length - 1].every((v) => v === "")) {
    records.pop();
  }
  if (records.length === 0) return { rows: [], rejects: [], columns: [] };

  const columns = records[0].map((c) => c.trim());
  const rows: RawRow[] = [];
  const rejects: RowReject[] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length !== columns.length) {
      rejects.push({
        rowNum: r,
        reason: `ragged_row: ${rec.length} fields, header has ${columns.length}`,
        sample: rec.join(",").slice(0, 120),
      });
      continue;
    }
    const values: Record<string, unknown> = {};
    for (let c = 0; c < columns.length; c++) values[columns[c]] = rec[c];
    rows.push({ rowNum: r, values });
  }
  return { rows, rejects, columns };
}

export function parseNdjson(content: string): TableReadResult {
  const rows: RawRow[] = [];
  const rejects: RowReject[] = [];
  const columns = new Set<string>();
  const lines = content.split(/\r?\n/);
  let rowNum = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    rowNum += 1;
    try {
      const parsed = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        rejects.push({ rowNum, reason: "not_an_object", sample: line.slice(0, 120) });
        continue;
      }
      for (const key of Object.keys(parsed)) columns.add(key);
      rows.push({ rowNum, values: parsed as Record<string, unknown> });
    } catch {
      rejects.push({ rowNum, reason: "invalid_json", sample: line.slice(0, 120) });
    }
  }
  return { rows, rejects, columns: [...columns].sort() };
}
