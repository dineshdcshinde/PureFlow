// Layer 4: backup plan + messages on the player.
//
// 1. If an ad still plays: hide it, and if it is a VIDEO ad, mute it, speed it up
//    and jump to its end. Then press Skip. Shows "Ad blocked by YT Ad Skipper".
// 2. If YouTube stalls on a black screen while loading your video (it does this
//    sometimes after an ad was removed), shows "Loading your video without ads".
//
// Safety rule: we only speed up / jump a video when we are sure it is the AD video.
// Your real video is remembered while it plays, and we never touch that one.
//
// This file is also the on/off switch for the whole extension inside the tab.
(() => {
  // If a copy is already running AND its extension is still alive, don't start twice.
  // If that copy belongs to an extension that was just turned off, start fresh anyway.
  if (window.__ytAdSkipperAlive && window.__ytAdSkipperAlive()) return;

  const me = Symbol("yt-ad-skipper");
  window.__ytAdSkipperOwner = me;
  const isOwner = () => window.__ytAdSkipperOwner === me;
  const extensionAlive = () => {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  };
  window.__ytAdSkipperAlive = () => isOwner() && extensionAlive();

  const SKIP_BUTTONS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container button",
    ".video-ads button[class*='skip']",
    "[id^='skip-button'] button",
  ].join(", ");
  const MAX_AD_SECONDS = 180;
  const root = document.documentElement;

  let watchedPlayer = null;
  let playerObserver = null;
  let waitForPlayer = null;
  let inAd = false;
  let adTimer = null;
  let loadTimer = null;
  let loadStartedAt = Date.now();
  let changedVideo = null;
  let saved = { muted: false, rate: 1 };
  let yours = { src: null };

  const adOn = (p) => p.classList.contains("ad-showing");
  const onWatchPage = () => location.pathname === "/watch";

  // ---- Turn on ----
  root.setAttribute("data-yt-ad-skipper", "on");
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = chrome.runtime.getURL("hide.css");
  (document.head || root).appendChild(css);

  // ---- Message on the player ----
  let overlay = null;
  function showOverlay(player, title, sub) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "yt-ad-skipper-overlay";
      overlay.innerHTML =
        '<div class="yas-spinner"></div><div class="yas-title"></div><div class="yas-sub"></div>';
    }
    overlay.querySelector(".yas-title").textContent = title;
    overlay.querySelector(".yas-sub").textContent = sub;
    if (overlay.parentNode !== player) player.appendChild(overlay);
  }
  function hideOverlay() {
    if (overlay) overlay.remove();
  }

  // Remember your real video while it plays with no ad.
  function onTimeUpdate(e) {
    const player = watchedPlayer;
    if (!player || adOn(player) || !player.contains(e.target)) return;
    if (e.target.currentTime > 0.5) yours = { src: e.target.currentSrc || e.target.src };
  }
  document.addEventListener("timeupdate", onTimeUpdate, true);

  function isAdVideo(video) {
    const src = video.currentSrc || video.src;
    if (!src || src === yours.src) return false; // that's your video, hands off
    return isFinite(video.duration) && video.duration > 0 && video.duration <= MAX_AD_SECONDS;
  }

  // ---- Ads ----
  function skipAd(player) {
    const video = player.querySelector("video");
    const secs = Math.round((Date.now() - adStartedAt) / 1000);
    if (video && isAdVideo(video)) {
      showOverlay(player, "Ad blocked by YT Ad Skipper", "Skipping the ad, your video starts in a moment");
      if (changedVideo !== video) {
        changedVideo = video;
        saved = { muted: video.muted, rate: video.playbackRate };
      }
      video.muted = true;
      video.playbackRate = 16;
      video.currentTime = video.duration;
    } else {
      showOverlay(player, "Ad blocked by YT Ad Skipper",
        "YouTube is holding your video for its ad timer (" + secs + "s). It will start by itself.");
    }
    const btn = document.querySelector(SKIP_BUTTONS);
    if (btn) btn.click();
  }

  let adStartedAt = 0;
  function startAd(player) {
    inAd = true;
    adStartedAt = Date.now();
    stopLoadCheck();
    console.log("[YT Ad Skipper] ad found");
    skipAd(player);
    adTimer = setInterval(() => skipAd(player), 100);
  }

  function endAd() {
    inAd = false;
    clearInterval(adTimer);
    hideOverlay();
    if (changedVideo) {
      changedVideo.muted = saved.muted;
      changedVideo.playbackRate = saved.rate;
      changedVideo = null;
    }
    const video = watchedPlayer && watchedPlayer.querySelector("video");
    if (video && video.playbackRate === 16) video.playbackRate = 1;
    startLoadCheck(); // the real video may still need a moment to load
  }

  // ---- Black screen while YouTube loads your video ----
  // Runs only for the first 20 seconds of a new video, and stops as soon as it plays.
  function isStuck(player) {
    const video = player.querySelector("video");
    if (!video) return false;
    const notPlayingYet = video.currentTime < 0.2;
    const loading = player.classList.contains("buffering-mode") || (!video.paused && notPlayingYet);
    return notPlayingYet && loading;
  }

  function checkLoading() {
    const player = watchedPlayer;
    if (!player || inAd || !onWatchPage()) return;
    const waited = Date.now() - loadStartedAt;
    if (waited > 20000) return stopLoadCheck();
    if (waited > 700 && isStuck(player)) {
      showOverlay(player, "YT Ad Skipper is on",
        "Ad removed. Loading your video (" + Math.round(waited / 1000) + "s)...");
    } else if (!isStuck(player) && waited > 700) {
      hideOverlay();
      const video = player.querySelector("video");
      if (video && video.currentTime >= 0.2) stopLoadCheck();
    }
  }

  function startLoadCheck() {
    stopLoadCheck();
    loadStartedAt = Date.now();
    loadTimer = setInterval(checkLoading, 250);
  }
  function stopLoadCheck() {
    clearInterval(loadTimer);
    loadTimer = null;
    if (!inAd) hideOverlay();
  }

  // ---- Watching the player ----
  function onPlayerChange(player) {
    const ad = adOn(player);
    if (ad && !inAd) startAd(player);
    else if (!ad && inAd) endAd();
  }

  function watch(player) {
    if (player === watchedPlayer) return;
    if (playerObserver) playerObserver.disconnect();
    watchedPlayer = player;
    playerObserver = new MutationObserver(() => onPlayerChange(player));
    playerObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
    onPlayerChange(player);
  }

  function findPlayer() {
    const player = document.querySelector("#movie_player");
    if (player) watch(player);
    return player;
  }

  function onNavigate() {
    findPlayer();
    if (!inAd) startLoadCheck();
  }

  if (!findPlayer()) {
    waitForPlayer = new MutationObserver(() => {
      if (findPlayer()) waitForPlayer.disconnect();
    });
    waitForPlayer.observe(root, { childList: true, subtree: true });
  }
  document.addEventListener("yt-navigate-finish", onNavigate);
  startLoadCheck();

  // ---- Turn off ----
  function turnOff() {
    clearInterval(offCheck);
    if (inAd) endAd();
    stopLoadCheck();
    hideOverlay();
    if (playerObserver) playerObserver.disconnect();
    if (waitForPlayer) waitForPlayer.disconnect();
    document.removeEventListener("yt-navigate-finish", onNavigate);
    document.removeEventListener("timeupdate", onTimeUpdate, true);
    css.remove();
    // Only switch the tab "off" if no newer copy has taken over.
    if (isOwner()) {
      root.removeAttribute("data-yt-ad-skipper");
      console.log("[YT Ad Skipper] turned off in this tab");
    }
  }

  const offCheck = setInterval(() => {
    if (!extensionAlive() || !isOwner()) return turnOff();
    // If an old copy switched the tab off by mistake, switch it back on.
    if (root.getAttribute("data-yt-ad-skipper") !== "on") root.setAttribute("data-yt-ad-skipper", "on");
    if (!css.isConnected) (document.head || root).appendChild(css);
  }, 1000);
})();
