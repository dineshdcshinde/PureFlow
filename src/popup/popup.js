/*
 * popup/popup.js
 * The toolbar popup. Reads and saves through YAS.settings (content/settings.js), so the
 * popup and the content scripts always agree. Content scripts react to changes on their
 * own (chrome.storage.onChanged): picking 2x here changes the open video right away.
 * The only message to the page is "which channel is on screen?".
 */
(() => {
  const { settings, stats, greeting } = globalThis.YAS;
  const brand = globalThis.YAS_BRAND || { name: "PureFlow", disclaimer: "" };
  const $ = (id) => document.getElementById(id);

  let current = { ...settings.DEFAULTS };
  let turn = 0;        // how many times the popup was opened; rotates the greeting message
  let activeTab = null; // the YouTube tab this popup was opened on (if any)
  let refreshing = false; // true from pressing Refresh until the tab has loaded again
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
    for (const input of document.querySelectorAll("[data-setting]")) {
      input.checked = Boolean(next[input.dataset.setting]);
    }
    for (const chip of document.querySelectorAll("[data-speed]")) {
      chip.setAttribute("aria-checked", String(Number(chip.dataset.speed) === Number(next.speed)));
    }
    $("main").classList.toggle("paused", !next.enabled);
    renderGreeting();
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

  /** Show the refresh note (if needed) and "Allow ads on <channel>" when a video is open. */
  async function renderTab() {
    const { tab, status } = await askActiveTab();
    activeTab = tab;
    if (!refreshing) $("update-notice").hidden = !(await needsRefresh(tab, status));
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
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { tab: null, status: null };
      const status = await chrome.tabs.sendMessage(tab.id, { type: "get-status" });
      return { tab, status };
    } catch (e) {
      return { tab, status: null }; // not a YouTube tab, or PureFlow isn't running there yet
    }
  }

  /** Tell the open YouTube tab directly, so the speed changes this instant. */
  function sendToTab(message) {
    if (!activeTab?.id) return;
    chrome.tabs.sendMessage(activeTab.id, message).catch(() => {});
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
      chrome.tabs.onUpdated.removeListener(onUpdated);
      refreshing = false;
      setTimeout(renderTab, 500); // PureFlow starts with the page; then re-check
    };
    chrome.tabs.onUpdated?.addListener(onUpdated);
    chrome.tabs.reload(tabId);
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  async function start() {
    $("app-name").textContent = brand.name;
    $("disclaimer").textContent = brand.disclaimer || "";

    const [saved, counts] = await Promise.all([settings.load(), stats.load()]);
    turn = counts.popupOpens || 0;
    chrome.storage.local.set({ popupOpens: turn + 1 }); // next open shows the next message
    renderSettings(saved);
    renderStats(counts);
    renderTab();

    document.addEventListener("change", onSwitchChange);
    $("speed-chips").addEventListener("click", onSpeedClick);
    $("edit-name").addEventListener("click", startNameEdit);
    $("name-form").addEventListener("submit", (e) => { e.preventDefault(); finishNameEdit(true); }); // Save button or Enter
    $("name-cancel").addEventListener("click", () => finishNameEdit(false));
    $("name-input").addEventListener("keydown", (e) => { if (e.key === "Escape") finishNameEdit(false); });
    $("reset-stats").addEventListener("click", () => stats.reset());
    $("refresh-tab").addEventListener("click", refreshTab);

    settings.onChange(renderSettings);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.adsBlocked || changes.secondsSaved)) stats.load().then(renderStats);
    });
  }

  start();
})();
