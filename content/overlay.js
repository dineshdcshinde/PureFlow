/*
 * content/overlay.js
 * The message box drawn on top of the YouTube player.
 *
 * It only knows HOW to draw itself. WHEN to show it is decided in content/main.js.
 * Styles live here (not in a .css file) so they always match this code version.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const OVERLAY_ID = "yas-overlay";
  const STYLE_ID = "yas-overlay-style";
  const CSS = `
    #${OVERLAY_ID} {
      position: absolute; inset: 0; z-index: 2147483647;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
      background: #0f0f0f; color: #fff; text-align: center; pointer-events: none;
      font-family: "YouTube Sans", Roboto, Arial, sans-serif;
      animation: yas-fade-in .15s ease-out;
    }
    #${OVERLAY_ID} .yas-spinner {
      width: 32px; height: 32px; border-radius: 50%;
      border: 3px solid rgba(255,255,255,.2); border-top-color: #3ea6ff;
      animation: yas-spin .8s linear infinite;
    }
    #${OVERLAY_ID} .yas-title { font-size: 17px; font-weight: 500; }
    #${OVERLAY_ID} .yas-detail { font-size: 13px; color: #aaa; max-width: 80%; }
    @keyframes yas-spin { to { transform: rotate(360deg); } }
    @keyframes yas-fade-in { from { opacity: 0; } }
  `;

  function addStyleOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function createBox() {
    const box = document.createElement("div");
    box.id = OVERLAY_ID;
    box.setAttribute("role", "status"); // screen readers announce the message
    for (const className of ["yas-spinner", "yas-title", "yas-detail"]) {
      const part = document.createElement("div");
      part.className = className;
      box.appendChild(part);
    }
    return box;
  }

  YAS.overlay = {
    /** Show (or update) the message on the player. */
    show(player, title, detail) {
      addStyleOnce();
      const box = document.getElementById(OVERLAY_ID) || createBox();
      box.querySelector(".yas-title").textContent = title;
      box.querySelector(".yas-detail").textContent = detail;
      if (box.parentNode !== player) player.appendChild(box);
    },

    /** Remove the message. Safe to call any time. */
    hide() {
      document.getElementById(OVERLAY_ID)?.remove();
    },

    /** Remove the message and its styles (used when the extension turns off). */
    destroy() {
      this.hide();
      document.getElementById(STYLE_ID)?.remove();
    },
  };
})();
