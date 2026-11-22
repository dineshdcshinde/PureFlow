/*
 * background.js
 * Chrome only adds content scripts when a page loads. So when the extension starts
 * (installed, reloaded, switched back on, or Chrome opens), we add them to every
 * YouTube tab that is already open. No reload needed.
 *
 * The file lists must match the "content_scripts" section of manifest.json.
 */
const YOUTUBE_TABS = ["*://www.youtube.com/*", "*://m.youtube.com/*"];
const CONTENT_FILES = ["content/overlay.js", "content/ads.js", "content/main.js"];
const PAGE_FILES = ["inject.js"];
const CSS_FILES = ["hide.css"];

async function addToTab(tabId) {
  // Content scripts first: they switch the tab "on", which inject.js reads.
  await chrome.scripting.insertCSS({ target: { tabId }, files: CSS_FILES });
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: PAGE_FILES,
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

chrome.runtime.onInstalled.addListener(addToOpenTabs);
chrome.runtime.onStartup.addListener(addToOpenTabs);
addToOpenTabs(); // also runs when the extension is switched back on
