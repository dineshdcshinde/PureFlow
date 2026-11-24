/*
 * content/features/notices.js
 * Hide YouTube's "Experiencing interruptions? Find out why" popup.
 *
 * YouTube shows it in its popup area (ytd-popup-container), in the same small
 * popup it uses for normal messages ("Saved to Watch later", "Link copied").
 * So we never hide that popup for good: we mark it only while it shows the
 * interruptions message, and hide.css hides what is marked.
 *
 * Light: one observer on the small popup area only, never on the whole page.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const MARK = "data-yas-hidden-notice";
  const POPUP_AREA = "ytd-popup-container";
  const POPUPS = "tp-yt-paper-toast, yt-notification-action-renderer, tp-yt-paper-dialog";
  const INTERRUPTIONS = /experiencing interruptions/i;
  const AD_BLOCK_HELP = /ad[_-]?block/i; // its "Find out why" link points to help about ad blockers
  const FIND_AREA_MS = 1000;           // the popup area appears soon after the page loads

  let observer = null;
  let findTimer = null;

  function isInterruptionsNotice(popup) {
    if (INTERRUPTIONS.test(popup.textContent || "")) return true;
    return [...popup.querySelectorAll("a[href]")].some((a) => AD_BLOCK_HELP.test(a.href));
  }

  /** Mark (or unmark) every popup, based on what it says right now. */
  function check(area) {
    for (const popup of area.querySelectorAll(POPUPS)) {
      popup.toggleAttribute(MARK, isInterruptionsNotice(popup));
    }
  }

  function watch() {
    const area = document.querySelector(POPUP_AREA);
    if (!area) return false;
    clearInterval(findTimer);
    findTimer = null;
    observer = new MutationObserver(() => check(area));
    observer.observe(area, { childList: true, subtree: true, characterData: true });
    check(area);
    return true;
  }

  YAS.notices = {
    start() {
      if (observer || findTimer) return;
      if (!watch()) findTimer = setInterval(watch, FIND_AREA_MS);
    },

    stop() {
      clearInterval(findTimer);
      findTimer = null;
      observer?.disconnect();
      observer = null;
      document.querySelectorAll(`[${MARK}]`).forEach((el) => el.removeAttribute(MARK));
    },

    _isInterruptionsNotice: isInterruptionsNotice, // for tests
  };
})();
