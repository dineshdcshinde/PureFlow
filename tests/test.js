// Automated tests for PureFlow. Runs the real extension files in a fake YouTube page (jsdom).
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const EXT = path.join(__dirname, "..", "dist", "chrome"); // built by: node scripts/build.js chrome
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const CONTENT_FILES = MANIFEST.content_scripts.find((s) => s.world !== "MAIN").js;
const read = (f) => fs.readFileSync(path.join(EXT, f), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, ok, extra = "") {
  if (ok) { passed++; console.log("  PASS", name); }
  else { failed++; console.log("  FAIL", name, extra); }
}

/** A fake chrome.* API: storage (sync + local) with change events, and messaging. */
function makeChrome(id = "test-id") {
  const data = { sync: {}, local: {} };
  const listeners = [];
  const area = (name) => ({
    get: async (defaults) => ({ ...(defaults || {}), ...data[name] }),
    set: async (values) => {
      Object.assign(data[name], values);
      const changes = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { newValue: v }]));
      listeners.forEach((listener) => listener(changes, name));
    },
  });
  const sent = [];
  const messageListeners = [];
  return {
    runtime: {
      id,
      getURL: (p) => "chrome-extension://x/" + p,
      getManifest: () => ({ version: "9.9.9" }),
      sendMessage: (message) => { sent.push(message); return Promise.resolve(); },
      onMessage: { addListener: (l) => messageListeners.push(l), removeListener() {} },
    },
    /** Pretend the popup sent this message to the page; returns the reply. */
    _deliver: (message) => new Promise((resolve) => messageListeners.forEach((l) => l(message, {}, resolve))),
    storage: { sync: area("sync"), local: area("local"), onChanged: { addListener: (l) => listeners.push(l) } },
    _data: data,
    _sent: sent,
  };
}

/** Build a fake YouTube watch page with a player and a controllable <video>. */
function makePage({ late = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="movie_player" class="html5-video-player"><video></video><div class="video-ads"></div></div>
    </body></html>`, { url: "https://www.youtube.com/watch?v=abc", runScripts: "outside-only" });
  const w = dom.window;
  const doc = w.document;
  Object.defineProperty(doc, "readyState", { get: () => (late ? "complete" : "loading"), configurable: true });
  const video = doc.querySelector("video");
  const v = { src: "blob:yours", duration: 240, currentTime: 0, paused: false, playbackRate: 1, muted: false, readyState: 4 };
  for (const k of Object.keys(v)) {
    Object.defineProperty(video, k, { get: () => v[k], set: (x) => { v[k] = x; }, configurable: true });
  }
  Object.defineProperty(video, "currentSrc", { get: () => v.src, configurable: true });
  w.chrome = makeChrome();
  Object.defineProperty(w, "crypto", { value: globalThis.crypto, configurable: true }); // real SubtleCrypto
  w.TextEncoder = TextEncoder;  // real browsers have this; jsdom does not
  w.Response = Response; w.Request = Request;
  const reloads = [];
  w.YAS = { navigate: (url) => reloads.push(url) }; // record reloads instead of navigating
  const run = (file) => w.eval(read(file));
  return { w, doc, video, v, reloads, player: doc.querySelector("#movie_player"), run,
    overlay: () => doc.getElementById("yas-overlay"),
    overlayText: () => doc.getElementById("yas-overlay")?.textContent || "",
    loadContent: () => CONTENT_FILES.forEach(run) };
}

async function testNormalNavigationShowsNothing() {
  console.log("1. Normal next/previous (extension on from page load): no message");
  const p = makePage();
  p.loadContent();
  check("tab switched on", p.doc.documentElement.dataset.yas === "on");
  p.player.classList.add("buffering-mode", "unstarted-mode"); // YouTube loading the next video
  await sleep(3000);
  check("no message during a 3s normal load", !p.overlay());
}

async function testVideoAd() {
  console.log("2. Video ad gets through: message + fast-forward, then everything restored");
  const p = makePage();
  p.loadContent();
  p.v.currentTime = 30; p.video.dispatchEvent(new p.w.Event("timeupdate")); // you were watching
  // ad starts: different source, 15s long
  p.v.src = "blob:ad"; p.v.duration = 15; p.v.currentTime = 0;
  p.player.classList.add("ad-showing");
  await sleep(50);
  check("message shown", /Ad skipped/.test(p.overlayText()), p.overlayText());
  check("ad muted and at 16x", p.v.muted === true && p.v.playbackRate === 16);
  check("ad jumped to its end", p.v.currentTime === 15);
  p.player.classList.remove("ad-showing");
  p.v.src = "blob:yours";
  await sleep(50);
  check("message gone after ad", !p.overlay());
  check("sound and speed restored", p.v.muted === false && p.v.playbackRate === 1);
}

async function testPictureAdNeverTouchesYourVideo() {
  console.log("3. Picture ad (your video paused underneath): message, your video untouched, one clean reload");
  const p = makePage();
  p.loadContent();
  p.v.currentTime = 200; p.video.dispatchEvent(new p.w.Event("timeupdate"));
  p.v.paused = true;
  p.player.classList.add("ad-showing"); // same source = your video
  await sleep(300);
  check("message shown right away", /Ad blocked/.test(p.overlayText()), p.overlayText());
  check("no reload before 0.8s", p.reloads.length === 0);
  await sleep(800);
  check("your video NOT jumped (stays at 200s)", p.v.currentTime === 200);
  check("no ad sound while the picture ad shows", p.v.muted === true);
  check("reloaded once, back at 200s", p.reloads.length === 1 && /[?&]t=200s/.test(p.reloads[0]), p.reloads.join());
  p.player.classList.remove("ad-showing");
  await sleep(50);
  check("message gone after ad", !p.overlay());
  check("your sound and speed restored after the ad", p.v.muted === false && p.v.playbackRate === 1);
  // same video gets another picture ad: must NOT reload again (no loops)
  p.player.classList.add("ad-showing");
  await sleep(1100);
  check("never reloads the same video twice", p.reloads.length === 1, p.reloads.join());
}

async function testLateStartStuck() {
  console.log("4. Switched on in an open tab + video stuck: message after 1.5s, gone when it plays");
  const p = makePage({ late: true });
  p.loadContent();
  p.player.classList.add("buffering-mode");
  await sleep(1000);
  check("no message before 1.5s", !p.overlay());
  await sleep(1200); // 2.2s: well past 1.5s, still before the 3s reload
  check("message after 1.5s", /back on/.test(p.overlayText()), p.overlayText());
  p.player.classList.remove("buffering-mode");
  p.v.currentTime = 1;
  await sleep(400);
  check("message gone once video plays", !p.overlay());
  check("no reload needed", p.reloads.length === 0);
}

async function testLateStartStuckReload() {
  console.log("4b. Switched on in an open tab + stuck over 3s: one clean reload");
  const p = makePage({ late: true });
  p.loadContent();
  p.player.classList.add("buffering-mode");
  await sleep(3400);
  check("reloaded once", p.reloads.length === 1, p.reloads.join());
}

async function testLateStartFastLoad() {
  console.log("5. Switched on in an open tab, video loads quickly: no message");
  const p = makePage({ late: true });
  p.loadContent();
  p.player.classList.add("buffering-mode");
  await sleep(800);
  p.player.classList.remove("buffering-mode");
  p.v.currentTime = 0.5;
  await sleep(2000);
  check("no message", !p.overlay());
}

async function testTurnOff() {
  console.log("6. Extension switched off: everything undone within ~1s");
  const p = makePage();
  p.loadContent();
  p.v.src = "blob:ad"; p.v.duration = 15;
  p.player.classList.add("ad-showing");
  await sleep(50);
  p.w.chrome.runtime.id = undefined; // what Chrome does to a switched-off extension
  await sleep(1200);
  check("tab flag removed (CSS + data cleaner off)", !("yas" in p.doc.documentElement.dataset));
  check("message removed", !p.overlay());
  check("overlay styles removed", !p.doc.getElementById("yas-overlay-style"));
}

async function testOffOnTakeover() {
  console.log("7. Off then quickly on again: new copy takes over, tab stays on");
  const p = makePage();
  p.loadContent();
  const oldChrome = p.w.chrome;
  // Chrome switches the old copy off and adds a new copy
  p.w.chrome = makeChrome("new-id");
  oldChrome.runtime.id = undefined;
  p.loadContent();
  await sleep(2300);
  check("tab still on after the old copy shut down", p.doc.documentElement.dataset.yas === "on");
}

async function testDataCleaner() {
  console.log("8. inject.js removes ad data only while on, only from video data");
  const p = makePage();
  const adData = () => JSON.stringify({ adPlacements: [1], playerAds: [2], adSlots: [3], videoDetails: { id: "x" } });
  let body = adData();
  p.w.fetch = async (url) => new Response(body, { status: 200 });
  p.doc.documentElement.dataset.yas = "on";
  p.run("inject.js");

  const parsed = p.w.JSON.parse(adData());
  check("JSON.parse: ad keys removed", !("adPlacements" in parsed) && !("playerAds" in parsed) && !("adSlots" in parsed));
  check("JSON.parse: video data kept", parsed.videoDetails.id === "x");

  const viaFetch = await (await p.w.fetch("https://www.youtube.com/youtubei/v1/player?x=1")).text();
  check("fetch /player: ad keys removed", !viaFetch.includes("adPlacements"), viaFetch);

  const nested = JSON.stringify({ a: { b: { playerAds: [1] } } });
  body = nested;
  const viaNext = await (await p.w.fetch("https://www.youtube.com/youtubei/v1/next")).text();
  check("fetch /next: nested ad keys removed", !viaNext.includes("playerAds"), viaNext);

  delete p.doc.documentElement.dataset.yas; // extension off
  const offParsed = p.w.JSON.parse(adData());
  check("when off: nothing removed", "adPlacements" in offParsed);

  p.w.ytInitialPlayerResponse = undefined;
}


// ============================ V2 features ============================

const fire = (p, name, detail) => p.doc.dispatchEvent(new p.w.CustomEvent(name, { detail }));

async function testStats() {
  console.log("9. Stats: ads removed before loading and ads skipped are counted");
  const p = makePage();
  p.loadContent();
  fire(p, "yas:ads-removed", "2"); // inject.js removed 2 ad breaks
  await p.w.YAS.stats.flush();
  const saved = p.w.chrome._data.local;
  check("2 ads counted", saved.adsBlocked === 2, JSON.stringify(saved));
  check("about 30s saved (2 x 15s)", saved.secondsSaved === 30, JSON.stringify(saved));
  // a video ad that got through and was fast-forwarded
  p.v.currentTime = 40; p.video.dispatchEvent(new p.w.Event("timeupdate"));
  p.v.src = "blob:ad"; p.v.duration = 20; p.v.currentTime = 0;
  p.player.classList.add("ad-showing");
  await sleep(50);
  await p.w.YAS.stats.flush();
  check("skipped ad counted too", saved.adsBlocked === 3 && saved.secondsSaved === 50, JSON.stringify(saved));
}

async function testPauseFromPopup() {
  console.log("10. Pause from the popup: YouTube goes back to normal, resume works");
  const p = makePage();
  p.loadContent();
  await sleep(20);
  await p.w.chrome.storage.sync.set({ enabled: false });
  await sleep(20);
  check("tab flag removed while paused", !("yas" in p.doc.documentElement.dataset));
  p.v.src = "blob:ad"; p.v.duration = 15;
  p.player.classList.add("ad-showing");
  await sleep(150);
  check("ads not touched while paused", !p.overlay() && p.v.playbackRate === 1);
  p.player.classList.remove("ad-showing");
  await p.w.chrome.storage.sync.set({ enabled: true });
  await sleep(20);
  check("back on after resume", p.doc.documentElement.dataset.yas === "on");
}

async function testFocusMode() {
  console.log("11. Focus mode: switches become attributes that hide.css uses");
  const p = makePage();
  p.loadContent();
  await p.w.chrome.storage.sync.set({ hideShorts: true, hideComments: true });
  await sleep(20);
  const root = p.doc.documentElement;
  check("Shorts hidden", root.hasAttribute("data-yas-hide-shorts"));
  check("comments hidden", root.hasAttribute("data-yas-hide-comments"));
  check("recommendations untouched", !root.hasAttribute("data-yas-hide-related"));
  const css = read("styles/hide.css");
  check("hide.css has the matching rules", css.includes("[data-yas-hide-shorts]") && css.includes("[data-yas-hide-comments]"));
}

async function testSupportCreators() {
  console.log("12. Support creators: ads stay on allowed channels, everywhere else blocked");
  const p = makePage(); // URL is watch?v=abc
  p.loadContent();
  p.run("inject.js");
  await p.w.chrome.storage.sync.set({ allowedChannels: { UC_friend: "Friend" } });
  await sleep(20);
  check("allow list shared with inject.js", p.doc.documentElement.dataset.yasAllow === "UC_friend");

  const friendVideo = JSON.stringify({ videoDetails: { videoId: "abc", channelId: "UC_friend", author: "Friend" }, adPlacements: [1] });
  const otherVideo = JSON.stringify({ videoDetails: { videoId: "xyz", channelId: "UC_other" }, adPlacements: [1] });
  check("friend's ads kept", "adPlacements" in p.w.JSON.parse(friendVideo));
  check("other channel's ads removed", !("adPlacements" in p.w.JSON.parse(otherVideo)));
  await sleep(20);
  check("page marked 'allowed now'", p.doc.documentElement.hasAttribute("data-yas-allowed-now"));
  check("background asked to let ads through in this tab",
    p.w.chrome._sent.some((m) => m.type === "allow-ads-in-tab" && m.allow === true));

  p.v.src = "blob:ad"; p.v.duration = 15;
  p.player.classList.add("ad-showing");
  await sleep(150);
  check("friend's ad plays normally (no skip, no message)", !p.overlay() && p.v.playbackRate === 1 && !p.v.muted);
}

async function testDefaultSpeed() {
  console.log("13. Speed: changes the playing video right away, then once per new video");
  const p = makePage();
  p.loadContent();
  p.v.currentTime = 30; p.v.paused = false; // a video is playing
  await p.w.chrome.storage.sync.set({ speed: 2 });
  await sleep(20);
  check("2x applied immediately (no reload, no closing the popup)", p.v.playbackRate === 2, p.v.playbackRate);
  await p.w.chrome.storage.sync.set({ speed: 3 });
  await sleep(20);
  check("3x works too", p.v.playbackRate === 3, p.v.playbackRate);
  p.v.playbackRate = 1; // you change it by hand
  p.video.dispatchEvent(new p.w.Event("playing"));
  check("your manual change stays", p.v.playbackRate === 1);
  await p.w.chrome.storage.sync.set({ speed: 0 });
  p.v.playbackRate = 2;
  await sleep(20);
  check("'Off' goes back to normal speed", p.v.playbackRate === 1, p.v.playbackRate);

  // a tap in the popup goes straight to the tab: applies instantly, even while paused
  p.v.paused = true;
  const reply = await p.w.chrome._deliver({ type: "set-speed", speed: 2.5 });
  check("tap in popup -> instant 2.5x (direct message)", p.v.playbackRate === 2.5 && reply?.ok, p.v.playbackRate);
  const status = await p.w.chrome._deliver({ type: "get-status" });
  check("tab reports its PureFlow version", status.version === "9.9.9");

  // a page that just loaded: not playing yet, so speed waits for playback to start
  const q = makePage();
  q.v.paused = true; q.v.currentTime = 0;
  await q.w.chrome.storage.sync.set({ speed: 1.5 });
  q.loadContent();
  await sleep(20);
  check("not forced while the video is still loading", q.v.playbackRate === 1);
  q.v.paused = false;
  q.video.dispatchEvent(new q.w.Event("playing"));
  check("applied as soon as it starts playing", q.v.playbackRate === 1.5);
}

async function testSponsorSkip() {
  console.log("14. Sponsor skip: jumps over sponsor parts, sends only a hash prefix");
  const p = makePage(); // video id "abc"
  const asked = [];
  p.w.fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify([{ videoID: "abc", segments: [{ segment: [10, 20], category: "sponsor" }] }]));
  };
  p.loadContent();
  await p.w.chrome.storage.sync.set({ sponsorSkip: true });
  await sleep(50);
  const prefix = await p.w.YAS.sponsor._sha256Prefix("abc");
  check("asked SponsorBlock once", asked.length === 1, asked.join());
  check("request has only a 4-char hash prefix, not the video id",
    asked[0].includes("/skipSegments/" + prefix + "?") && !asked[0].includes("abc"), asked[0]);
  p.v.currentTime = 12;
  p.video.dispatchEvent(new p.w.Event("timeupdate"));
  check("jumped to the end of the sponsor part", p.v.currentTime === 20, p.v.currentTime);
  check("toast shown", /Sponsor skipped/.test(p.doc.getElementById("yas-toast")?.textContent || ""));
  p.v.currentTime = 12; // you rewind on purpose
  p.video.dispatchEvent(new p.w.Event("timeupdate"));
  check("doesn't skip the same part twice if you rewind", p.v.currentTime === 12);
}

async function testOffByDefault() {
  console.log("15. Sponsor skip is off by default: no network requests");
  const p = makePage();
  let calls = 0;
  p.w.fetch = async () => { calls++; return new Response("[]"); };
  p.loadContent();
  await sleep(50);
  check("no requests to SponsorBlock", calls === 0);
}


async function testPopup() {
  console.log("17. Popup: settings, stats, one-tap speed, greeting and name");
  const html = read("popup/popup.html").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "chrome-extension://x/popup/popup.html", runScripts: "outside-only" });
  const w = dom.window, doc = w.document;
  w.chrome = makeChrome();
  const toTab = [];
  w.chrome.tabs = {
    query: async () => [{ id: 7, url: "https://www.youtube.com/watch?v=abc" }],
    sendMessage: async (id, m) => { toTab.push(m); return m.type === "get-status" ? { onWatchPage: false, version: "1.0.0" } : { ok: true }; },
    reload: () => {},
  };
  await w.chrome.storage.sync.set({ hideShorts: true, speed: 1.5 });
  await w.chrome.storage.local.set({ adsBlocked: 1234, secondsSaved: 5400 });
  ["brand.js", "content/settings.js", "popup/greeting.js", "popup/popup.js"].forEach((f) => w.eval(read(f)));
  await sleep(50);
  const BRAND = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "brand.json"), "utf8"));
  check("name from brand.json", doc.getElementById("app-name").textContent === BRAND.name);
  check("Hide Shorts switch is on", doc.querySelector('[data-setting="hideShorts"]').checked);
  check("1.5 speed button is selected", doc.querySelector('[data-speed="1.5"]').getAttribute("aria-checked") === "true");
  check("ads blocked shown", doc.getElementById("ads-blocked").textContent.replace(/\D/g, "") === "1234");
  check("time saved shown as 1.5 h", doc.getElementById("time-saved").textContent === "1.5 h");

  check("tab running older code -> 'Refresh this tab' note shown", !doc.getElementById("update-notice").hidden);
  check("popup.css lets [hidden] win over display rules (note really disappears)",
    /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(read("popup/popup.css")));
  doc.querySelector('[data-speed="2"]').click();
  await sleep(20);
  check("one tap on 2x is sent straight to the open tab", toTab.some((m) => m.type === "set-speed" && m.speed === 2));
  check("one tap on 2x saves it", w.chrome._data.sync.speed === 2);
  check("2x button now selected", doc.querySelector('[data-speed="2"]').getAttribute("aria-checked") === "true");

  const comments = doc.querySelector('[data-setting="hideComments"]');
  comments.checked = true;
  comments.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(20);
  check("turning a switch saves it", w.chrome._data.sync.hideComments === true);
  check("no channel card outside a video", doc.getElementById("creator-card").hidden);

  check("greeting shown", /^(Good (morning|afternoon|evening)|Up late)/.test(doc.getElementById("greeting").textContent),
    doc.getElementById("greeting").textContent);
  check("popup open counted (rotates the message)", w.chrome._data.local.popupOpens === 1);

  doc.getElementById("edit-name").click();
  const input = doc.getElementById("name-input");
  check("name box opens", !input.hidden);
  check("name box has a Save button", Boolean(doc.getElementById("name-save")) && !doc.getElementById("name-form").hidden);
  input.value = "Someone Else";
  doc.getElementById("name-cancel").click();
  await sleep(20);
  check("Cancel closes the box and saves nothing", doc.getElementById("name-form").hidden && !w.chrome._data.local.userName);
  doc.getElementById("edit-name").click();
  input.value = "Dinesh Shinde";
  doc.getElementById("name-save").click();
  await sleep(20);
  check("Save button closes the box", doc.getElementById("name-form").hidden && !doc.getElementById("greeting").hidden);
  check("name saved on this computer only (not synced)", w.chrome._data.local.userName === "Dinesh Shinde" && !("userName" in w.chrome._data.sync));
  check("greeting uses the first name", /Dinesh(\?)?$/.test(doc.getElementById("greeting").textContent) &&
    !doc.getElementById("greeting").textContent.includes("Shinde"), doc.getElementById("greeting").textContent);
}

async function openPopup(tabs) {
  const html = read("popup/popup.html").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "chrome-extension://x/popup/popup.html", runScripts: "outside-only" });
  const w = dom.window;
  w.chrome = makeChrome();
  w.chrome.tabs = tabs;
  ["brand.js", "content/settings.js", "popup/greeting.js", "popup/popup.js"].forEach((f) => w.eval(read(f)));
  await sleep(50);
  return w;
}

async function testRefreshNote() {
  console.log("22. Refresh note: only when really needed, and gone after Refresh");
  const VERSION = "9.9.9"; // what the fake getManifest() reports
  const listeners = [];
  let tab = { id: 3, url: "https://www.youtube.com/watch?v=a", status: "loading" };
  let running = null; // version of PureFlow inside the tab (null = not started yet)
  const tabs = {
    query: async () => [tab],
    sendMessage: async () => { if (!running) throw new Error("no receiver"); return { onWatchPage: false, version: running }; },
    reload: () => { tab = { ...tab, status: "loading" }; running = null; },
    onUpdated: { addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) },
  };
  let w = await openPopup(tabs);
  check("page still loading -> no refresh note", w.document.getElementById("update-notice").hidden);

  tab = { ...tab, status: "complete" }; running = VERSION;
  w = await openPopup(tabs);
  check("page up to date -> no refresh note", w.document.getElementById("update-notice").hidden);

  running = "1.0.0";
  w = await openPopup(tabs);
  check("page running old code -> refresh note shown", !w.document.getElementById("update-notice").hidden);
  w.document.getElementById("refresh-tab").click();
  check("Refresh hides the note at once", w.document.getElementById("update-notice").hidden);
  check("Refresh reloads the tab", tab.status === "loading");
  await sleep(800);
  check("note stays hidden while the page loads", w.document.getElementById("update-notice").hidden);
  tab = { ...tab, status: "complete" }; running = VERSION;
  listeners.slice().forEach((f) => f(3, { status: "complete" }));
  await sleep(700);
  check("after the reload: still hidden (tab is up to date)", w.document.getElementById("update-notice").hidden);

  const other = await openPopup({ ...tabs, query: async () => [{ id: 9, url: "https://example.com/", status: "complete" }] });
  check("not a video site tab -> no note", other.document.getElementById("update-notice").hidden);
}

function testGreeting() {
  console.log("18. Greeting: right time of day, messages rotate");
  const dom = new JSDOM("", { runScripts: "outside-only" });
  dom.window.eval(read("popup/greeting.js"));
  const g = dom.window.YAS.greeting;
  const at = (h) => new Date(2026, 0, 1, h, 0);
  check("7am is morning", g.build(at(7), "", 0).title === "Good morning");
  check("1pm is afternoon", g.build(at(13), "", 0).title === "Good afternoon");
  check("6pm is evening", g.build(at(18), "Asha", 0).title === "Good evening, Asha");
  check("11pm is night", g.build(at(23), "Asha", 0).title === "Up late, Asha?");
  check("3am is night too", g.periodFor(3) === "night");
  const seen = new Set([0, 1, 2, 3, 4].map((turn) => g.build(at(9), "", turn).message));
  check("5 opens in a row show 5 different messages", seen.size === 5);
  check("then it starts again from the first", g.build(at(9), "", 5).message === g.build(at(9), "", 0).message);
}


async function testSwitchOnDuringAd() {
  console.log("19. Switched on while an ad is already playing: stopped at once, no sound");
  const p = makePage();
  p.loadContent();
  p.v.currentTime = 60; p.video.dispatchEvent(new p.w.Event("timeupdate")); // you were watching
  await p.w.chrome.storage.sync.set({ enabled: false });                    // paused from popup
  await sleep(20);
  p.v.src = "blob:ad"; p.v.duration = 30; p.v.currentTime = 2;              // ad starts while off
  p.player.classList.add("ad-showing");
  p.video.dispatchEvent(new p.w.Event("timeupdate"));                       // the ad keeps playing
  await sleep(150);
  check("while off: the ad is left alone", !p.v.muted && p.v.currentTime === 2);
  await p.w.chrome.storage.sync.set({ enabled: true });                     // switch on mid-ad
  await sleep(30);
  check("switching on: ad muted instantly", p.v.muted === true);
  check("switching on: ad jumped to its end", p.v.currentTime === 30);
  check("message shown", /Ad skipped/.test(p.overlayText()), p.overlayText());
}

async function testLongAd() {
  console.log("20. Long ad (10 minutes): skipped too, not left playing");
  const p = makePage();
  p.loadContent();
  p.v.currentTime = 90; p.video.dispatchEvent(new p.w.Event("timeupdate"));
  p.v.src = "blob:long-ad"; p.v.duration = 600; p.v.currentTime = 0;
  p.player.classList.add("ad-showing");
  await sleep(50);
  check("10-minute ad jumped to its end", p.v.currentTime === 600, p.v.currentTime);
  check("and silent", p.v.muted === true);
}

async function testUnallowDuringAd() {
  console.log("21. Stop allowing a channel while its ad plays: stopped at once");
  const p = makePage(); // watch?v=abc
  p.loadContent();
  p.run("inject.js");
  p.v.currentTime = 40; p.video.dispatchEvent(new p.w.Event("timeupdate"));
  await p.w.chrome.storage.sync.set({ allowedChannels: { UC_friend: "Friend" } });
  p.w.JSON.parse(JSON.stringify({ videoDetails: { videoId: "abc", channelId: "UC_friend" } }));
  await sleep(20);
  p.v.src = "blob:ad"; p.v.duration = 20; p.v.currentTime = 1;
  p.player.classList.add("ad-showing");
  await sleep(150);
  check("allowed channel: ad plays with sound", !p.v.muted && p.v.currentTime === 1);
  await p.w.chrome.storage.sync.set({ allowedChannels: {} });
  await sleep(30);
  check("not allowed any more: muted and skipped at once", p.v.muted === true && p.v.currentTime === 20);
}

function testBuilds() {
  console.log("16. Builds: one engine, right setup for each browser");
  const root = path.join(__dirname, "..", "dist");
  const m = (b) => JSON.parse(fs.readFileSync(path.join(root, b, "manifest.json"), "utf8"));
  const [chrome, edge, firefox] = ["chrome", "edge", "firefox"].map(m);
  check("Chrome uses a service worker", chrome.background.service_worker === "background.js");
  check("Edge uses a service worker", edge.background.service_worker === "background.js");
  check("Firefox uses background scripts", firefox.background.scripts?.[0] === "background.js");
  check("Firefox has its add-on id", Boolean(firefox.browser_specific_settings?.gecko?.id));
  check("same content scripts everywhere",
    JSON.stringify(chrome.content_scripts) === JSON.stringify(firefox.content_scripts) &&
    JSON.stringify(chrome.content_scripts) === JSON.stringify(edge.content_scripts));
  check("name filled in from brand.json", !JSON.stringify(chrome).includes("{{"));
}

(async () => {
  await testNormalNavigationShowsNothing();
  await testVideoAd();
  await testPictureAdNeverTouchesYourVideo();
  await testLateStartStuck();
  await testLateStartStuckReload();
  await testLateStartFastLoad();
  await testTurnOff();
  await testOffOnTakeover();
  await testDataCleaner();
  await testStats();
  await testPauseFromPopup();
  await testFocusMode();
  await testSupportCreators();
  await testDefaultSpeed();
  await testSponsorSkip();
  await testOffByDefault();
  await testSwitchOnDuringAd();
  await testLongAd();
  await testUnallowDuringAd();
  await testPopup();
  await testRefreshNote();
  testGreeting();
  testBuilds();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
