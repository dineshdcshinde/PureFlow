#!/usr/bin/env node
/*
 * scripts/filters.js
 * Turns EasyList (https://easylist.to) into the files PureFlow uses on every website
 * except YouTube (YouTube has its own, tuned handling).
 *
 *   node scripts/filters.js            use filters/cache/easylist.txt (download if missing)
 *   node scripts/filters.js --update   download the latest EasyList first
 *
 * Writes (commit these):
 *   src/rules/web-ads.json        ad servers to block (Chrome's built-in blocker)
 *   src/filters/hide-generic.css  ad boxes to hide on every site
 *   src/filters/hide-sites.json   ad boxes to hide on particular sites { "site.com": "css" }
 *   src/filters/no-generic.json   sites where EasyList says the generic hiding breaks things
 *
 * Careful by design: anything we don't fully understand is left out, so a filter can
 * never break a page. EasyList is © The EasyList authors, dual licensed GPLv3 and
 * CC BY-SA 3.0; the generated files are a derived work under the same licence.
 *
 * No dependencies: plain Node.js 18+.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE_URL = "https://easylist.to/easylist/easylist.txt";
const CACHE = path.join(ROOT, "filters", "cache", "easylist.txt");
const OUT = {
  rules: path.join(ROOT, "src", "rules", "web-ads.json"),
  generic: path.join(ROOT, "src", "filters", "hide-generic.css"),
  sites: path.join(ROOT, "src", "filters", "hide-sites.json"),
  noGeneric: path.join(ROOT, "src", "filters", "no-generic.json"),
};
const YOUTUBE = ["youtube.com", "youtube-nocookie.com", "youtu.be"]; // handled by PureFlow's YouTube engine

// PureFlow's own additions, in EasyList syntax: ads EasyList misses that people see a lot.
const EXTRA = [
  "||grow.me^$third-party",            // Mediavine Grow: the "Want fewer ads like this one?" bar and its widget
  "###fixed_container_bottom",         // Mediavine / Journey bottom bar (the dark strip at the bottom)
  "##.adhesion_wrapper",
  "##.mv-ad-box",
  "##[data-slot-rendered-adhesion]",
  "###google-anno-sa",                 // Google "ad intents": the floating "Browse Careers" bubble
  "##.google-anno-sc",                 // ...its chips in the text
  "##.goog-rentries",
  "##.google-anno > svg",              // ...the little icon on words it turned into ad links
  "##.ksc-in-con",                     // Kargo full-screen ad
];
// Words Google turned into ad links stay readable: just plain text again.
const EXTRA_CSS = "a.google-anno{color:inherit!important;text-decoration:none!important;pointer-events:none!important;cursor:text!important;background:none!important}\n";

// EasyList option -> Chrome resource type
const TYPES = {
  script: "script", image: "image", stylesheet: "stylesheet", css: "stylesheet",
  subdocument: "sub_frame", frame: "sub_frame", xmlhttprequest: "xmlhttprequest", xhr: "xmlhttprequest",
  media: "media", object: "object", ping: "ping", beacon: "ping", font: "font",
  websocket: "websocket", other: "other",
};
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * "||ads.example.com^$third-party,script,domain=a.com|~b.a.com" ->
 * { domain, key, condition } or null when the rule uses anything we don't support.
 */
function parseNetworkRule(line) {
  const m = /^(@@)?\|\|([a-z0-9.-]+)\^(?:\$(.*))?$/.exec(line);
  if (!m || !DOMAIN.test(m[2])) return null;
  const condition = {};
  const types = [], notTypes = [];
  for (const opt of (m[3] ? m[3].split(",") : [])) {
    const not = opt.startsWith("~");
    const name = not ? opt.slice(1) : opt;
    if (name === "third-party" || name === "3p") condition.domainType = not ? "firstParty" : "thirdParty";
    else if (name === "first-party" || name === "1p") condition.domainType = not ? "thirdParty" : "firstParty";
    else if (TYPES[name]) (not ? notTypes : types).push(TYPES[name]);
    else if (name.startsWith("domain=") && !not) {
      const include = [], exclude = [];
      for (const d of name.slice(7).split("|")) {
        const neg = d.startsWith("~");
        const host = neg ? d.slice(1) : d;
        if (!DOMAIN.test(host)) return null; // wildcards like example.*: skip the rule
        (neg ? exclude : include).push(host);
      }
      if (include.length) condition.initiatorDomains = include.sort();
      if (exclude.length) condition.excludedInitiatorDomains = exclude.sort();
    } else return null; // popup, csp, redirect, match-case...: not supported, skip
  }
  if (types.length) condition.resourceTypes = [...new Set(types)].sort();
  if (notTypes.length) condition.excludedResourceTypes = [...new Set(notTypes)].sort();
  return { allow: Boolean(m[1]), domain: m[2], key: JSON.stringify(condition), condition };
}

/** Domains that match host or one of its parents (a.b.c.com -> b.c.com, c.com). */
const parents = (host) => host.split(".").map((_, i, parts) => parts.slice(i).join(".")).slice(0, -1);

function convert(text) {
  const blocks = new Map();  // condition key -> { condition, domains:Set }
  const allows = new Map();
  const genericHide = new Set();
  const siteHide = new Map(); // site -> Set(selectors)
  const unhidden = new Set(); // selectors some site un-hides: never hide them everywhere
  const noGeneric = new Set(); // sites with $generichide / $elemhide exceptions
  const skipped = { network: 0, cosmetic: 0 };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;

    // Element hiding: "##sel" (every site), "a.com,b.com##sel" (those sites), "a.com#@#sel" (exception)
    const hide = /^([^#]*)(##|#@#)(.+)$/.exec(line);
    if (hide && !/#[?$%]#/.test(line)) {
      const [, domains, kind, selector] = hide;
      if (kind === "#@#") { unhidden.add(selector); continue; }
      // Extended syntax (scriptlets "+js(...)", HTML filters "^...", "sel {style}", procedural selectors): not CSS, skip.
      if (/[{}]|^\+js\(|^\^|:-abp-|:style\(|:remove\(|:has-text|:xpath|:upward|:matches-/.test(selector)) { skipped.cosmetic++; continue; }
      if (!domains) { genericHide.add(selector); continue; }
      const list = domains.split(",");
      if (list.some((d) => d.startsWith("~") || !DOMAIN.test(d))) { skipped.cosmetic++; continue; } // exceptions or wildcards
      for (const d of list) {
        if (YOUTUBE.some((y) => d === y || d.endsWith("." + y))) continue;
        if (!siteHide.has(d)) siteHide.set(d, new Set());
        siteHide.get(d).add(selector);
      }
      continue;
    }
    if (line.includes("#")) { skipped.cosmetic++; continue; } // scriptlets and other extended syntax

    // Sites where EasyList turns hiding off
    const off = /^@@\|\|([a-z0-9.-]+)\^\$(.*)$/.exec(line);
    if (off && off[2].split(",").some((o) => ["generichide", "ghide", "elemhide", "ehide", "document"].includes(o))) {
      if (DOMAIN.test(off[1])) noGeneric.add(off[1]);
      if (off[2].split(",").every((o) => ["generichide", "ghide", "elemhide", "ehide"].includes(o))) continue;
    }

    const rule = parseNetworkRule(line);
    if (!rule) { skipped.network++; continue; }
    const into = rule.allow ? allows : blocks;
    if (!into.has(rule.key)) into.set(rule.key, { condition: rule.condition, domains: new Set() });
    into.get(rule.key).domains.add(rule.domain);
  }

  // Network rules: one Chrome rule per set of options, listing all its domains.
  const rules = [];
  const add = (groups, action, priority) => {
    for (const { condition, domains } of groups.values()) {
      const requestDomains = [...domains].filter((d) => !YOUTUBE.some((y) => d === y || d.endsWith("." + y))).sort();
      if (!requestDomains.length) continue;
      const excluded = [...new Set([...(condition.excludedInitiatorDomains || []), ...YOUTUBE])].sort();
      rules.push({ id: rules.length + 1, priority, action: { type: action },
        condition: { ...condition, requestDomains, excludedInitiatorDomains: excluded } });
    }
  };
  add(blocks, "block", 1);
  add(allows, "allow", 2); // EasyList's own exceptions win over its blocks

  const generic = [...genericHide].filter((s) => !unhidden.has(s)).sort();
  const sites = Object.fromEntries([...siteHide.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([site, set]) => [site, [...set].filter((s) => !unhidden.has(s)).sort()])
    .filter(([, list]) => list.length));

  return { rules, generic, sites, noGeneric: [...noGeneric].sort(), skipped };
}

/** One CSS rule per selector: a selector the browser doesn't know only drops itself. */
const toCss = (selectors) => selectors.map((s) => `${s}{display:none!important}`).join("\n") + "\n";

async function main() {
  const update = process.argv.includes("--update");
  if (update || !fs.existsSync(CACHE)) {
    console.log(`downloading ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL, { headers: { "User-Agent": "PureFlow-filter-builder" } });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, await res.text());
  }
  const text = fs.readFileSync(CACHE, "utf8") + "\n" + EXTRA.join("\n");
  const version = /! Version: (\S+)/.exec(text)?.[1] || "unknown";
  const out = convert(text);

  fs.mkdirSync(path.dirname(OUT.generic), { recursive: true });
  fs.writeFileSync(OUT.rules, JSON.stringify(out.rules) + "\n");
  fs.writeFileSync(OUT.generic, `/* From EasyList ${version} (GPLv3 / CC BY-SA 3.0). Built by scripts/filters.js */\n` + toCss(out.generic) + EXTRA_CSS);
  fs.writeFileSync(OUT.sites, JSON.stringify(Object.fromEntries(Object.entries(out.sites).map(([k, v]) => [k, toCss(v)]))) + "\n");
  fs.writeFileSync(OUT.noGeneric, JSON.stringify(out.noGeneric) + "\n");
  const domains = out.rules.reduce((n, r) => n + r.condition.requestDomains.length, 0);
  console.log(`EasyList ${version}: ${out.rules.length} network rules (${domains} ad servers), ` +
    `${out.generic.length} boxes hidden everywhere, ${Object.keys(out.sites).length} sites with their own, ` +
    `${out.noGeneric.length} sites without generic hiding. Skipped: ${out.skipped.network} network, ${out.skipped.cosmetic} hiding.`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { convert, parseNetworkRule, parents, toCss };
