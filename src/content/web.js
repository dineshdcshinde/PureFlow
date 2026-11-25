/*
 * content/web.js
 * Runs on every website except YouTube (when "Block ads on other websites" is on).
 * Ad servers are already blocked by Chrome's built-in blocker, and the common ad boxes
 * are hidden by filters/hide-generic.css. This only asks background.js to add the
 * hiding rules EasyList has for this particular site. Nothing else, nothing sent out.
 */
(() => {
  if (globalThis.__pureflowWeb || !/^https?:$/.test(location.protocol) || !location.hostname) return;
  globalThis.__pureflowWeb = true;
  try {
    chrome.runtime.sendMessage({ type: "site-hide", host: location.hostname }).catch(() => {});
  } catch (e) { /* extension reloaded: nothing to do */ }
})();
