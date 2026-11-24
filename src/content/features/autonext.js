/*
 * content/features/autonext.js
 * Play the next video right away.
 *
 * When a video ends with YouTube's Autoplay switched on, YouTube shows "Up next in 8"
 * over a black player and waits. That wait (3 to 9 seconds) is the black screen
 * between videos. We press YouTube's own "Play now" button as soon as it appears,
 * so the next video starts in about 1 second.
 *
 * Only does anything when YouTube's Autoplay switch is on: we never start a video
 * you didn't ask for. Nothing runs between videos: we only look for ~3s after "ended".
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const LOOK_FOR_MS = 3000;
  const LOOK_EVERY_MS = 100;
  const AUTOPLAY_ON = '.ytp-autonav-toggle-button[aria-checked="true"]';
  const COUNTDOWN = ".ytp-autonav-endscreen-countdown-overlay";
  const PLAY_NOW = ".ytp-autonav-endscreen-upnext-play-button";

  let timer = null;

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  function tryPlayNext(player, video, startedAt) {
    if (Date.now() - startedAt > LOOK_FOR_MS || !video.ended) return stop();
    if (!player.querySelector(AUTOPLAY_ON)) return stop(); // Autoplay is off: respect that
    const overlay = player.querySelector(COUNTDOWN);
    const button = player.querySelector(PLAY_NOW);
    if (!overlay || !button || getComputedStyle(overlay).display === "none") return; // not shown yet
    stop();
    button.click();
  }

  YAS.autonext = {
    /** Call when your video ends. */
    onEnded(player, video) {
      stop();
      const startedAt = Date.now();
      timer = setInterval(() => tryPlayNext(player, video, startedAt), LOOK_EVERY_MS);
      tryPlayNext(player, video, startedAt);
    },
    stop,
  };
})();
