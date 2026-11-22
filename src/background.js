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
