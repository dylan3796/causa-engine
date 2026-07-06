/**
 * Source hygiene: the causal core is sealed and deterministic. No clocks, no
 * ambient randomness, no locale-dependent formatting anywhere in the engine.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const BANNED: Array<[string, RegExp]> = [
  ["Math.random", /Math\.random\s*\(/],
  ["Date.now", /Date\.now\s*\(/],
  ["argless new Date()", /new Date\(\s*\)/],
  ["toLocaleString", /\.toLocaleString\s*\(/],
];

describe("engine hygiene", () => {
  const engineSources = walk(join(ROOT, "src")).filter((f) => f.endsWith(".ts"));

  it("finds the engine sources", () => {
    expect(engineSources.length).toBeGreaterThan(10);
  });

  it("no clock, no ambient randomness, no locale formatting in src/", () => {
    for (const file of engineSources) {
      const src = readFileSync(file, "utf8");
      for (const [label, re] of BANNED) {
        expect(re.test(src), `${label} found in ${file}`).toBe(false);
      }
    }
  });

  it("the engine imports no UI framework", () => {
    for (const file of engineSources) {
      const src = readFileSync(file, "utf8");
      expect(/from ["'](react|next)/.test(src), `UI framework import in ${file}`).toBe(false);
    }
  });
});
