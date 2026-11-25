/*
 * content/features/controls.js
 * How you reach the tools: keyboard shortcuts, the mouse wheel and two small
 * buttons on the player. It only listens and reports what you asked for;
 * content/main.js decides what happens.
 *
 *   Shift+S  save a screenshot          Shift+L  loop part of the video
 *   Mouse wheel over the player: volume up / down (if switched on)
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const SHORTCUTS = { KeyS: "screenshot", KeyL: "loop" };
  const BUTTONS_CLASS = "yas-player-btn";
  const VOLUME_STEP = 5;
  const SVG = "http://www.w3.org/2000/svg";
  // Outline icons on a 24x24 grid, drawn with a 2px line: the same style and size as
  // YouTube's own player icons, so they sit in line with Subtitles and Settings.
  const ICONS = {
    screenshot: [ // camera
      "M3 8.5A1.5 1.5 0 0 1 4.5 7h2.7l1.6-2.4A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.2.6L16.8 7h2.7A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
      "M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    ],
    loop: [ // two arrows going round
      "M17 3l3 3-3 3",
      "M4 12v-1a5 5 0 0 1 5-5h11",
      "M7 21l-3-3 3-3",
      "M20 12v1a5 5 0 0 1-5 5H4",
    ],
  };

  /** Typing in a box (search, comments): shortcuts must not fire. */
  function isTyping(target, event) {
    target = event?.composedPath?.()[0] || target; // the real box, even inside a shadow root (our panel)
    if (!target || !(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
  }

  function makeButton(action, label) {
    const button = document.createElement("button");
    button.className = `ytp-button ${BUTTONS_CLASS}`;
    button.dataset.yasAction = action;
    button.title = label; // YouTube's tooltips only work on its own buttons, so use the browser's
    button.setAttribute("aria-label", label);
    // Same markup as YouTube's buttons: a 24x24 svg that the player bar centres.
    const svg = document.createElementNS(SVG, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "24", height: "24", fill: "none",
      stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) {
      svg.setAttribute(k, v);
    }
    for (const d of ICONS[action]) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    button.appendChild(svg);
    return button;
  }

  // One mouse-wheel notch is about 100px. A trackpad sends many tiny steps, so we add
  // them up and change the volume once per notch's worth, never 5% per tiny step.
  const WHEEL_NOTCH_PX = 100;
  const WHEEL_PAUSE_MS = 400; // a new scroll after this long starts counting again
  const LINE_PX = 33, PAGE_PX = 800; // Firefox may report lines or pages instead of pixels

  // Each running copy of PureFlow marks its own buttons, so a copy that is shutting
  // down (extension reloaded) never removes or reuses the new copy's buttons.
  const COPY = Math.random().toString(36).slice(2);

  let onAction = () => {};
  let canAct = () => false;    // set by main.js: on, video open, no ad
  let wheelOn = false;
  let shortcutsOn = false;
  let wheel = { total: 0, at: 0, dir: 0 };

  function onKeyDown(event) {
    if (!shortcutsOn || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const action = SHORTCUTS[event.code];
    if (!action || isTyping(event.target, event) || !canAct()) return; // not ours: leave the key alone
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return; // holding the key down: act once, not 10 times
    onAction(action);
  }

  function onWheel(event) {
    if (!wheelOn || event.ctrlKey || !event.deltaY) return;
    // Leave scrolling alone in YouTube's own menus and panels inside the player.
    if (event.target.closest?.(".ytp-settings-menu, .ytp-panel, .ytp-popup, .ytp-chrome-top")) return;
    if (!canAct()) return; // during an ad, or PureFlow paused: the page scrolls as usual
    event.preventDefault();

    const px = event.deltaY * (event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1);
    const now = Date.now();
    const fresh = now - wheel.at > WHEEL_PAUSE_MS || Math.sign(px) !== wheel.dir;
    wheel.at = now;
    wheel.dir = Math.sign(px);
    if (fresh) {
      wheel.total = 0; // a new scroll: act at once, so one notch always works
    } else {
      wheel.total += Math.abs(px); // same scroll going on: one step per notch's worth
      if (wheel.total < WHEEL_NOTCH_PX) return;
      wheel.total -= WHEEL_NOTCH_PX;
    }
    onAction("volume", px < 0 ? VOLUME_STEP : -VOLUME_STEP);
  }

  const ownButtons = (root) => root.querySelector(`.${BUTTONS_CLASS}[data-yas-copy="${COPY}"]`);

  YAS.controls = {
    /** handler(action, step): do it. ready(): may we act right now? */
    start(handler, ready) {
      onAction = handler;
      canAct = ready;
      document.addEventListener("keydown", onKeyDown, true);
    },

    /** This copy shuts down: stop listening. Buttons are removed by main.js (owner only). */
    stop() {
      shortcutsOn = false;
      wheelOn = false; // the wheel listener stays on the player, but does nothing now
      canAct = () => false;
      document.removeEventListener("keydown", onKeyDown, true);
    },

    configure({ shortcuts, wheelVolume }) {
      shortcutsOn = Boolean(shortcuts);
      wheelOn = Boolean(wheelVolume);
    },

    /** Listen for the wheel on this player (called once per player element). */
    attach(player) {
      player.addEventListener("wheel", onWheel, { passive: false });
    },

    /** Add the screenshot and loop buttons to the player bar (once per copy). */
    addButtons(player) {
      // Newer player bar has groups inside; older one is a flat row. Fit either.
      const bar = player?.querySelector(".ytp-right-controls-left, .ytp-right-controls");
      if (!bar || ownButtons(player)) return;
      YAS.controls.removeButtons(); // buttons left by an older copy: replace them
      const loop = makeButton("loop", "Loop part of this video (Shift+L)");
      const shot = makeButton("screenshot", "Save a screenshot (Shift+S)");
      for (const button of [loop, shot]) {
        button.dataset.yasCopy = COPY;
        button.addEventListener("click", (e) => { e.stopPropagation(); onAction(button.dataset.yasAction); });
        bar.insertBefore(button, bar.firstChild);
      }
    },

    removeButtons() {
      document.querySelectorAll(`.${BUTTONS_CLASS}`).forEach((b) => b.remove());
    },

    /** Show the loop state on its button: off, waiting for the end, or looping. */
    showLoop(status) {
      const button = document.querySelector(`.${BUTTONS_CLASS}[data-yas-copy="${COPY}"][data-yas-action="loop"]`);
      if (button) button.dataset.yasLoop = status;
    },
  };
})();
