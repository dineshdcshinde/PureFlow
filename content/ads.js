/*
 * content/ads.js
 * Layer 4: everything about an ad that is already in the player.
 * Small, pure-ish helpers. No timers and no UI here; content/main.js drives them.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const MAX_AD_SECONDS = 180; // never fast-forward anything longer: it may be your video
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
     * True only if this <video> is the ad itself.
     * Picture ads keep YOUR video paused underneath, so we compare it with the
     * source of the last video you were really watching and never touch that one.
     */
    isAdVideo(video, yourVideoSource) {
      const src = sourceOf(video);
      if (!src || src === yourVideoSource) return false;
      return Number.isFinite(video.duration) && video.duration > 0 && video.duration <= MAX_AD_SECONDS;
    },

    /** Mute, speed up and jump to the end. Returns a function that undoes it. */
    fastForward(video) {
      const before = { muted: video.muted, rate: video.playbackRate };
      video.muted = true;
      video.playbackRate = 16;
      video.currentTime = video.duration;
      return () => {
        video.muted = before.muted;
        video.playbackRate = before.rate;
      };
    },

    /** Click YouTube's Skip button if it is there. */
    clickSkip() {
      document.querySelector(SKIP_BUTTONS)?.click();
    },

    sourceOf,
  };
})();
