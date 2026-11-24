/*
 * bridge.js
 * The player's own controls (quality, volume) only exist in the page's JavaScript
 * world, so content scripts can't call them. This tiny file runs in that world ("MAIN")
 * and does just two things when the content script asks:
 *
 *   document event "yas:cmd"  detail = '{"cmd":"quality","value":"hd1080"}'
 *                                      '{"cmd":"volume","step":5}'
 *   document event "yas:volume" (answer) detail = "45"  (new volume, for the toast)
 *   document event "yas:quality" (answer) detail = '{"name":"1080p","diff":""}' or '{"failed":true}'
 *   '{"cmd":"levels"}' -> document event "yas:levels" detail = '["hd1080","hd720",...]'
 *   (DOM events run at once, so the asker has the answer as soon as it has asked)
 *
 * Details are JSON strings because objects don't cross between the two worlds.
 */
(() => {
  if (window.__yasBridgeInstalled) return;
  window.__yasBridgeInstalled = true;

  // Best first. "large" is 480p, "medium" 360p.
  const QUALITY_ORDER = ["highres", "hd2880", "hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny"];

  const player = () => document.getElementById("movie_player");

  /** Pick the wanted quality, or the best one below it if this video doesn't have it. */
  function pickQuality(wanted, available) {
    const from = QUALITY_ORDER.indexOf(wanted);
    if (from < 0) return null;
    const atOrBelow = QUALITY_ORDER.slice(from).find((q) => available.includes(q));
    if (atOrBelow) return atOrBelow;
    // Nothing that low (e.g. 480p asked, video starts at 720p): use its lowest.
    return [...QUALITY_ORDER].reverse().find((q) => available.includes(q)) || null;
  }
  const rank = (q) => QUALITY_ORDER.indexOf(q);

  const RETRY_MS = 300;
  const RETRIES = 30; // ~9s: a new video's qualities can take a moment to appear
  const NAMES = { highres: "8K", hd2880: "5K", hd2160: "4K", hd1440: "1440p", hd1080: "1080p",
    hd720: "720p", large: "480p", medium: "360p", small: "240p", tiny: "144p" };
  let retryTimer = null;

  /** Tell the content script what we set, so it can show "Quality 1080p". */
  const report = (detail) => document.dispatchEvent(new CustomEvent("yas:quality", { detail: JSON.stringify(detail) }));

  /**
   * Set the quality. If the player isn't ready yet (page still loading, next video
   * still starting), try again a few times instead of giving up.
   */
  function setQuality(value, announce, triesLeft = RETRIES) {
    clearTimeout(retryTimer);
    const p = player();
    const ready = p && typeof p.setPlaybackQualityRange === "function";
    const available = ready ? (p.getAvailableQualityLevels?.() || []).filter((q) => q !== "auto") : [];
    if (!available.length) {
      if (triesLeft > 0) retryTimer = setTimeout(() => setQuality(value, announce, triesLeft - 1), RETRY_MS);
      else if (announce) report({ failed: true }); // you tapped it: say it didn't work
      return;
    }
    if (!value || value === "auto") {
      p.setPlaybackQualityRange("auto", "auto");
      if (announce) report({ name: "Auto" });
      return;
    }
    const q = pickQuality(value, available);
    if (!q) {
      if (announce) report({ failed: true });
      return;
    }
    p.setPlaybackQualityRange(q, q);
    p.setPlaybackQuality?.(q);
    // "lower": this video doesn't go that high. "higher": it doesn't go that low.
    const diff = q === value ? "" : rank(q) > rank(value) ? "lower" : "higher";
    if (announce) report({ name: NAMES[q] || q, diff });
  }

  function changeVolume(step) {
    const p = player();
    if (!p || typeof p.setVolume !== "function") return;
    const tell = (v) => document.dispatchEvent(new CustomEvent("yas:volume", { detail: String(v) }));
    const muted = p.isMuted?.();
    const saved = p.getVolume();
    if (muted) {
      if (step < 0) return tell(0); // muted and turning down: stays muted
      // Muted and turning up: unmute at the volume you had (not from 0).
      const back = saved > 0 ? saved : step;
      p.setVolume(back);
      p.unMute?.();
      return tell(back);
    }
    const next = Math.max(0, Math.min(100, Math.round((saved + step) / 5) * 5));
    p.setVolume(next);
    if (next === 0) p.mute?.();
    tell(next);
  }

  document.addEventListener("yas:cmd", (event) => {
    if (document.documentElement.dataset.yas !== "on") return;
    let msg;
    try { msg = JSON.parse(String(event.detail)); } catch (e) { return; }
    if (msg.cmd === "quality") setQuality(msg.value, Boolean(msg.announce));
    if (msg.cmd === "volume") changeVolume(Number(msg.step) || 0);
    if (msg.cmd === "levels") {
      // Which qualities does the open video have? (for the popup: hide the rest)
      const levels = (player()?.getAvailableQualityLevels?.() || []).filter((q) => q !== "auto");
      document.dispatchEvent(new CustomEvent("yas:levels", { detail: JSON.stringify(levels) }));
    }
  });

  window.__yasPickQuality = pickQuality; // for tests
})();
