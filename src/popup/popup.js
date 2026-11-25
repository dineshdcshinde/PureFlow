/*
 * popup/popup.js
 * The PureFlow settings: the toolbar popup, and also the "All settings" panel that the
 * floating button on YouTube opens (panel/panel.js draws popup.html inside the page and
 * calls YAS.popupUI.mount on it). Reads and saves through YAS.settings (content/settings.js), so the
 * popup and the content scripts always agree. Content scripts react to changes on their
 * own (chrome.storage.onChanged): picking 2x here changes the open video right away.
 * The only message to the page is "which channel is on screen?".
 */
(() => {
  const YAS = globalThis.YAS;
  const brand = globalThis.YAS_BRAND || { name: "PureFlow", disclaimer: "" };

  /**
   * Draw the settings into root (the popup document, or the panel's shadow root).
   * tabs: chrome.tabs in the popup; inside the panel, a stand-in that talks to this page.
   * Returns stop(): stop listening (the panel was closed).
   */
  function mount(root, tabs) {
    const { settings, stats, greeting } = YAS;
    const $ = (id) => root.getElementById(id);
    let stopped = false;

    let current = { ...settings.DEFAULTS };
    let turn = 0;        // how many times the popup was opened; rotates the greeting message
    let activeTab = null; // the YouTube tab this popup was opened on (if any)
    let refreshing = false; // true from pressing Refresh until the tab has loaded again
    let siteTab = null;      // { tab, site } when the popup was opened on a website other than YouTube
    let videoQualities = []; // qualities the open video has (empty = unknown: show all)
    const QUALITY_NAMES = { highres: "8K", hd2880: "5K", hd2160: "4K", hd1440: "1440p", hd1080: "1080p", hd720: "720p", large: "480p",
      medium: "360p", small: "240p", tiny: "144p" };
    const VERSION = chrome.runtime.getManifest?.().version;

    // ---------------------------------------------------------------------------
    // Formatting
    // ---------------------------------------------------------------------------
    const formatCount = (n) => new Intl.NumberFormat().format(n);
    function formatTime(seconds) {
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return `${minutes} min`;
      const hours = minutes / 60;
      return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
    }

    // ---------------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------------
    function renderGreeting() {
      const { title, message } = greeting.build(new Date(), current.userName, turn);
      $("greeting").textContent = title;
      $("tagline").textContent = current.enabled ? message : "Paused. Ads and everything else are back to normal.";
      $("edit-name").textContent = current.userName ? "Change name" : "Add your name";
    }

    function renderSettings(next) {
      current = next;
      for (const input of root.querySelectorAll("[data-setting]")) {
        input.checked = Boolean(next[input.dataset.setting]);
      }
      for (const chip of root.querySelectorAll("[data-speed]")) {
        chip.setAttribute("aria-checked", String(Number(chip.dataset.speed) === Number(next.speed)));
      }
      for (const chip of root.querySelectorAll("[data-quality]")) {
        chip.setAttribute("aria-checked", String(chip.dataset.quality === (next.quality || "")));
      }
      renderQualityChoices();
      $("main").classList.toggle("paused", !next.enabled);
      renderGreeting();
      renderSiteHint();
    }

    /**
     * Only offer qualities the open video really has: a 1080p video shows no 1440p or 4K.
     * Without a video (or before the player is ready) every choice is shown.
     */
    function renderQualityChoices() {
      const has = videoQualities;
      const note = $("quality-note");
      for (const chip of root.querySelectorAll("[data-quality]")) {
        chip.hidden = Boolean(has.length && chip.dataset.quality && !has.includes(chip.dataset.quality));
      }
      // Your saved choice is higher than this video goes: say what it plays at instead.
      const picked = current.quality || "";
      const best = has.find((q) => QUALITY_NAMES[q]);
      if (has.length && picked && !has.includes(picked) && best) {
        note.textContent = `Your default is ${QUALITY_NAMES[picked] || picked}. This video plays at its best: ${QUALITY_NAMES[best]}.`;
        note.hidden = false;
      } else {
        note.hidden = true;
      }
    }

    function renderStats(counts) {
      $("ads-blocked").textContent = formatCount(counts.adsBlocked);
      $("time-saved").textContent = formatTime(counts.secondsSaved);
    }

    const isYouTube = (tab) => /^https?:\/\/(www|m)\.youtube\.com\//.test(tab?.url || "");
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * Does this tab still run older (or no) PureFlow code? We only say yes when we're sure:
     * a tab that is still loading (e.g. right after you pressed Refresh) gets time to start.
     */
    async function needsRefresh(tab, status) {
      if (!isYouTube(tab)) return false;
      if (status) return status.version !== VERSION;
      if (tab.status !== "complete") return false;   // still loading: PureFlow starts with the page
      await wait(700);                                // give a just-loaded page a moment
      const again = await askActiveTab();
      if (again.status) return again.status.version !== VERSION;
      return again.tab?.status === "complete";
    }

    /** The website in this tab ("news.com" for www.news.com), or null for YouTube and browser pages. */
    function websiteOf(tab) {
      try {
        const url = new URL(tab?.url || "");
        if (!/^https?:$/.test(url.protocol) || isYouTube(tab)) return null;
        return url.hostname.replace(/^www\./, "");
      } catch (e) {
        return null;
      }
    }

    /** Ads Chrome blocked in this tab (needs activeTab: the popup was opened on it). */
    async function blockedHere(tabId) {
      try {
        const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
        // Only blocks: not the "allow ads on this site" rule (dynamic) or a creator you support (session).
        return rulesMatchedInfo.filter((m) => !String(m.rule?.rulesetId).startsWith("_")).length;
      } catch (e) {
        return null; // not allowed or not supported: just don't show a number
      }
    }

    /** Is PureFlow blocking ads on this website right now? */
    const blockingOn = (site) => Boolean(current.enabled && current.webBlock && !current.allowedSites?.[site]);

    /** The line under "Block ads on <site>": what the switch does right now. */
    async function renderSiteHint() {
      if (!siteTab) return;
      const on = blockingOn(siteTab.site);
      $("block-site").checked = on;
      // One short line that keeps its height, so the popup never jumps.
      if (!on) { $("site-count").textContent = "Ads are shown on this site"; return; }
      const count = await blockedHere(siteTab.tab.id);
      if (!blockingOn(siteTab.site)) return; // switched off while we were counting
      $("site-count").textContent = count ? `${count === 1 ? "1 ad" : `${formatCount(count)} ads`} blocked on this page` : "Ads are removed on this site";
    }

    /**
     * Any other website: the popup is just one switch, "Block ads on <site>".
     * On: ads vanish at once (no reload). Off: the page reloads so the site's ads can load.
     */
    function renderSite(tab) {
      const site = websiteOf(tab);
      if (!site || tabs !== chrome.tabs || siteTab) return;
      siteTab = { tab, site };
      document.body.classList.add("site-mode");
      $("site-name").textContent = site;
      $("block-site").onchange = async (event) => {
        const block = event.target.checked;
        $("site-count").textContent = block ? "Ads are removed on this site" : "Ads are shown on this site";
        let host = site;
        try { host = new URL(tab.url).hostname; } catch (e) { /* keep site */ }
        // 1. Save it here, so the choice always sticks (even if the background is busy or older).
        const latest = await settings.load();
        const allowedSites = { ...latest.allowedSites };
        const change = { allowedSites };
        if (block) {
          delete allowedSites[site];
          if (!latest.enabled) change.enabled = true; // one switch in this view: on means "block here"
          if (!latest.webBlock) change.webBlock = true;
        } else {
          allowedSites[site] = true;
        }
        await settings.save(change);
        current = { ...latest, ...change };
        // 2. Apply it to this page now: hide the ads at once, or reload so the site's ads load.
        const applied = await chrome.runtime.sendMessage({ type: "web-site", tabId: tab.id, site, host, block }).catch(() => false);
        if (!applied) tabs.reload(tab.id); // couldn't apply it live: a reload always does
        renderSiteHint();
      };
      $("site-card").hidden = false;
      renderSiteHint();
    }

    /** Show the refresh note (if needed) and "Allow ads on <channel>" when a video is open. */
    async function renderTab() {
      const { tab, status } = await askActiveTab();
      activeTab = tab;
      if (!refreshing) $("update-notice").hidden = !(await needsRefresh(tab, status));
      renderSite(tab);
      videoQualities = Array.isArray(status?.qualities) ? status.qualities : [];
      renderQualityChoices();
      const channel = status?.onWatchPage ? status.channel : null;
      if (!channel) return;
      $("creator-name").textContent = channel.author || "this channel";
      $("allow-channel").checked = Boolean(current.allowedChannels[channel.channelId]);
      $("allow-channel").onchange = async (event) => {
        const latest = await settings.load();
        const allowed = { ...latest.allowedChannels };
        if (event.target.checked) allowed[channel.channelId] = channel.author || channel.channelId;
        else delete allowed[channel.channelId];
        await settings.save({ allowedChannels: allowed });
      };
      $("creator-card").hidden = false;
    }

    async function askActiveTab() {
      let tab = null;
      try {
        [tab] = await tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { tab: null, status: null };
        const status = await tabs.sendMessage(tab.id, { type: "get-status" });
        return { tab, status };
      } catch (e) {
        return { tab, status: null }; // not a YouTube tab, or PureFlow isn't running there yet
      }
    }

    /** Tell the open YouTube tab directly, so the speed changes this instant. */
    function sendToTab(message) {
      if (!activeTab?.id) return;
      tabs.sendMessage(activeTab.id, message).catch(() => {});
    }

    // ---------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------
    function onSwitchChange(event) {
      const key = event.target.dataset.setting;
      if (key) settings.save({ [key]: event.target.checked });
    }

    function onSpeedClick(event) {
      const chip = event.target.closest("[data-speed]");
      if (!chip) return;
      const value = Number(chip.dataset.speed);
      sendToTab({ type: "set-speed", speed: value }); // instant, on the open video
      settings.save({ speed: value });                 // remembered for the next videos
    }

    /** Same as speed: one tap changes the open video at once, and is remembered. */
    function onQualityClick(event) {
      const chip = event.target.closest("[data-quality]");
      if (!chip) return;
      sendToTab({ type: "set-quality", quality: chip.dataset.quality }); // instant, on the open video
      settings.save({ quality: chip.dataset.quality });                 // remembered for the next videos
    }

    /** "Add your name": swap the greeting for a text box with Save and Cancel. */
    function startNameEdit() {
      const input = $("name-input");
      input.value = current.userName;
      $("greeting").hidden = true;
      $("name-form").hidden = false;
      input.focus();
      input.select();
    }

    async function finishNameEdit(save) {
      if ($("name-form").hidden) return;
      if (save) {
        const userName = $("name-input").value.trim().slice(0, 24);
        await settings.save({ userName });
        current = { ...current, userName };
        renderGreeting(); // show the new name at once
      }
      $("name-form").hidden = true;
      $("greeting").hidden = false;
    }

    /** Refresh: hide the note at once, reload the tab, check again when it has loaded. */
    function refreshTab() {
      if (!activeTab?.id) return;
      refreshing = true;
      $("update-notice").hidden = true;
      const tabId = activeTab.id;
      const onUpdated = (id, info) => {
        if (id !== tabId || info.status !== "complete") return;
        tabs.onUpdated.removeListener(onUpdated);
        refreshing = false;
        setTimeout(renderTab, 500); // PureFlow starts with the page; then re-check
      };
      tabs.onUpdated?.addListener(onUpdated);
      tabs.reload(tabId);
    }

    // ---------------------------------------------------------------------------
    // Start
    // ---------------------------------------------------------------------------
    async function start() {
      $("app-name").textContent = brand.name;
      $("disclaimer").textContent = brand.disclaimer || "";

      const [saved, counts, [tab] = []] = await Promise.all([settings.load(), stats.load(),
        tabs.query({ active: true, currentWindow: true }).catch(() => [])]);
      turn = counts.popupOpens || 0;
      chrome.storage.local.set({ popupOpens: turn + 1 }); // next open shows the next message
      current = saved;
      renderSite(tab); // another website: switch to the one-switch view before anything is drawn
      renderSettings(saved);
      renderStats(counts);
      renderTab();

      root.addEventListener("change", onSwitchChange);
      $("speed-chips").addEventListener("click", onSpeedClick);
      $("quality-chips").addEventListener("click", onQualityClick);
      $("edit-name").addEventListener("click", startNameEdit);
      $("name-form").addEventListener("submit", (e) => { e.preventDefault(); finishNameEdit(true); }); // Save button or Enter
      $("name-cancel").addEventListener("click", () => finishNameEdit(false));
      $("name-input").addEventListener("keydown", (e) => { if (e.key === "Escape") finishNameEdit(false); });
      $("reset-stats").addEventListener("click", () => stats.reset());
      $("refresh-tab").addEventListener("click", refreshTab);

      const offSettings = settings.onChange((next) => { if (!stopped) renderSettings(next); });
      const onStats = (changes, area) => {
        if (area === "local" && (changes.adsBlocked || changes.secondsSaved)) stats.load().then(renderStats);
      };
      chrome.storage.onChanged.addListener(onStats);
      stopListening = () => {
        offSettings?.();
        chrome.storage.onChanged.removeListener?.(onStats);
      };
    }

    let stopListening = () => {};
    start();
    return () => { stopped = true; stopListening(); };
  }

  YAS.popupUI = { mount };
  // The toolbar popup: draw into this page. (On YouTube this file only provides mount().)
  if (/^(chrome|moz)-extension:$/.test(location.protocol) && document.getElementById("greeting")) mount(document, chrome.tabs);
})();
