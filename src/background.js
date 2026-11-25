/*
 * background.js
 * Chrome, Edge and Firefox only add content scripts when a page loads. So when the
 * extension starts (installed, reloaded, switched back on, browser opened), we add
 * them to every YouTube tab that is already open. No reload needed.
 *
 * The file lists come straight from manifest.json, so there is one source of truth.
 */
const YOUTUBE_TABS = ["*://www.youtube.com/*", "*://m.youtube.com/*"];

/** Read what manifest.json injects, so this file never needs updating by hand. */
function contentScriptsFromManifest() {
  const scripts = chrome.runtime.getManifest().content_scripts || [];
  const isolated = scripts.find((s) => s.world !== "MAIN") || {};
  const page = scripts.find((s) => s.world === "MAIN") || {};
  return { css: isolated.css || [], content: isolated.js || [], page: page.js || [] };
}

async function addToTab(tabId) {
  const files = contentScriptsFromManifest();
  // Content scripts first: they switch the tab "on", which inject.js reads.
  if (files.css.length) await chrome.scripting.insertCSS({ target: { tabId }, files: files.css });
  await chrome.scripting.executeScript({ target: { tabId }, files: files.content });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: files.page,
    world: "MAIN",
  });
}

async function addToOpenTabs() {
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TABS });
  for (const tab of tabs) {
    // A tab can be closed, loading or an error page. That's fine: skip it.
    addToTab(tab.id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Support creators: in a tab showing an allowed channel, let ad requests through.
// A "session" rule lives only until the browser closes and only covers that one tab.
// ---------------------------------------------------------------------------
const ALLOW_PRIORITY = 100; // higher than the block rules in rules/ads.json (priority 1)
const ruleIdFor = (tabId) => tabId; // tab ids are unique positive numbers

async function setAdsAllowedInTab(tabId, allow) {
  const id = ruleIdFor(tabId);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: allow
      ? [{ id, priority: ALLOW_PRIORITY, action: { type: "allow" }, condition: { tabIds: [tabId] } }]
      : [],
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "allow-ads-in-tab" && sender.tab?.id > 0) {
    setAdsAllowedInTab(sender.tab.id, Boolean(message.allow)).catch(() => {});
  }
});
chrome.tabs.onRemoved.addListener((tabId) => setAdsAllowedInTab(tabId, false).catch(() => {}));

chrome.runtime.onInstalled.addListener(addToOpenTabs);
chrome.runtime.onStartup.addListener(addToOpenTabs);
addToOpenTabs(); // also runs when the extension is switched back on

// ---------------------------------------------------------------------------
// Files for the parts PureFlow draws on YouTube (content/assets.js): the settings page
// for the "All settings" panel, and the icon. Sent as text and data: URLs, so websites
// never need (or get) access to any PureFlow file.
// ---------------------------------------------------------------------------
async function readText(file) {
  return (await fetch(chrome.runtime.getURL(file))).text();
}
async function readDataUrl(file) {
  const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL(file))).arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(binary)}`;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "assets" || !(sender.tab?.id > 0)) return;
  Promise.all([readText("popup/popup.html"), readText("popup/popup.css"), readDataUrl("icons/icon-16.png"), readDataUrl("icons/icon-32.png")])
    .then(([html, css, icon16, icon32]) => reply({ html, css, icon16, icon32 }), () => reply(null));
  return true; // answering later
});

// ---------------------------------------------------------------------------
// Every other website: block ad servers (rules/web-ads.json) and hide the empty ad
// boxes (filters/). Built from EasyList by scripts/filters.js. YouTube keeps its own
// engine above. Follows the pause switch, "Block ads on other websites", and the
// sites you allowed ads on.
// ---------------------------------------------------------------------------
const WEB = {
  ruleset: "web_ads",
  allowRuleId: 1, // dynamic rule: the sites you allowed ads on
  css: "pf-web-hide",
  js: "pf-web-sites",
};
const YOUTUBE_PAGES = ["*://*.youtube.com/*", "*://youtube.com/*", "*://*.youtube-nocookie.com/*"];
const sitePatterns = (site) => [`*://${site}/*`, `*://*.${site}/*`];
const readJson = (file) => fetch(chrome.runtime.getURL(file)).then((r) => r.json());
let siteHiding = null; // { "site.com": "css" }, loaded the first time a page asks

async function webSettings() {
  const s = await chrome.storage.sync.get({ enabled: true, webBlock: true, allowedSites: {} });
  return { on: Boolean(s.enabled && s.webBlock), allowed: Object.keys(s.allowedSites || {}).sort() };
}

async function applyWebBlocking() {
  const { on, allowed } = await webSettings();
  const dnr = chrome.declarativeNetRequest;
  await dnr.updateEnabledRulesets(on ? { enableRulesetIds: [WEB.ruleset] } : { disableRulesetIds: [WEB.ruleset] });
  await dnr.updateDynamicRules({
    removeRuleIds: [WEB.allowRuleId],
    addRules: on && allowed.length ? [{
      id: WEB.allowRuleId, priority: 1000, action: { type: "allowAllRequests" },
      condition: { requestDomains: allowed, resourceTypes: ["main_frame", "sub_frame"] },
    }] : [],
  });

  const registered = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
  const ours = registered.filter((id) => id === WEB.css || id === WEB.js);
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
  if (!on) return;
  const skip = [...YOUTUBE_PAGES, ...allowed.flatMap(sitePatterns)];
  const noGeneric = await readJson("filters/no-generic.json").catch(() => []);
  await chrome.scripting.registerContentScripts([
    { id: WEB.css, matches: ["<all_urls>"], excludeMatches: [...skip, ...noGeneric.flatMap(sitePatterns)],
      css: ["filters/hide-generic.css"], runAt: "document_start", allFrames: true },
    { id: WEB.js, matches: ["<all_urls>"], excludeMatches: skip,
      js: ["content/web.js"], runAt: "document_start", allFrames: true },
  ]);
}

// One change at a time, in order (settings can change quickly).
let webQueue = Promise.resolve();
const updateWeb = () => { webQueue = webQueue.then(applyWebBlocking).catch(() => {}); return webQueue; };

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.enabled || changes.webBlock || changes.allowedSites)) updateWeb();
});
chrome.runtime.onInstalled.addListener(updateWeb);
chrome.runtime.onStartup.addListener(updateWeb);
updateWeb();

/** host and its parent domains: "a.b.news.com" -> a.b.news.com, b.news.com, news.com, com */
const domainsOf = (host) => String(host || "").toLowerCase().split(".").map((_, i, p) => p.slice(i).join("."));

/** The ad-box rules EasyList has for this site (and its parent domains), as CSS. */
async function siteCss(host) {
  siteHiding ??= await readJson("filters/hide-sites.json");
  return domainsOf(host).map((d) => siteHiding[d]).filter(Boolean).join("");
}

/** Hide the ad boxes in an open tab right now, without a reload (all its frames). */
async function hideAdsInTab(tabId, host) {
  const target = { tabId, allFrames: true };
  const noGeneric = await readJson("filters/no-generic.json").catch(() => []);
  const jobs = [];
  if (!domainsOf(host).some((d) => noGeneric.includes(d))) {
    jobs.push(chrome.scripting.insertCSS({ target, files: ["filters/hide-generic.css"] }));
  }
  const css = await siteCss(host);
  if (css) jobs.push(chrome.scripting.insertCSS({ target, css }));
  jobs.push(removeLoadedAds(tabId));
  await Promise.all(jobs);
}

/** Ad servers blocked everywhere (no "only on site X" condition), loaded once. */
let adServers = null;
async function adServerSet() {
  adServers ??= readJson("rules/web-ads.json").then((rules) => new Set(rules
    .filter((r) => r.action.type === "block" && !r.condition.initiatorDomains)
    .flatMap((r) => r.condition.requestDomains)));
  return adServers;
}

/**
 * Runs inside the page (every frame). Ads that already loaded before you switched
 * blocking on: Google's boxes, its bottom bar and its full-screen "vignette" set their
 * own `display: block !important`, which no style sheet can override. So we hide them
 * on the element itself. Returns the address of every frame on the page, so the
 * background can tell which ones come from ad servers.
 */
function pageHideAds(adIframeHosts) {
  const hide = (el) => el.style.setProperty("display", "none", "important");
  const AD_BOXES = [
    "ins.adsbygoogle", "[id^='google_ads_iframe']", "[id^='aswift_']", "div[id^='div-gpt-ad']",
    "[data-google-query-id]", "iframe[src*='googlesyndication.com']", "iframe[src*='doubleclick.net']",
    "iframe[src*='amazon-adsystem.com']", "iframe[id^='google_ads']", "[data-ad-slot]",
    "#fixed_container_bottom", ".adhesion_wrapper", ".mv-ad-box", ".adunitwrapper", // Mediavine / Journey
    "#google-anno-sa", ".google-anno-sc", ".goog-rentries", ".ksc-in-con", // Google ad intents, Kargo
  ].join(",");
  const boxOf = (el) => el.closest("ins.adsbygoogle, div[id^='div-gpt-ad'], [data-google-query-id]") || el;
  // Words Google turned into ad links ("Job", "Career"): back to plain text.
  document.querySelectorAll("a.google-anno").forEach((a) => a.replaceWith(document.createTextNode(a.textContent)));
  const boxes = document.querySelectorAll(AD_BOXES);
  boxes.forEach((el) => hide(boxOf(el)));
  // Google's full-screen vignette also locks page scrolling: give it back.
  if (boxes.length) for (const el of [document.documentElement, document.body]) if (el?.style.overflow === "hidden") el.style.overflow = "";
  const frames = [...document.querySelectorAll("iframe")];
  if (adIframeHosts) {
    const ads = new Set(adIframeHosts);
    frames.forEach((f) => {
      try { if (ads.has(new URL(f.src, location.href).hostname)) hide(boxOf(f)); } catch (e) { /* no address */ }
    });
    return null;
  }
  return frames.map((f) => { try { return new URL(f.src, location.href).hostname; } catch (e) { return ""; } }).filter(Boolean);
}

/** Hide ads already on the page: known ad boxes, and frames loaded from ad servers. */
async function removeLoadedAds(tabId) {
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: pageHideAds, args: [null] });
  const servers = await adServerSet();
  const isAd = (host) => domainsOf(host).some((d) => servers.has(d));
  for (const r of results || []) {
    const adHosts = [...new Set((r.result || []).filter(isAd))];
    if (adHosts.length) {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [r.frameId] }, func: pageHideAds, args: [adHosts] }).catch(() => {});
    }
  }
}

/**
 * The popup's "Block ads on <site>" switch. Applied straight away:
 *  on:  save, update the blocker, and hide the ads already on the page (no reload)
 *  off: save, update the blocker, and reload the page so the site's own ads load
 * Only PureFlow's own pages (the popup) may ask: never a website.
 */
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "web-site" || sender.id !== chrome.runtime.id || sender.tab) return;
  const site = String(message.site || "").toLowerCase();
  const tabId = Number(message.tabId);
  if (!/^[a-z0-9.-]+$/.test(site)) return reply(false);
  (async () => {
    const s = await chrome.storage.sync.get({ enabled: true, webBlock: true, allowedSites: {} });
    const allowedSites = { ...s.allowedSites };
    const next = { allowedSites };
    if (message.block) {
      delete allowedSites[site];
      if (!s.enabled) next.enabled = true;   // one switch on this view: turning it on means "block here"
      if (!s.webBlock) next.webBlock = true;
    } else {
      allowedSites[site] = true;
    }
    await chrome.storage.sync.set(next);
    await updateWeb(); // the blocker is up to date before we touch the page
    if (tabId > 0) {
      if (message.block) await hideAdsInTab(tabId, message.host || site).catch(() => {});
      else await chrome.tabs.reload(tabId).catch(() => {});
    }
    reply(true);
  })().catch(() => reply(false));
  return true;
});

/** content/web.js on a page: add the hiding rules EasyList has for that site. */
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "site-hide" || !(sender.tab?.id > 0)) return;
  (async () => {
    const css = await siteCss(message.host);
    if (css) {
      await chrome.scripting.insertCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, css });
    }
    reply(Boolean(css));
  })().catch(() => reply(false));
  return true;
});
