/*
 * content/features/quality.js
 * Default video quality. Works like speed:
 *   - Tapping a quality in the popup changes the video you're watching right away.
 *   - Every new video starts at that quality (or the best one below it).
 *   - If you change the quality by hand during a video, we leave it alone.
 *   - Never during an ad.
 *
 * The player's quality control lives in the page's world, so we ask bridge.js.
 * bridge.js keeps trying for a few seconds if the player isn't ready yet.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  let quality = "";      // "" = Auto (leave YouTube alone)
  let appliedFor = null; // video id we already set it for
  let loaded = false;    // have the saved settings arrived yet?

  const videoId = () => new URLSearchParams(location.search).get("v");
  const send = (value, announce = false) => {
    document.dispatchEvent(new CustomEvent("yas:cmd", { detail: JSON.stringify({ cmd: "quality", value, announce }) }));
  };

  YAS.quality = {
    /**
     * New choice. now = you tapped it in the popup: apply this instant and say so.
     * Otherwise (settings loaded or synced) the next "playing" applies it.
     */
    setQuality(value, adIsPlaying, { now = false } = {}) {
      const next = value || "";
      const changed = next !== quality;
      quality = next;
      if (!now) {
        // Saved settings arriving when the page opens: the first video gets them when it plays.
        // A change synced from another window later: leave the open video alone
        // (you may have picked its quality by hand); the next video gets the new one.
        if (changed) appliedFor = loaded ? videoId() : null;
        loaded = true;
        return;
      }
      // You tapped it in the popup: change the open video this instant and say so.
      if (adIsPlaying || !videoId()) { appliedFor = null; return; }
      appliedFor = videoId(); // a later "playing" of this video won't undo a manual change
      send(quality || "auto", true);
    },

    /**
     * Qualities the open video has, best first, e.g. ["hd1080", "hd720", "large"].
     * Empty if the player isn't ready (then the popup shows every choice).
     * bridge.js answers during the dispatch, so this is immediate.
     */
    available() {
      let levels = [];
      const onAnswer = (event) => {
        try { levels = JSON.parse(event.detail); } catch (e) { /* bad data: ignore */ }
      };
      document.addEventListener("yas:levels", onAnswer);
      document.dispatchEvent(new CustomEvent("yas:cmd", { detail: JSON.stringify({ cmd: "levels" }) }));
      document.removeEventListener("yas:levels", onAnswer);
      return Array.isArray(levels) ? levels : [];
    },

    /** Call on "playing". Sets the quality once per new video. */
    onPlaying(adIsPlaying) {
      const id = videoId();
      if (!quality || adIsPlaying || !id || appliedFor === id) return;
      appliedFor = id;
      send(quality);
    },
  };
})();
