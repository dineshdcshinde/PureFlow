/*
 * content/main.js
 * The coordinator. Decides WHEN to skip and WHEN to show a message.
 *
 * When the message shows (and only then):
 *   1. An ad is in the player (YouTube's ad mode). We hide it, so we explain the black.
 *   2. The extension was just switched on in a tab that was already open, and the
 *      video is stuck for more than 2 seconds. That is the "ad YouTube planned while
 *      we were off" case.
 * Normal next / previous / page changes never show a message.
 *
 * Also the on/off switch for this tab: sets <html data-yas="on">, which hide.css and
 * inject.js both read, and cleans everything up when the extension is turned off.
 */
(() => {
  const YAS = globalThis.YAS;
  const { overlay, ads } = YAS;

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const DEBUG = false;
  const TEXT = {
    title: "Ad blocked by YT Ad Skipper",
    skipping: "Skipping the ad, your video starts in a moment",
    waiting: (s) => `YouTube is holding your video for its ad timer (${s}s). It will start by itself.`,
    startingTitle: "YT Ad Skipper is now on",
    starting: (s) => `Clearing an ad YouTube planned while it was off (${s}s)...`,
  };
  const AD_TICK_MS = 100;           // how often we retry skipping during an ad
  const LATE_START_WINDOW_MS = 15000; // how long after switching on we watch for stuck videos
  const LATE_START_TICK_MS = 250;
  const STUCK_BEFORE_MESSAGE_MS = 2000;
  const ALIVE_CHECK_MS = 1000;

  const log = (...args) => DEBUG && console.log("[YT Ad Skipper]", ...args);
  const root = document.documentElement;
  const seconds = (since) => Math.round((Date.now() - since) / 1000);

  // ---------------------------------------------------------------------------
  // Single instance per tab.
  // If the extension is reloaded or switched off/on, a new copy of this script is
  // added to open tabs. The newest copy takes over; older copies shut themselves down.
  // ---------------------------------------------------------------------------
  if (YAS.isActive?.()) return;
  const me = Symbol("yas");
  YAS.owner = me;
  const isOwner = () => YAS.owner === me;
  const extensionAlive = () => {
    try { return Boolean(chrome.runtime?.id); } catch (e) { return false; }
  };
  YAS.isActive = () => isOwner() && extensionAlive();

  // "Late start" = we were added to an already-loaded tab (switched on, reloaded).
  const startedLate = document.readyState !== "loading";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    player: null,
    playerObserver: null,
    yourVideoSource: "",  // the real video you were watching (never fast-forwarded)
    ad: null,             // { startedAt, timer, undo } while an ad is in the player
    lateStart: null,      // { until, timer, stuckSince } right after switching on
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const videoOf = (player) => player?.querySelector("video");
  const onWatchPage = () => location.pathname === "/watch";

  /** True when the video has not shown a frame yet but is trying to play. */
  function isStuck(player) {
    const video = videoOf(player);
    if (!video || video.currentTime >= 0.2) return false;
    return player.classList.contains("buffering-mode") || !video.paused;
  }

  /** YouTube's own "Experiencing interruptions?" popup. Our message already explains. */
  function hideYouTubeInterruptionPopup() {
    for (const el of document.querySelectorAll("tp-yt-paper-toast, yt-notification-action-renderer")) {
      if (/interruption/i.test(el.textContent || "")) el.style.display = "none";
    }
  }

  // ---------------------------------------------------------------------------
  // Case 1: an ad is in the player
  // ---------------------------------------------------------------------------
  function startAd(player) {
    stopLateStartWatch();
    state.ad = { startedAt: Date.now(), timer: null, undo: null };
    log("ad found");
    tickAd(player);
    state.ad.timer = setInterval(() => tickAd(player), AD_TICK_MS);
  }

  function tickAd(player) {
    const ad = state.ad;
    if (!ad) return;
    const video = videoOf(player);

    if (video && ads.isAdVideo(video, state.yourVideoSource)) {
      const undo = ads.fastForward(video);
      ad.undo ??= undo; // keep the first one: it remembers your real sound and speed
      overlay.show(player, TEXT.title, TEXT.skipping);
    } else {
      overlay.show(player, TEXT.title, TEXT.waiting(seconds(ad.startedAt)));
    }
    ads.clickSkip();
    hideYouTubeInterruptionPopup();
  }

  function endAd() {
    if (!state.ad) return;
    clearInterval(state.ad.timer);
    state.ad.undo?.();
    state.ad = null;
    overlay.hide();
    // Never leave a video stuck at 16x.
    const video = videoOf(state.player);
    if (video && video.playbackRate === 16) video.playbackRate = 1;
    log("ad ended");
  }

  // ---------------------------------------------------------------------------
  // Case 2: just switched on in an open tab, and the video is stuck
  // ---------------------------------------------------------------------------
  function startLateStartWatch() {
    state.lateStart = {
      until: Date.now() + LATE_START_WINDOW_MS,
      stuckSince: null,
      timer: setInterval(tickLateStart, LATE_START_TICK_MS),
    };
  }

  function tickLateStart() {
    const watch = state.lateStart;
    const player = state.player;
    if (!watch) return;
    if (Date.now() > watch.until) return stopLateStartWatch();
    if (!player || state.ad || !onWatchPage()) return;

    if (!isStuck(player)) {
      watch.stuckSince = null;
      overlay.hide();
      return;
    }
    watch.stuckSince ??= Date.now();
    if (Date.now() - watch.stuckSince >= STUCK_BEFORE_MESSAGE_MS) {
      overlay.show(player, TEXT.startingTitle, TEXT.starting(seconds(watch.stuckSince)));
      hideYouTubeInterruptionPopup();
    }
  }

  function stopLateStartWatch() {
    if (!state.lateStart) return;
    clearInterval(state.lateStart.timer);
    state.lateStart = null;
    if (!state.ad) overlay.hide();
  }

  // ---------------------------------------------------------------------------
  // Player watching
  // ---------------------------------------------------------------------------
  function onPlayerClassChange() {
    const player = state.player;
    const adNow = ads.isPlaying(player);
    if (adNow && !state.ad) startAd(player);
    else if (!adNow && state.ad) endAd();
  }

  function attachToPlayer() {
    const player = document.querySelector("#movie_player");
    if (!player || player === state.player) return Boolean(player);
    state.playerObserver?.disconnect();
    state.player = player;
    state.playerObserver = new MutationObserver(onPlayerClassChange);
    state.playerObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
    onPlayerClassChange();
    return true;
  }

  /** Remember the real video while it plays without an ad. */
  function onTimeUpdate(event) {
    const player = state.player;
    if (!player || state.ad || !player.contains(event.target)) return;
    if (event.target.currentTime > 0.5) state.yourVideoSource = ads.sourceOf(event.target);
  }

  // ---------------------------------------------------------------------------
  // On / off
  // ---------------------------------------------------------------------------
  let waitForPlayer = null;
  let aliveTimer = null;

  function turnOn() {
    root.dataset.yas = "on";
    if (!attachToPlayer()) {
      waitForPlayer = new MutationObserver(() => attachToPlayer() && waitForPlayer.disconnect());
      waitForPlayer.observe(root, { childList: true, subtree: true });
    }
    document.addEventListener("yt-navigate-finish", attachToPlayer);
    document.addEventListener("timeupdate", onTimeUpdate, true);
    if (startedLate) startLateStartWatch();
    aliveTimer = setInterval(checkAlive, ALIVE_CHECK_MS);
    log("on", startedLate ? "(late start)" : "");
  }

  function turnOff() {
    clearInterval(aliveTimer);
    endAd();
    stopLateStartWatch();
    waitForPlayer?.disconnect();
    state.playerObserver?.disconnect();
    document.removeEventListener("yt-navigate-finish", attachToPlayer);
    document.removeEventListener("timeupdate", onTimeUpdate, true);
    if (isOwner()) {
      overlay.destroy();
      delete root.dataset.yas; // hide.css and inject.js stop working instantly
    }
    log("off");
  }

  function checkAlive() {
    if (!extensionAlive() || !isOwner()) return turnOff();
    // An older copy may have switched the tab off while shutting down. Fix that.
    if (root.dataset.yas !== "on") root.dataset.yas = "on";
  }

  turnOn();
})();
