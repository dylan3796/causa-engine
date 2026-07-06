/**
 * Canonical serialization + hashing for replay records. No node:crypto —
 * FNV-1a is environment-agnostic and deterministic, which is all a replay
 * fingerprint needs (it is an integrity check, not a security boundary).
 */

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable JSON: object keys sorted at every level, no whitespace variance. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

/** 16-hex-char fingerprint: two FNV-1a passes with distinct salts. */
export function hashValue(value: unknown): string {
  const s = canonicalJson(value);
  const a = fnv1a32(s).toString(16).padStart(8, "0");
  const b = fnv1a32(`causa:${s}`).toString(16).padStart(8, "0");
  return a + b;
}
