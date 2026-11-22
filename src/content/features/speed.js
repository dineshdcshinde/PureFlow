/*
 * content/features/speed.js
 * Default playback speed.
 *   - Picking a speed in the popup changes the video you're watching right away.
 *   - Every new video starts at that speed.
 *   - If you change the speed by hand during a video, we leave it alone.
 *   - Never touches an ad.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  let speed = 0;            // 0 = off (YouTube's normal speed)
  let appliedFor = null;    // the video id we already set the speed for

  const videoId = () => new URLSearchParams(location.search).get("v");

  function apply(video) {
    appliedFor = videoId();
    video.playbackRate = speed || 1;
  }

  YAS.speed = {
    /**
     * New choice from the popup. Applies to the current video immediately
     * (if one is open and no ad is playing). Choosing "Off" goes back to 1x.
     */
    setSpeed(value, video, adIsPlaying, { now = false } = {}) {
      const next = Number(value) || 0;
      const changed = next !== speed;
      speed = next;
      appliedFor = null;
      if (!video || adIsPlaying || !videoId()) return;
      // "now": you tapped a speed in the popup, so change the video this instant.
      // Otherwise (settings synced in) only touch a video that is already playing;
      // a loading video gets it from onPlaying(), so YouTube can't reset it while loading.
      const playing = !video.paused && video.currentTime > 0;
      const loaded = video.readyState > 0;
      if ((now && loaded) || (changed && playing)) apply(video);
    },

    /** Call on "playing". Sets the speed once per new video, never during an ad. */
    onPlaying(video, adIsPlaying) {
      const id = videoId();
      if (!speed || adIsPlaying || !id || appliedFor === id) return;
      apply(video);
    },
  };
})();
