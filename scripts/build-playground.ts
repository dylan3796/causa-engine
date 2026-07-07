/**
 * Build the playground (web/playground.html + web/causa-engine.js): bundle
 * the pure engine for the browser and inject the Northwind engagement config.
 * Sample data itself is generated client-side by the bundled deterministic
 * generators, so the page stays light.
 */
import { buildSync } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION } from "../src/version";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

buildSync({
  entryPoints: [join(root, "src", "browser.ts")],
  bundle: true,
  format: "iife",
  globalName: "Causa",
  platform: "browser",
  target: "es2020",
  outfile: join(root, "web", "causa-engine.js"),
  logLevel: "silent",
});

const engagement = readFileSync(join(root, "examples", "northwind", "engagement.json"), "utf8").trim();
const template = readFileSync(join(root, "web", "playground-template.html"), "utf8");
const html = template
  .replace("__NORTHWIND_ENGAGEMENT__", engagement)
  .replace("__ENGINE_VERSION__", ENGINE_VERSION);
if (html.includes("__NORTHWIND_ENGAGEMENT__") || html.includes("__ENGINE_VERSION__")) {
  throw new Error("playground template placeholder left unreplaced");
}
writeFileSync(join(root, "web", "playground.html"), html);
console.log(`playground built → web/playground.html + web/causa-engine.js · engine ${ENGINE_VERSION}`);
