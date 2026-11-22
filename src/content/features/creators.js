/*
 * content/features/creators.js
 * Support creators: let ads play on channels you choose.
 *
 * How the pieces talk:
 *   - We put the allowed channel ids on <html data-yas-allow="id1,id2">.
 *     inject.js reads it and does not remove ads from those channels' videos.
 *   - inject.js tells us which channel each video belongs to (event "yas:video").
 *   - If the video you're watching is from an allowed channel, we set
 *     <html data-yas-allowed-now>, so hide.css and the skipper leave its ads alone,
 *     and ask background.js to let ad requests through in this tab.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const videos = new Map(); // videoId -> { channelId, author }
  let allowed = {};         // { channelId: name }
  let allowedNow = false;
  let onAllowedChange = () => {}; // set by main.js: re-check a playing ad

  const root = document.documentElement;
  const currentVideoId = () => new URLSearchParams(location.search).get("v");

  function tellBackground(allow) {
    try {
      chrome.runtime.sendMessage({ type: "allow-ads-in-tab", allow }).catch?.(() => {});
    } catch (e) { /* extension switched off */ }
  }

  function refresh() {
    const info = videos.get(currentVideoId());
    const now = Boolean(info && allowed[info.channelId]);
    root.toggleAttribute("data-yas-allowed-now", now);
    if (now !== allowedNow) {
      allowedNow = now;
      tellBackground(now);
      onAllowedChange();
    }
  }

  /** inject.js reports each video's channel. detail is a JSON string. */
  function onVideoInfo(event) {
    try {
      const { videoId, channelId, author } = JSON.parse(event.detail);
      if (videoId && channelId) videos.set(videoId, { channelId, author });
      refresh();
    } catch (e) { /* bad data: ignore */ }
  }

  YAS.creators = {
    start(onChange) {
      onAllowedChange = onChange || onAllowedChange;
      document.addEventListener("yas:video", onVideoInfo);
      document.addEventListener("yt-navigate-finish", refresh);
    },

    stop() {
      document.removeEventListener("yas:video", onVideoInfo);
      document.removeEventListener("yt-navigate-finish", refresh);
      root.removeAttribute("data-yas-allow");
      root.removeAttribute("data-yas-allowed-now");
      if (allowedNow) tellBackground(false);
      allowedNow = false;
    },

    setAllowed(channels) {
      allowed = channels || {};
      root.dataset.yasAllow = Object.keys(allowed).join(",");
      refresh();
    },

    /** Is the video on screen from an allowed channel? (then: don't skip its ads) */
    isAllowedNow: () => allowedNow,

    /** For the popup: which channel is on screen right now? */
    current() {
      const info = videos.get(currentVideoId());
      return info ? { ...info, allowed: Boolean(allowed[info.channelId]) } : null;
    },
  };
})();
