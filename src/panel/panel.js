/*
 * panel/panel.js
 * The "All settings" panel: the same settings as the toolbar popup, floating on the
 * YouTube page. Opened from the floating button's settings icon (content/features/dock.js).
 *
 *   - Drag it anywhere by its top bar. It remembers where you left it.
 *   - Close with X, Esc, or the settings icon again.
 *   - Arrow keys on the top bar move it too (hold Shift for bigger steps).
 *
 * How: background.js hands us popup.html, popup.css and the icons (content/assets.js); we draw them inside a closed
 * shadow root (the page's styles and scripts can't reach in), and popup.js runs on it
 * with YAS.popupUI.mount. No iframe: websites and other extensions can't block or
 * frame it, and there is one settings page for both the popup and the panel.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const WIDTH = 300;          // same width as the toolbar popup
  const MARGIN = 12;          // keep at least this much of a gap from the window edges
  const BAR = 36;             // height of the top bar
  const POS_KEY = "panelPos"; // where you last left it (chrome.storage.local)
  const SVG = "http://www.w3.org/2000/svg";

  let host = null;            // <pureflow-panel> on the page, null when closed
  let body = null;            // the scrolling settings area
  let pos = null;             // { x, y }: top-left corner in px
  let unmount = null;         // stops popup.js listening
  let opening = false;

  const css = `
    :host { all: initial; position: fixed; z-index: 2147483646; width: ${WIDTH}px; } /* the floating button stays on top */
    .panel { display: flex; flex-direction: column; overflow: hidden; border-radius: 14px;
      background: var(--bg, #fff); color: var(--text, #16181b); border: 1px solid rgba(0,0,0,.08);
      box-shadow: 0 12px 40px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.08);
      animation: in .14s ease-out; }
    @keyframes in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
    .bar { display: flex; align-items: center; gap: 8px; height: ${BAR}px; padding: 0 6px 0 12px; flex: none;
      cursor: grab; user-select: none; touch-action: none; border-bottom: 1px solid var(--line, #ececef);
      font: 600 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
    .bar:focus-visible { outline: 2px solid var(--accent, #0f9f8f); outline-offset: -2px; }
    .dragging .bar { cursor: grabbing; }
    .grip { width: 10px; height: 14px; opacity: .45;
      background: radial-gradient(circle, currentColor 1.2px, transparent 1.4px) 0 0 / 5px 5px; }
    .title { display: flex; align-items: center; gap: 6px; flex: 1; }
    .title img { width: 16px; height: 16px; border-radius: 4px; }
    .close { all: unset; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px;
      cursor: pointer; color: var(--muted, #6b7280); }
    .close:hover { background: var(--soft, #f4f4f6); color: var(--text, #16181b); }
    .close:focus-visible { outline: 2px solid var(--accent, #0f9f8f); }
    .close svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; fill: none; }
    .scroll { overflow-y: auto; overscroll-behavior: contain; }`;

  /** popup.css is written for a page (:root, body). Point it at the panel instead. */
  function adaptCss(text) {
    return text
      .replace(/:root/g, ":host")
      .replace(/(^|[\s,{}])(?:html|body)(?=[\s.,{:#[])/g, "$1.pf-body");
  }

  // ---------------------------------------------------------------------------
  // Position: always fully on screen
  // ---------------------------------------------------------------------------
  function place() {
    if (!host) return;
    const maxX = Math.max(MARGIN, innerWidth - WIDTH - MARGIN);
    const maxY = Math.max(MARGIN, innerHeight - BAR - MARGIN);
    pos = { x: Math.round(Math.min(Math.max(pos.x, MARGIN), maxX)), y: Math.round(Math.min(Math.max(pos.y, MARGIN), maxY)) };
    host.style.left = `${pos.x}px`;
    host.style.top = `${pos.y}px`;
    // A short window: the settings scroll inside the panel.
    body.style.maxHeight = `${Math.max(120, innerHeight - pos.y - BAR - MARGIN)}px`;
  }

  const save = () => { try { chrome.storage.local.set({ [POS_KEY]: pos }); } catch (e) { /* extension reloaded */ } };

  // ---------------------------------------------------------------------------
  // Drag by the top bar (mouse, pen or touch), or move with the arrow keys
  // ---------------------------------------------------------------------------
  function makeDraggable(bar, panel) {
    bar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".close")) return;
      event.preventDefault();
      const start = { x: event.clientX - pos.x, y: event.clientY - pos.y };
      try { bar.setPointerCapture(event.pointerId); } catch (e) { /* not supported */ }
      panel.classList.add("dragging");
      const move = (e) => { pos = { x: e.clientX - start.x, y: e.clientY - start.y }; place(); };
      const end = () => {
        panel.classList.remove("dragging");
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", end);
        bar.removeEventListener("pointercancel", end);
        save();
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", end);
      bar.addEventListener("pointercancel", end);
    });

    bar.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 40 : 10;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!moves[event.key]) return;
      event.preventDefault();
      pos = { x: pos.x + moves[event.key][0], y: pos.y + moves[event.key][1] };
      place();
      save();
    });
  }

  /**
   * popup.js normally talks to the tab with chrome.tabs. Here we ARE the tab,
   * so its messages go straight to content/main.js.
   */
  const tabsHere = {
    query: async () => [{ id: 1, url: location.href, status: "complete" }],
    sendMessage: (id, message) => new Promise((resolve) => (YAS.pageMessage ? YAS.pageMessage(message, resolve) : resolve(null))),
    reload: () => location.reload(),
  };

  // ---------------------------------------------------------------------------
  // Open and close
  // ---------------------------------------------------------------------------
  async function open() {
    const files = await YAS.assets();
    const saved = (await chrome.storage.local.get(POS_KEY))[POS_KEY];
    if (host || !opening) return; // already open, or closed again while it was loading

    host = document.createElement("pureflow-panel");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = adaptCss(files.css) + css;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "PureFlow settings");

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.tabIndex = 0;
    bar.title = "Drag to move";
    bar.setAttribute("aria-label", "PureFlow settings. Drag, or use the arrow keys, to move");
    const grip = document.createElement("span");
    grip.className = "grip";
    const title = document.createElement("span");
    title.className = "title";
    const icon = document.createElement("img");
    icon.src = files.icon32;
    icon.alt = "";
    title.append(icon, globalThis.YAS_BRAND?.name || "PureFlow");
    const closeButton = document.createElement("button");
    closeButton.className = "close";
    closeButton.title = "Close (Esc)";
    closeButton.setAttribute("aria-label", "Close PureFlow settings");
    const x = document.createElementNS(SVG, "svg");
    x.setAttribute("viewBox", "0 0 24 24");
    const xPath = document.createElementNS(SVG, "path");
    xPath.setAttribute("d", "M6 6l12 12M18 6L6 18");
    x.append(xPath);
    closeButton.append(x);
    closeButton.addEventListener("click", close);
    bar.append(grip, title, closeButton);

    // The settings page itself (popup.html without its scripts)
    body = document.createElement("div");
    body.className = "scroll pf-body in-panel";
    const page = new DOMParser().parseFromString(files.html, "text/html");
    page.querySelectorAll("script, link, title, meta").forEach((el) => el.remove());
    page.querySelectorAll("img[src]").forEach((img) => {
      img.src = files.icon16; // the footer logo
    });
    body.append(...[...page.body.childNodes].map((n) => document.importNode(n, true)));

    panel.append(bar, body);
    root.append(style, panel);
    makeDraggable(bar, panel);

    // Keys typed in the panel (e.g. your name) are ours: YouTube's shortcuts must not see them.
    for (const type of ["keydown", "keyup", "keypress"]) root.addEventListener(type, (e) => e.stopPropagation());
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.composedPath().some((el) => el.id === "name-input")) close();
    });

    pos = saved && Number.isFinite(saved.x) ? saved : { x: innerWidth - WIDTH - 24, y: 72 };
    (document.fullscreenElement || document.documentElement).appendChild(host);
    place();
    unmount = YAS.popupUI.mount(root, tabsHere);

    addEventListener("resize", place);
    document.addEventListener("fullscreenchange", onFullscreen);
    bar.focus({ preventScroll: true });
  }

  /** Full screen video: move the panel inside the full screen part, so it stays visible. */
  function onFullscreen() {
    if (!host) return;
    (document.fullscreenElement || document.documentElement).appendChild(host);
    place();
  }

  function close() {
    opening = false; // a second tap while it's still loading: don't open after all
    unmount?.();
    unmount = null;
    if (!host) return;
    host.remove();
    host = body = null;
    removeEventListener("resize", place);
    document.removeEventListener("fullscreenchange", onFullscreen);
    YAS.dock?.refresh?.();
  }

  YAS.panel = {
    /** ⚙ in the floating bar: open, or close if it's open (or still opening). */
    toggle() { if (host || opening) close(); else YAS.panel.open(); },
    open() {
      if (host || opening) return;
      opening = true;
      open().catch(close).finally(() => { opening = false; YAS.dock?.refresh?.(); });
    },
    close,
    isOpen: () => Boolean(host) || opening,
    _adaptCss: adaptCss, // for tests
  };
})();
