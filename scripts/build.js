#!/usr/bin/env node
/*
 * scripts/build.js
 * Builds a ready-to-load extension folder for each browser.
 *
 *   node scripts/build.js            -> dist/chrome, dist/edge, dist/firefox
 *   node scripts/build.js firefox    -> only dist/firefox
 *
 * How it works:
 *   1. Copy the shared engine (src/) into dist/<browser>/
 *   2. Make manifest.json = platforms/base.json + platforms/<browser>.json
 *      ({{name}}, {{version}}... are filled in from brand.json)
 *   3. Write brand.js so the scripts and popup know the extension's name
 *
 * No dependencies: plain Node.js 18+.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const PLATFORMS = ["chrome", "edge", "firefox"];

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

/** Objects merge key by key; anything else (arrays, strings) is replaced. */
function deepMerge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const bothObjects = isPlainObject(out[key]) && isPlainObject(value);
    out[key] = bothObjects ? deepMerge(out[key], value) : value;
  }
  return out;
}
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Replace {{key}} with brand values in every string of the manifest. */
function fillBrand(value, brand) {
  if (typeof value === "string") return value.replace(/\{\{(\w+)\}\}/g, (_, key) => brand[key] ?? "");
  if (Array.isArray(value)) return value.map((v) => fillBrand(v, brand));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillBrand(v, brand)]));
  }
  return value;
}

function makeManifest(platform, brand) {
  const merged = deepMerge(readJson("platforms/base.json"), readJson(`platforms/${platform}.json`));
  return fillBrand(merged, brand);
}

function build(platform) {
  const brand = readJson("brand.json");
  const out = path.join(DIST, platform);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(SRC, out, { recursive: true });
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(makeManifest(platform, brand), null, 2) + "\n");
  fs.writeFileSync(path.join(out, "brand.js"), `globalThis.YAS_BRAND = ${JSON.stringify(brand)};\n`);
  console.log(`built dist/${platform}  (${brand.name} ${brand.version})`);
}

function main() {
  const wanted = process.argv.slice(2);
  const targets = wanted.length ? wanted : PLATFORMS;
  for (const platform of targets) {
    if (!PLATFORMS.includes(platform)) {
      console.error(`Unknown platform "${platform}". Use: ${PLATFORMS.join(", ")}`);
      process.exit(1);
    }
    build(platform);
  }
}

if (require.main === module) main();
module.exports = { build, makeManifest, deepMerge, fillBrand, PLATFORMS };
