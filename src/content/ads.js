/*
 * content/ads.js
 * Layer 4: everything about an ad that is already in the player.
 * Small, pure-ish helpers. No timers and no UI here; content/main.js drives them.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  // Only used when we don't yet know which video is yours (e.g. an ad before the
  // first video of a fresh page). Then anything longer could be your video.
  const MAX_UNKNOWN_AD_SECONDS = 180;
  const SKIP_BUTTONS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container button",
    ".video-ads button[class*='skip']",
  ].join(", ");

  const sourceOf = (video) => video.currentSrc || video.src || "";

  YAS.ads = {
    /** True while YouTube is in ad mode. */
    isPlaying(player) {
      return player.classList.contains("ad-showing");
    },

    /**
     * True only if this <video> is the ad itself (safe to jump to its end).
     * - We know your video's source and this one is different: it's the ad, any length.
     * - We don't know yours yet: only short ones (could otherwise be your video).
     * - Same source as yours: it's YOUR video paused under a picture ad. Hands off.
     */
    isAdVideo(video, yourVideoSource) {
      const src = sourceOf(video);
      if (!src || src === yourVideoSource) return false;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
      return Boolean(yourVideoSource) || video.duration <= MAX_UNKNOWN_AD_SECONDS;
    },

    /**
     * The moment an ad shows: no sound, top speed. Safe for any video because it is
     * fully undone when the ad ends. Returns the function that undoes it.
     */
    silence(video) {
      const before = { muted: video.muted, rate: video.playbackRate };
      video.muted = true;
      video.playbackRate = 16;
      return () => {
        video.muted = before.muted;
        video.playbackRate = before.rate;
      };
    },

    /** Keep the ad silent and fast, and jump to its end. Only for a confirmed ad video. */
    jumpToEnd(video) {
      video.muted = true;
      video.playbackRate = 16;
      video.currentTime = video.duration;
    },

    /** Click YouTube's Skip button if it is there. */
    clickSkip() {
      document.querySelector(SKIP_BUTTONS)?.click();
    },

    sourceOf,
  };
})();
