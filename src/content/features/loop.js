/*
 * content/features/loop.js
 * Loop part of a video (A to B).
 *   1st press: loop starts here (A)
 *   2nd press: loop ends here (B), and the part repeats
 *   3rd press: loop off
 * Cleared automatically when you open another video.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const MIN_LENGTH = 1;  // seconds; a shorter loop would just stutter
  const END_GAP = 0.35;  // seconds; loop back this long before the video's very end

  let loop = { id: null, start: null, end: null };
  const videoId = () => new URLSearchParams(location.search).get("v");

  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }

  /** Is the saved loop for the video on screen? */
  const isCurrent = () => loop.id !== null && loop.id === videoId();

  YAS.loop = {
    /** One press of the loop button or Shift+L. Returns the message to show. */
    step(video) {
      const t = video.currentTime;
      if (!isCurrent() || loop.start === null) {
        loop = { id: videoId(), start: t, end: null };
        return `Loop from ${clock(t)}. Press again to set the end`;
      }
      if (loop.end === null) {
        if (Math.abs(t - loop.start) < MIN_LENGTH) { // pressed twice in the same spot
          loop = { id: null, start: null, end: null };
          return "Loop off";
        }
        // You went back before the start and pressed again: loop between the two anyway.
        const [start, end] = t < loop.start ? [t, loop.start] : [loop.start, t];
        // Stop a little before the very end, so the video never "ends" (YouTube would
        // pause or move on to the next video instead of repeating).
        const last = Number.isFinite(video.duration) ? video.duration - END_GAP : end;
        loop.start = start;
        loop.end = Math.max(start + MIN_LENGTH / 2, Math.min(end, last));
        video.currentTime = loop.start;
        return `Looping ${clock(loop.start)} – ${clock(end)}`;
      }
      loop = { id: null, start: null, end: null };
      return "Loop off";
    },

    /** Call on "timeupdate": back to the start once we pass the end. */
    check(video) {
      if (!isCurrent() || loop.end === null) return;
      if (video.currentTime < loop.end && !video.ended) return;
      const stopped = video.ended;
      video.currentTime = loop.start;
      if (stopped) {
        try { video.play()?.catch?.(() => {}); } catch (e) { /* the player will resume on its own */ }
      }
    },

    /** "off", "start" (A set, waiting for B) or "on". For the player button. */
    status() {
      if (!isCurrent() || loop.start === null) return "off";
      return loop.end === null ? "start" : "on";
    },

    clear() { loop = { id: null, start: null, end: null }; },
    clock,
  };
})();
