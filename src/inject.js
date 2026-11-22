/*
 * inject.js
 * Layer 3: remove the ad plan from YouTube's video data before the player reads it.
 *
 * Runs in the page's own JavaScript world ("MAIN") so it can wrap the functions
 * YouTube uses to load data: fetch, XMLHttpRequest and JSON.parse.
 *
 * It only cleans while <html data-yas="on"> is set (content/main.js owns that flag).
 * When the flag is gone, every call passes straight through, untouched.
 */
(() => {
  // These wrappers stay in the tab until it reloads, so install them only once.
  if (window.__yasInjectInstalled) return;
  window.__yasInjectInstalled = true;

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const DEBUG = false;
  const AD_KEYS = ["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"];
  const PLAYER_API = /\/youtubei\/v1\/(player|next)/; // video data requests
  const DEEP_CLEAN_LEVELS = 4; // how far inside player API answers we look

  const log = (...args) => DEBUG && console.log("[ad-skipper]", ...args);
  const isOn = () => document.documentElement.dataset.yas === "on";
  const isPlayerApi = (url) => PLAYER_API.test(url || "");

  // ---------------------------------------------------------------------------
  // Talking to the content script (it can't see this world, so we use DOM events)
  // ---------------------------------------------------------------------------
  const root = document.documentElement;
  const countedVideos = new Set(); // count each video's ads once, even if parsed twice

  /** Tell the content script which channel a video belongs to (for "support creators"). */
  function reportVideo(obj) {
    const d = obj.videoDetails;
    if (!d || !d.videoId || !d.channelId) return;
    const detail = JSON.stringify({ videoId: d.videoId, channelId: d.channelId, author: d.author });
    document.dispatchEvent(new CustomEvent("yas:video", { detail }));
  }

  /** Tell the content script how many ad breaks we removed (for the stats). */
  function reportRemoved(obj, adBreaks) {
    const id = (obj.videoDetails && obj.videoDetails.videoId) || "unknown";
    if (adBreaks <= 0 || countedVideos.has(id)) return;
    countedVideos.add(id);
    document.dispatchEvent(new CustomEvent("yas:ads-removed", { detail: String(adBreaks) }));
  }

  /** Is this video from a channel you chose to support? Then we keep its ads. */
  function isAllowedChannel(obj) {
    const id = obj.videoDetails && obj.videoDetails.channelId;
    return Boolean(id) && (root.dataset.yasAllow || "").split(",").includes(id);
  }

  // ---------------------------------------------------------------------------
  // Cleaner: the one place that knows what an "ad key" is.
  // ---------------------------------------------------------------------------
  function removeAds(obj, levels = 0) {
    if (!obj || typeof obj !== "object") return obj;
    reportVideo(obj);
    if (isAllowedChannel(obj)) return obj; // support this creator: keep the ads

    let adBreaks = 0;
    for (const key of AD_KEYS) {
      if (key in obj) {
        if (key === "adPlacements" && Array.isArray(obj[key])) adBreaks = obj[key].length;
        delete obj[key];
        log("removed", key);
      }
    }
    reportRemoved(obj, adBreaks);

    if (obj.playerResponse) removeAds(obj.playerResponse);
    if (levels > 0) {
      for (const value of Object.values(obj)) removeAds(value, levels - 1);
    }
    return obj;
  }

  const cleanIfOn = (obj, levels) => (isOn() ? removeAds(obj, levels) : obj);
  const nativeParse = JSON.parse;
  const cleanJsonText = (text) => JSON.stringify(removeAds(nativeParse(text), DEEP_CLEAN_LEVELS));

  // ---------------------------------------------------------------------------
  // Hook 1: data that comes inside the first page load.
  // ---------------------------------------------------------------------------
  function hookInitialData() {
    if (window.ytInitialPlayerResponse) {
      cleanIfOn(window.ytInitialPlayerResponse); // we started late: clean what is there
      return;
    }
    let value;
    try {
      Object.defineProperty(window, "ytInitialPlayerResponse", {
        configurable: true,
        get: () => value,
        set: (next) => { value = cleanIfOn(next); },
      });
    } catch (e) {
      log("could not hook ytInitialPlayerResponse", e);
    }
  }

  // ---------------------------------------------------------------------------
  // Hook 2: any JSON YouTube parses. Cheap: only a few key checks per object.
  // ---------------------------------------------------------------------------
  function hookJsonParse() {
    JSON.parse = function (...args) {
      return cleanIfOn(nativeParse.apply(this, args));
    };
  }

  // ---------------------------------------------------------------------------
  // Hook 3: video data loaded with fetch.
  // ---------------------------------------------------------------------------
  function hookFetch() {
    const nativeFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = input instanceof Request ? input.url : String(input);
      if (!isOn() || !isPlayerApi(url)) return nativeFetch.call(this, input, init);

      const response = await nativeFetch.call(this, input, init);
      try {
        const body = cleanJsonText(await response.clone().text());
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (e) {
        return response; // not JSON or something odd: give back the original
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Hook 4: video data loaded with XMLHttpRequest (older code paths).
  // ---------------------------------------------------------------------------
  function hookXhr() {
    const proto = XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    proto.open = function (method, url, ...rest) {
      this.__yasUrl = String(url);
      return nativeOpen.call(this, method, url, ...rest);
    };

    for (const prop of ["responseText", "response"]) {
      const native = Object.getOwnPropertyDescriptor(proto, prop);
      if (!native || !native.get) continue;
      Object.defineProperty(proto, prop, {
        configurable: true,
        get() {
          const value = native.get.call(this);
          if (!isOn() || this.readyState !== 4 || !isPlayerApi(this.__yasUrl)) return value;
          try {
            if (typeof value === "string") return cleanJsonText(value);
            if (value && typeof value === "object") return removeAds(value, DEEP_CLEAN_LEVELS);
          } catch (e) { /* not JSON: leave it */ }
          return value;
        },
      });
    }
  }

  hookInitialData();
  hookJsonParse();
  hookFetch();
  hookXhr();
  log("data cleaner ready");
})();
