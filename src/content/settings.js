/*
 * content/settings.js
 * The one place that reads and writes saved data. Shared by content scripts and the popup.
 *
 *   settings (chrome.storage.sync, follows you across your browsers):
 *     enabled, focus toggles, default speed and quality, sponsor skip, allowed channels,
 *     play next right away, wheel volume, shortcuts, player buttons
 *   stats (chrome.storage.local, this computer only):
 *     adsBlocked, secondsSaved
 *
 * Nothing ever leaves the browser.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const DEFAULTS = Object.freeze({
    enabled: true,
    hideShorts: false,
    hideComments: false,
    hideRelated: false,
    hideEndScreens: false,
    speed: 0,              // 0 = leave YouTube's speed alone
    sponsorSkip: false,    // opt-in: asks SponsorBlock for sponsor segments
    quality: "",           // "" = Auto; else "hd1080", "hd720"... (best available up to that)
    instantNext: true,     // skip YouTube's "Up next in 8" wait when Autoplay is on
    wheelVolume: false,    // opt-in: mouse wheel over the player changes the volume
    shortcuts: true,       // Shift+S screenshot, Shift+L loop
    playerButtons: true,   // screenshot and loop buttons on the player bar
    allowedChannels: {},   // { channelId: "Channel name" } = ads allowed (support creators)
    userName: "",          // optional, only for the popup greeting
  });

  // Personal settings that should never sync to other devices: kept on this computer only.
  const LOCAL_ONLY = ["userName"];
  const split = (values) => {
    const local = {}, synced = {};
    for (const [key, value] of Object.entries(values)) (LOCAL_ONLY.includes(key) ? local : synced)[key] = value;
    return { local, synced };
  };

  const STATS_DEFAULTS = Object.freeze({ adsBlocked: 0, secondsSaved: 0, popupOpens: 0 });
  const STATS_FLUSH_MS = 2000; // batch stat writes so we don't write storage on every ad

  const settings = {
    DEFAULTS,

    /** All settings, with defaults filled in. */
    async load() {
      const { local, synced } = split(DEFAULTS);
      const [fromSync, fromLocal] = await Promise.all([chrome.storage.sync.get(synced), chrome.storage.local.get(local)]);
      return { ...DEFAULTS, ...fromSync, ...fromLocal };
    },

    /** Save some settings, e.g. save({ hideShorts: true }). */
    async save(changes) {
      const { local, synced } = split(changes);
      if (Object.keys(synced).length) await chrome.storage.sync.set(synced);
      if (Object.keys(local).length) await chrome.storage.local.set(local);
    },

    /** Call `listener(newSettings)` whenever any setting changes. */
    onChange(listener) {
      chrome.storage.onChanged.addListener((changes, area) => {
        const relevant = area === "sync" || (area === "local" && LOCAL_ONLY.some((k) => k in changes));
        if (relevant) settings.load().then(listener);
      });
    },
  };

  let pending = { adsBlocked: 0, secondsSaved: 0 };
  let flushTimer = null;

  const stats = {
    DEFAULTS: STATS_DEFAULTS,

    async load() {
      return { ...STATS_DEFAULTS, ...(await chrome.storage.local.get(STATS_DEFAULTS)) };
    },

    /** Count blocked ads and saved time. Writes are batched every 2 seconds. */
    add({ ads = 0, seconds = 0 }) {
      pending.adsBlocked += ads;
      pending.secondsSaved += Math.max(0, seconds);
      flushTimer ??= setTimeout(stats.flush, STATS_FLUSH_MS);
    },

    async flush() {
      flushTimer = null;
      const add = pending;
      pending = { adsBlocked: 0, secondsSaved: 0 };
      if (!add.adsBlocked && !add.secondsSaved) return;
      try {
        const current = await stats.load();
        await chrome.storage.local.set({
          adsBlocked: current.adsBlocked + add.adsBlocked,
          secondsSaved: Math.round(current.secondsSaved + add.secondsSaved),
        });
      } catch (e) { /* extension turned off mid-write: nothing to do */ }
    },

    reset() {
      return chrome.storage.local.set({ adsBlocked: 0, secondsSaved: 0 });
    },
  };

  YAS.settings = settings;
  YAS.stats = stats;
})();
