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
 * Speed: a picture ad can't be fast-forwarded, and a stuck video after switching on
 * can sit on black for a long time. In both cases we reload the video once, clean,
 * which takes 1 to 2 seconds instead of waiting out YouTube's timer.
 *
 * Features (each in content/features/, wired up here):
 *   focus mode, default speed and quality, sponsor skip, support creators, stats,
 *   play next right away, loop, screenshot, wheel volume, shortcuts, player buttons,
 *   and the floating PureFlow button (one row of quick controls).
 *
 * Also the on/off switch for this tab: sets <html data-yas="on">, which hide.css and
 * inject.js both read, and cleans everything up when the extension is turned off.
 */
(() => {
  const YAS = globalThis.YAS;
  const { overlay, ads, settings, stats, focus, speed, sponsor, creators,
    quality, autonext, loop, screenshot, controls, notices, dock, panel } = YAS;

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const DEBUG = false;
  // Every word the user sees lives here, so it's easy to change in one place.
  const APP = globalThis.YAS_BRAND?.name || "Ad Skipper"; // set by brand.js (from brand.json)
  const TEXT = {
    skippedTitle: "Ad skipped",
    skippedDetail: "Your video is up next",
    clearingTitle: "Ad blocked",
    clearingDetail: "Clearing it out, back in a sec",
    backOnTitle: `${APP} is back on`,
    backOnDetail: "Cleaning up an ad from earlier, back in a sec",
    sponsorSkipped: "Sponsor skipped",
    speed: (s) => `Speed ${s}×`,
    focusOn: "Focus on: Shorts, comments and suggestions hidden",
    focusOff: "Focus off: everything is back",
    screenshotSaved: "Screenshot saved to Downloads",
    screenshotFailed: "Can't take a screenshot of this video",
    volume: (v) => (v === 0 ? "Muted" : `Volume ${v}%`),
    quality: (q) => {
      if (q.failed) return "Can't change the quality of this video";
      if (q.diff === "lower") return `Quality ${q.name} (highest for this video)`;
      if (q.diff === "higher") return `Quality ${q.name} (lowest for this video)`;
      return `Quality ${q.name}`;
    },
  };
  const AVERAGE_AD_SECONDS = 15;        // used to estimate "time saved" for ads removed before loading
  const AD_TICK_MS = 100;               // how often we retry skipping during an ad
  const PICTURE_AD_RELOAD_MS = 800;     // picture ads can't be skipped: reload clean after this
  const LATE_START_WINDOW_MS = 15000;   // how long after switching on we watch for stuck videos
  const LATE_START_TICK_MS = 250;
  const STUCK_BEFORE_MESSAGE_MS = 1500; // show the message after this long on black
  const STUCK_BEFORE_RELOAD_MS = 3000;  // reload clean after this long on black
  const ALIVE_CHECK_MS = 1000;

  const log = (...args) => DEBUG && console.log(`[${APP}]`, ...args);
  const root = document.documentElement;

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
    yourVideo: { id: null, time: 0 }, // where you were in it, to come back after a reload
    ad: null,             // { startedAt, timer, undo } while an ad is in the player
    lateStart: null,      // { until, timer, stuckSince } right after switching on
    settings: { ...settings.DEFAULTS }, // replaced as soon as saved settings load
  };
  const isEnabled = () => state.settings.enabled;

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

  const currentVideoId = () => new URLSearchParams(location.search).get("v");

  /**
   * The fast way out of an ad we can't skip: reload this video once.
   * The extension is on now, so the fresh load comes back without ads (about 1 to 2s,
   * instead of waiting out YouTube's ad timer). Only once per video, so it can never loop.
   * Comes back at the same second if you were in the middle of the video.
   * Returns false if this video was already reloaded.
   */
  function reloadVideoOnce() {
    const id = currentVideoId();
    if (!id) return false;
    const key = "yas-reloaded:" + id;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");

    const url = new URL(location.href);
    const resumeAt = state.yourVideo.id === id ? Math.floor(state.yourVideo.time) : 0;
    if (resumeAt > 0) url.searchParams.set("t", resumeAt + "s");
    log("reloading clean at", resumeAt, "s");
    (YAS.navigate || ((u) => location.replace(u)))(url.toString()); // YAS.navigate: test hook
    return true;
  }

  // ---------------------------------------------------------------------------
  // Case 1: an ad is in the player
  // ---------------------------------------------------------------------------
  function startAd(player) {
    stopLateStartWatch();
    state.ad = { startedAt: Date.now(), timer: null, undo: null, counted: false, reloadTried: false };
    stats.add({ ads: 1 });
    log("ad found");
    tickAd(player);
    state.ad.timer = setInterval(() => tickAd(player), AD_TICK_MS);
  }

  function tickAd(player) {
    const ad = state.ad;
    if (!ad) return;
    const video = videoOf(player);

    // First thing, every ad: no sound. Undone when the ad ends.
    if (video && !ad.undo) ad.undo = ads.silence(video);

    if (video && ads.isAdVideo(video, state.yourVideoSource)) {
      // Video ad: jump straight to its end.
      if (!ad.counted) {
        ad.counted = true;
        stats.add({ seconds: video.duration - video.currentTime });
      }
      ads.jumpToEnd(video);
      overlay.show(player, TEXT.skippedTitle, TEXT.skippedDetail);
    } else {
      // Picture ad: YouTube runs its timer. Try Skip, then reload clean instead of waiting.
      overlay.show(player, TEXT.clearingTitle, TEXT.clearingDetail);
      if (Date.now() - ad.startedAt >= PICTURE_AD_RELOAD_MS && !ad.reloadTried) {
        ad.reloadTried = true;
        reloadVideoOnce();
      }
    }
    ads.clickSkip();
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
      reloadTried: false,
      timer: setInterval(tickLateStart, LATE_START_TICK_MS),
    };
  }

  function tickLateStart() {
    const watch = state.lateStart;
    const player = state.player;
    if (!watch) return;
    if (Date.now() > watch.until) return stopLateStartWatch();
    if (!player || state.ad || !onWatchPage() || !isEnabled()) return;

    if (!isStuck(player)) {
      watch.stuckSince = null;
      overlay.hide();
      return;
    }
    watch.stuckSince ??= Date.now();
    const stuckFor = Date.now() - watch.stuckSince;
    if (stuckFor >= STUCK_BEFORE_MESSAGE_MS) {
      overlay.show(player, TEXT.backOnTitle, TEXT.backOnDetail);
    }
    if (stuckFor >= STUCK_BEFORE_RELOAD_MS && !watch.reloadTried) {
      watch.reloadTried = true;
      reloadVideoOnce();
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
  /**
   * Decide whether we should be handling an ad right now. Called when YouTube's
   * player changes AND whenever our own state changes (switched on, a channel is
   * no longer allowed), so an ad that is already playing gets stopped at once.
   */
  function onPlayerClassChange() {
    const player = state.player;
    if (!player) return;
    // Paused, or a channel you support: let YouTube play its ads normally.
    const adNow = ads.isPlaying(player) && isEnabled() && !creators.isAllowedNow();
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
    controls.attach(player);
    updateButtons();
    onPlayerClassChange();
    return true;
  }

  /** Remember the real video while it plays without an ad. */
  function onTimeUpdate(event) {
    const player = state.player;
    if (!player || !player.contains(event.target)) return;
    // Never learn "your video" from an ad, even while PureFlow is paused.
    if (state.ad || ads.isPlaying(player)) return;
    if (event.target.currentTime > 0.5) {
      state.yourVideoSource = ads.sourceOf(event.target);
      state.yourVideo = { id: currentVideoId(), time: event.target.currentTime };
    }
    if (isEnabled()) loop.check(event.target);
    if (isEnabled() && state.settings.sponsorSkip) {
      const skipped = sponsor.check(event.target);
      if (skipped > 0) {
        overlay.toast(player, TEXT.sponsorSkipped);
        stats.add({ seconds: skipped });
      }
    }
  }

  /** Default speed: once per video, when your real video starts playing. */
  function onPlaying(event) {
    const player = state.player;
    if (!player || !player.contains(event.target) || !isEnabled()) return;
    speed.onPlaying(event.target, Boolean(state.ad));
    quality.onPlaying(Boolean(state.ad));
    if (state.settings.playerButtons) controls.addButtons(player); // the bar exists by now
  }

  /** Your video ended: start the next one right away (only if YouTube's Autoplay is on). */
  function onEnded(event) {
    const player = state.player;
    if (!player || !player.contains(event.target) || !isEnabled()) return;
    if (loop.status() === "on") return loop.check(event.target); // looping: back to the start, keep playing
    if (!state.settings.instantNext || state.ad || ads.isPlaying(player) || !onWatchPage()) return;
    autonext.onEnded(player, event.target);
  }

  // ---------------------------------------------------------------------------
  // Tools: screenshot, loop, volume (from shortcuts, wheel or player buttons)
  // ---------------------------------------------------------------------------
  /** May the tools act now? PureFlow on, a video open, no ad. Otherwise keys and wheel stay YouTube's. */
  function canAct() {
    const player = state.player;
    return Boolean(isEnabled() && onWatchPage() && player && videoOf(player) && !state.ad && !ads.isPlaying(player));
  }

  function onAction(action, step) {
    const player = state.player;
    const video = videoOf(player);
    if (!canAct()) return;
    if (action === "screenshot") {
      screenshot.save(video).then((ok) => overlay.toast(player, ok ? TEXT.screenshotSaved : TEXT.screenshotFailed));
    } else if (action === "loop") {
      overlay.toast(player, loop.step(video));
      controls.showLoop(loop.status());
      dock.refresh();
    } else if (action === "volume") {
      document.dispatchEvent(new CustomEvent("yas:cmd", { detail: JSON.stringify({ cmd: "volume", step }) }));
    }
  }

  /** bridge.js changed the volume: say so. */
  function onVolume(event) {
    if (state.player) overlay.toast(state.player, TEXT.volume(Number(event.detail)));
  }

  /** bridge.js set the quality you tapped in the popup: say so. */
  function onQuality(event) {
    try {
      if (state.player) overlay.toast(state.player, TEXT.quality(JSON.parse(event.detail)));
    } catch (e) { /* bad data: ignore */ }
    dock.refresh();
  }

  // ---------------------------------------------------------------------------
  // Floating PureFlow button (dock.js): what it shows, and what its taps do
  // ---------------------------------------------------------------------------
  const FOCUS_KEYS = ["hideShorts", "hideComments", "hideRelated", "hideEndScreens"];

  function dockState() {
    const s = state.settings;
    const video = videoOf(state.player);
    const watch = canAct();
    return {
      watch,
      speed: watch && video.playbackRate > 0 ? video.playbackRate : s.speed || 1, // what is really playing
      quality: s.quality || "",
      get qualities() { return watch ? quality.available() : []; }, // asks the player: only when the menu opens
      loop: loop.status(),
      focus: FOCUS_KEYS.every((k) => s[k]),
      settingsOpen: panel.isOpen(),
    };
  }

  function onDockAction(action, value) {
    const player = state.player;
    if (action === "speed") {
      speed.setSpeed(value, videoOf(player), Boolean(state.ad), { now: true }); // this video, now
      settings.save({ speed: value }).catch(() => {});                          // and the next ones
      if (canAct()) overlay.toast(player, TEXT.speed(value));
    } else if (action === "quality") {
      if (canAct()) quality.setQuality(value, Boolean(state.ad), { now: true });
      settings.save({ quality: value }).catch(() => {});
    } else if (action === "focus") {
      settings.save(Object.fromEntries(FOCUS_KEYS.map((k) => [k, Boolean(value)]))).catch(() => {});
      state.settings = { ...state.settings, ...Object.fromEntries(FOCUS_KEYS.map((k) => [k, Boolean(value)])) };
      if (player && onWatchPage()) overlay.toast(player, value ? TEXT.focusOn : TEXT.focusOff);
    } else if (action === "settings") {
      panel.toggle();
    } else {
      onAction(action); // screenshot, loop
    }
  }

  function updateDock() {
    if (isEnabled() && state.settings.floatingBar) dock.start({ state: dockState, act: onDockAction });
    else { dock.stop(); panel.close(); }
  }

  function updateButtons() {
    if (isEnabled() && state.settings.playerButtons) {
      controls.addButtons(state.player);
      controls.showLoop(loop.status());
    } else {
      controls.removeButtons();
    }
  }

  /** inject.js removed ad breaks before they loaded: count them. */
  function onAdsRemoved(event) {
    const adBreaks = Number(event.detail) || 0;
    stats.add({ ads: adBreaks, seconds: adBreaks * AVERAGE_AD_SECONDS });
  }

  function onNavigate() {
    attachToPlayer();
    autonext.stop();
    loop.clear(); // a loop belongs to one video
    updateButtons();
    dock.refresh();
    if (isEnabled() && state.settings.sponsorSkip) sponsor.load(currentVideoId());
  }

  // ---------------------------------------------------------------------------
  // Settings (from the popup)
  // ---------------------------------------------------------------------------
  function applySettings(next) {
    state.settings = next;
    if (next.enabled) {
      root.dataset.yas = "on";
      focus.apply(next);
      notices.start(); // hide the "Experiencing interruptions?" popup
    } else {
      // Paused from the popup: YouTube goes back to normal in this tab.
      endAd();
      stopLateStartWatch();
      overlay.hide();
      focus.clear();
      notices.stop();
      delete root.dataset.yas;
    }
    speed.setSpeed(next.speed, videoOf(state.player), Boolean(state.ad)); // applies right away
    if (next.enabled) quality.setQuality(next.quality, Boolean(state.ad));
    // Paused: shortcuts and the wheel go back to YouTube (and the page) completely.
    controls.configure({ shortcuts: next.enabled && next.shortcuts, wheelVolume: next.enabled && next.wheelVolume });
    updateButtons();
    if (!next.enabled) { autonext.stop(); loop.clear(); }
    updateDock();
    creators.setAllowed(next.allowedChannels);
    if (next.enabled && next.sponsorSkip) sponsor.load(currentVideoId());
    onPlayerClassChange(); // just switched on with an ad already playing? stop it now
    log("settings", next);
  }

  /** Messages from the popup. */
  function onMessage(message, sender, reply) {
    if (message?.type === "get-status") {
      // version lets the popup spot a tab still running older PureFlow code
      reply({ onWatchPage: onWatchPage(), channel: creators.current(), version: chrome.runtime.getManifest().version,
        qualities: onWatchPage() && isEnabled() ? quality.available() : [] }); // popup hides what this video lacks
    }
    if (message?.type === "set-speed") {
      // You tapped a speed: apply it to the open video right away.
      speed.setSpeed(message.speed, videoOf(state.player), Boolean(state.ad), { now: true });
      reply({ ok: true });
    }
    if (message?.type === "set-quality") {
      // You tapped a quality: switch the open video right away, like speed.
      if (isEnabled()) quality.setQuality(message.quality, Boolean(state.ad), { now: true });
      reply({ ok: true });
    }
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
    document.addEventListener("yt-navigate-finish", onNavigate);
    document.addEventListener("timeupdate", onTimeUpdate, true);
    document.addEventListener("playing", onPlaying, true);
    document.addEventListener("yas:ads-removed", onAdsRemoved);
    document.addEventListener("ended", onEnded, true);
    document.addEventListener("yas:volume", onVolume);
    document.addEventListener("yas:quality", onQuality);
    controls.start(onAction, canAct);
    chrome.runtime.onMessage.addListener(onMessage);
    YAS.pageMessage = (message, reply) => onMessage(message, {}, reply); // the All settings panel, on this page
    creators.start(onPlayerClassChange); // a channel stops being allowed mid-ad: stop it now
    settings.load().then(applySettings).catch(() => {});
    settings.onChange(applySettings);
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
    document.removeEventListener("yt-navigate-finish", onNavigate);
    document.removeEventListener("timeupdate", onTimeUpdate, true);
    document.removeEventListener("playing", onPlaying, true);
    document.removeEventListener("yas:ads-removed", onAdsRemoved);
    document.removeEventListener("ended", onEnded, true);
    document.removeEventListener("yas:volume", onVolume);
    document.removeEventListener("yas:quality", onQuality);
    autonext.stop();
    controls.stop();
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch (e) { /* already gone */ }
    if (isOwner()) {
      notices.stop();
      controls.removeButtons(); // only the owner: a newer copy may have just added its own
      dock.stop();
      panel.close();
      overlay.destroy();
      creators.stop();
      focus.clear();
      delete root.dataset.yas; // hide.css and inject.js stop working instantly
    }
    log("off");
  }

  function checkAlive() {
    if (!extensionAlive() || !isOwner()) return turnOff();
    // An older copy may have switched the tab off while shutting down. Fix that.
    if (isEnabled() && root.dataset.yas !== "on") root.dataset.yas = "on";
  }

  turnOn();
})();
