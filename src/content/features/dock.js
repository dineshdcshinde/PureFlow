/*
 * content/features/dock.js
 * The floating PureFlow button on YouTube. Always there, out of the way:
 *
 *   ( P )                      closed: one small round button. Drag it anywhere.
 *   ( P )  − 1.5× +  1080p ▾  |  📷  ⟲  ◎  |  ⚙      open: one row of quick controls
 *
 *   Speed − / +     slower / faster, on this video and every next one
 *   Quality         only the qualities this video has
 *   Screenshot      save the frame (same as Shift+S)
 *   Loop            tap at the start, tap at the end, tap to stop (same as Shift+L)
 *   Focus           one tap hides Shorts, comments, suggestions and end screens; again to show
 *   Settings        all settings, in a panel on the page
 *
 * Tap the round button to open or close the row. It remembers where you put it and
 * whether it was open. Hidden in full screen, and when PureFlow is paused.
 * It only draws and reports taps; content/main.js does the work (same as controls.js).
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const QUALITY_NAMES = { highres: "8K", hd2880: "5K", hd2160: "4K", hd1440: "1440p", hd1080: "1080p", hd720: "720p",
    large: "480p", medium: "360p", small: "240p", tiny: "144p" };
  const FAB = 44;            // round button size
  const MARGIN = 12;         // gap to the window edges
  const DRAG_PX = 4;         // move less than this = a tap, not a drag
  const KEY = { pos: "dockPos", open: "dockOpen" };
  const SVG = "http://www.w3.org/2000/svg";
  const ICONS = {
    screenshot: ["M3 8.5A1.5 1.5 0 0 1 4.5 7h2.7l1.6-2.4A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.2.6L16.8 7h2.7A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
      "M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"],
    loop: ["M17 3l3 3-3 3", "M4 12v-1a5 5 0 0 1 5-5h11", "M7 21l-3-3 3-3", "M20 12v1a5 5 0 0 1-5 5H4"],
    focus: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"],
    settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
    minus: ["M6 12h12"],
    plus: ["M12 6v12", "M6 12h12"],
  };

  const CSS = `
    :host { all: initial; position: fixed; z-index: 2147483647; } /* above the settings panel, so its icon can close it */
    * { box-sizing: border-box; }
    .dock { position: relative; display: flex; align-items: center; gap: 4px; height: ${FAB}px; padding: 0; border-radius: 999px;
      background: rgba(24,24,26,.92); color: #fff; border: 1px solid rgba(255,255,255,.12);
      box-shadow: 0 8px 28px rgba(0,0,0,.28), 0 1px 4px rgba(0,0,0,.2);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      font: 500 13px/1 Roboto, "YouTube Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
    .dock.flip { flex-direction: row-reverse; }
    .open.dock { padding-right: 6px; }
    .open.flip.dock { padding: 0 0 0 6px; }
    button { all: unset; box-sizing: border-box; display: grid; place-items: center; cursor: pointer;
      color: inherit; border-radius: 999px; -webkit-tap-highlight-color: transparent; }
    button:focus-visible { outline: 2px solid #2cc5b3; outline-offset: 1px; }
    button:hover:not(:disabled) { background: rgba(255,255,255,.12); }
    button:disabled { opacity: .35; cursor: default; }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .fab { width: ${FAB - 2}px; height: ${FAB - 2}px; flex: none; cursor: grab; touch-action: none; }
    .fab:active { cursor: grabbing; }
    .fab img { width: 26px; height: 26px; border-radius: 7px; pointer-events: none; user-select: none; -webkit-user-drag: none; }
    .row { display: none; align-items: center; gap: 2px; }
    .open .row { display: flex; animation: grow .14s ease-out; }
    @keyframes grow { from { opacity: 0; transform: scaleX(.92); } }
    .icon { width: 34px; height: 34px; }
    .speed { display: flex; align-items: center; height: 34px; border-radius: 999px; background: rgba(255,255,255,.07); }
    .speed button { width: 28px; height: 34px; }
    .speed svg { width: 16px; height: 16px; }
    .value { min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
    .quality { height: 34px; padding: 0 10px 0 12px; gap: 4px; display: flex; align-items: center;
      background: rgba(255,255,255,.07); font-variant-numeric: tabular-nums; }
    .quality::after { content: ""; width: 0; height: 0; margin-left: 2px;
      border: 4px solid transparent; border-top-color: currentColor; transform: translateY(2px); }
    .sep { width: 1px; height: 20px; margin: 0 4px; background: rgba(255,255,255,.16); }
    .on { color: #2cc5b3; }
    .waiting { color: #f5b942; }
    .menu { position: absolute; display: grid; gap: 2px; min-width: 96px; padding: 6px; border-radius: 14px;
      background: rgba(24,24,26,.96); color: #fff; border: 1px solid rgba(255,255,255,.12);
      box-shadow: 0 8px 28px rgba(0,0,0,.3); }
    .menu[hidden] { display: none; }
    .menu.up { bottom: calc(100% + 8px); }
    .menu:not(.up) { top: calc(100% + 8px); }
    .menu button { justify-content: start; padding: 7px 12px; border-radius: 8px; font-variant-numeric: tabular-nums; }
    .menu button[aria-checked="true"] { color: #2cc5b3; }
    .menu button[aria-checked="true"]::after { content: "✓"; margin-left: auto; padding-left: 12px; }
    .menu button { display: flex; }
    .menu .note { padding: 4px 12px 6px; color: rgba(255,255,255,.6); font-size: 11.5px; max-width: 180px; line-height: 1.35; }
  `;

  let handlers = null;       // { state(), act(action, value) } from main.js
  let host = null, ui = null;
  let pos = null;            // top-left of the round button
  let isOpen = false;

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------
  function icon(name) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ICONS[name]) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  function button(cls, label, content, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.title = label;
    b.setAttribute("aria-label", label);
    if (content) b.append(content);
    if (action) b.dataset.action = action;
    return b;
  }

  function build() {
    host = document.createElement("pureflow-dock");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;

    const dock = document.createElement("div");
    dock.className = "dock";
    const fab = button("fab", "PureFlow: tap for quick controls, drag to move");
    fab.setAttribute("aria-expanded", "false");
    const logo = document.createElement("img");
    logo.alt = "";
    logo.draggable = false;
    fab.append(logo);

    const row = document.createElement("div");
    row.className = "row";
    row.setAttribute("role", "toolbar");
    row.setAttribute("aria-label", "PureFlow quick controls");

    const speed = document.createElement("div");
    speed.className = "speed";
    const slower = button("", "Slower", icon("minus"), "slower");
    const value = document.createElement("span");
    value.className = "value";
    value.setAttribute("aria-live", "polite");
    const faster = button("", "Faster", icon("plus"), "faster");
    speed.append(slower, value, faster);

    const quality = button("quality", "Video quality", null, "quality");
    quality.setAttribute("aria-haspopup", "menu");
    const sep = () => Object.assign(document.createElement("span"), { className: "sep" });
    const shot = button("icon", "Save a screenshot (Shift+S)", icon("screenshot"), "screenshot");
    const loop = button("icon", "Loop part of this video (Shift+L)", icon("loop"), "loop");
    const focus = button("icon", "Focus: hide Shorts, comments and suggestions", icon("focus"), "focus");
    focus.setAttribute("aria-pressed", "false");
    const settings = button("icon", "All settings", icon("settings"), "settings");
    row.append(speed, quality, sep(), shot, loop, focus, sep(), settings);

    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    dock.append(fab, row, menu);
    root.append(style, dock);
    ui = { dock, fab, row, value, slower, faster, quality, shot, loop, focus, settings, menu };

    makeDraggable(fab);
    row.addEventListener("click", onRowClick);
    menu.addEventListener("click", onMenuClick);
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!menu.hidden) { menu.hidden = true; quality.focus(); } else setOpen(false);
    });
  }

  // ---------------------------------------------------------------------------
  // Showing the current state
  // ---------------------------------------------------------------------------
  const speedLabel = (s) => `${Number(s.toFixed(2))}×`;
  const qualityLabel = (q) => (q ? QUALITY_NAMES[q] || q : "Auto");

  function render() {
    if (!ui || !handlers) return;
    const s = handlers.state();
    ui.value.textContent = speedLabel(s.speed);
    ui.slower.disabled = s.speed <= SPEEDS[0];
    ui.faster.disabled = s.speed >= SPEEDS.at(-1);
    ui.quality.textContent = qualityLabel(s.quality);
    for (const b of [ui.quality, ui.shot, ui.loop]) b.disabled = !s.watch; // only with a video open
    ui.loop.classList.toggle("on", s.loop === "on");
    ui.loop.classList.toggle("waiting", s.loop === "start");
    ui.loop.title = s.loop === "start" ? "Loop: tap again where it should end" : s.loop === "on" ? "Loop on: tap to stop" : "Loop part of this video (Shift+L)";
    ui.focus.classList.toggle("on", s.focus);
    ui.focus.setAttribute("aria-pressed", String(s.focus));
    ui.focus.title = s.focus ? "Focus on: tap to show everything again" : "Focus: hide Shorts, comments and suggestions";
    ui.settings.classList.toggle("on", s.settingsOpen);
    if (!s.watch) ui.menu.hidden = true;
    if (isOpen) place(); // the row got wider or narrower: keep the round button where it is
  }

  /** Quality choices for this video: Auto, then what the player has, best first. */
  function showQualityMenu() {
    const s = handlers.state();
    const menu = ui.menu;
    menu.replaceChildren();
    const choices = ["", ...(s.qualities.length ? s.qualities : Object.keys(QUALITY_NAMES))].filter((q) => q === "" || QUALITY_NAMES[q]);
    for (const q of choices) {
      const b = button("", qualityLabel(q), qualityLabel(q));
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", String(q === (s.quality || "")));
      b.dataset.quality = q;
      menu.append(b);
    }
    if (s.quality && s.qualities.length && !s.qualities.includes(s.quality)) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = `Your default is ${qualityLabel(s.quality)}. This video goes up to ${qualityLabel(s.qualities[0])}.`;
      menu.append(note);
    }
    menu.hidden = false;
    // Open upward when the dock is in the lower half of the window; line up with the button.
    menu.classList.toggle("up", pos.y > innerHeight / 2);
    const dockBox = ui.dock.getBoundingClientRect(), qBox = ui.quality.getBoundingClientRect();
    menu.style.left = `${Math.max(0, qBox.left - dockBox.left)}px`;
    menu.querySelector('[aria-checked="true"]')?.focus();
  }

  // ---------------------------------------------------------------------------
  // Taps
  // ---------------------------------------------------------------------------
  function onRowClick(event) {
    const b = event.target.closest("button[data-action]");
    if (!b || b.disabled) return;
    const action = b.dataset.action;
    if (action !== "quality") ui.menu.hidden = true;
    if (action === "slower" || action === "faster") {
      const now = handlers.state().speed;
      const next = action === "faster" ? SPEEDS.find((v) => v > now + 0.001) : [...SPEEDS].reverse().find((v) => v < now - 0.001);
      if (next) handlers.act("speed", next);
    } else if (action === "quality") {
      if (ui.menu.hidden) showQualityMenu(); else ui.menu.hidden = true;
      return;
    } else if (action === "focus") {
      handlers.act("focus", !handlers.state().focus);
    } else {
      handlers.act(action);
    }
    render();
  }

  function onMenuClick(event) {
    const b = event.target.closest("button[data-quality]");
    if (!b) return;
    ui.menu.hidden = true;
    handlers.act("quality", b.dataset.quality);
    render();
    ui.quality.focus();
  }

  function setOpen(open, { remember = true } = {}) {
    isOpen = open;
    ui.dock.classList.toggle("open", open);
    ui.fab.setAttribute("aria-expanded", String(open));
    if (!open) ui.menu.hidden = true;
    render();
    place();
    if (remember) store({ [KEY.open]: open });
  }

  // ---------------------------------------------------------------------------
  // Position: the round button stays where you put it. The row opens to the
  // right, or to the left when there's no room (then the button stays put).
  // ---------------------------------------------------------------------------
  function place() {
    if (!host) return;
    const x = Math.min(Math.max(pos.x, MARGIN), Math.max(MARGIN, innerWidth - FAB - MARGIN));
    const y = Math.min(Math.max(pos.y, MARGIN), Math.max(MARGIN, innerHeight - FAB - MARGIN));
    pos = { x, y };
    const width = isOpen ? ui.dock.offsetWidth : FAB;
    const flip = isOpen && x + width > innerWidth - MARGIN && x + FAB - width >= MARGIN;
    ui.dock.classList.toggle("flip", flip);
    host.style.left = `${flip ? x + FAB - width : x}px`;
    host.style.top = `${y}px`;
  }

  function makeDraggable(fab) {
    fab.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      // Stop the browser starting its own drag-and-drop (it would cancel ours halfway).
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, pos: { ...pos } };
      let dragging = false;
      try { fab.setPointerCapture(event.pointerId); } catch (e) { /* not supported */ }
      const move = (e) => {
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!dragging && Math.hypot(dx, dy) < DRAG_PX) return;
        dragging = true;
        pos = { x: start.pos.x + dx, y: start.pos.y + dy };
        place();
      };
      const end = (e) => {
        fab.removeEventListener("pointermove", move);
        fab.removeEventListener("pointerup", end);
        fab.removeEventListener("pointercancel", end);
        if (dragging) store({ [KEY.pos]: pos });
        else if (e.type === "pointerup") setOpen(!isOpen); // a tap
      };
      fab.addEventListener("pointermove", move);
      fab.addEventListener("pointerup", end);
      fab.addEventListener("pointercancel", end);
    });
    // Keyboard: Enter / Space opens and closes (a pointer tap is handled above).
    fab.addEventListener("click", (e) => { if (e.detail === 0) setOpen(!isOpen); });
    fab.addEventListener("dragstart", (e) => e.preventDefault());
  }

  const store = (values) => { try { chrome.storage.local.set(values); } catch (e) { /* extension reloaded */ } };

  /** Full screen video: get out of the way. */
  const onFullscreen = () => { if (host) host.style.display = document.fullscreenElement ? "none" : ""; };
  /** The speed changed (by us or in YouTube's own menu): show it. */
  const onRate = () => render();

  // ---------------------------------------------------------------------------
  // API for main.js
  // ---------------------------------------------------------------------------
  YAS.dock = {
    /** Show the button. h.state(): what to show; h.act(action, value): do it. */
    async start(h) {
      handlers = h;
      if (host) return render();
      build();
      YAS.assets?.().then((files) => { if (ui) ui.fab.querySelector("img").src = files.icon32; }).catch(() => {});
      const saved = await chrome.storage.local.get([KEY.pos, KEY.open]).catch(() => ({}));
      if (!handlers || !host) return; // stopped while loading
      pos = saved[KEY.pos] && Number.isFinite(saved[KEY.pos].x) ? saved[KEY.pos]
        : { x: innerWidth - FAB - 24, y: innerHeight - FAB - 24 }; // bottom right
      (document.body || document.documentElement).appendChild(host);
      setOpen(Boolean(saved[KEY.open]), { remember: false });
      onFullscreen();
      addEventListener("resize", place);
      document.addEventListener("fullscreenchange", onFullscreen);
      document.addEventListener("ratechange", onRate, true);
    },

    stop() {
      handlers = null;
      host?.remove();
      host = ui = null;
      removeEventListener("resize", place);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("ratechange", onRate, true);
    },

    /** Something changed (settings, video, loop): redraw. */
    refresh: render,
    isShown: () => Boolean(host),
    SPEEDS,
  };
})();
