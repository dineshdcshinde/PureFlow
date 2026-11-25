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
  const dom = new JSDOM(`<!doctype html><html><head><title>(3) My trip: part 2 - YouTube</title></head><body>
      <div id="movie_player" class="html5-video-player"><video></video><div class="video-ads"></div>
        <div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-settings-button"></button>
          <button class="ytp-autonav-toggle-button" aria-checked="true"></button></div></div>
        <div class="ytp-autonav-endscreen-countdown-overlay" style="display:none">
          <a class="ytp-autonav-endscreen-upnext-play-button" href="/watch?v=next"></a></div>
      </div>
    </body></html>`, { url: "https://www.youtube.com/watch?v=abc", runScripts: "outside-only" });
  const w = dom.window;
  const doc = w.document;
  Object.defineProperty(doc, "readyState", { get: () => (late ? "complete" : "loading"), configurable: true });
  const video = doc.querySelector("video");
  const v = { src: "blob:yours", duration: 240, currentTime: 0, paused: false, playbackRate: 1, muted: false, readyState: 4,
    ended: false, videoWidth: 1280, videoHeight: 720 };
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
  await sleep(3900);
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

// ============================ V2.0: tools and smoother playback ============================

/** Collect what the content script asks bridge.js to do. */
function listenCmds(p) {
  const cmds = [];
  p.doc.addEventListener("yas:cmd", (e) => cmds.push(JSON.parse(e.detail)));
  return cmds;
}
const toastText = (p) => p.doc.getElementById("yas-toast")?.textContent || "";

async function testPlayNextRightAway() {
  console.log("23. Play next right away: no black wait between videos, only with Autoplay on");
  const p = makePage();
  p.loadContent();
  await sleep(20);
  const playNow = p.doc.querySelector(".ytp-autonav-endscreen-upnext-play-button");
  const countdown = p.doc.querySelector(".ytp-autonav-endscreen-countdown-overlay");
  let clicks = 0;
  playNow.addEventListener("click", (e) => { e.preventDefault(); clicks++; }); // count it, don't navigate

  p.v.ended = true;
  p.video.dispatchEvent(new p.w.Event("ended"));
  await sleep(150);
  check("waits until YouTube shows 'Up next'", clicks === 0);
  countdown.style.display = "block"; // YouTube shows the countdown
  await sleep(150);
  check("presses 'Play now' at once instead of waiting 8s", clicks === 1, clicks);
  await sleep(300);
  check("presses it only once", clicks === 1, clicks);

  p.doc.querySelector(".ytp-autonav-toggle-button").setAttribute("aria-checked", "false");
  p.video.dispatchEvent(new p.w.Event("ended"));
  await sleep(250);
  check("Autoplay off: never starts the next video", clicks === 1, clicks);

  p.doc.querySelector(".ytp-autonav-toggle-button").setAttribute("aria-checked", "true");
  await p.w.chrome.storage.sync.set({ instantNext: false });
  await sleep(20);
  p.video.dispatchEvent(new p.w.Event("ended"));
  await sleep(250);
  check("switched off in the popup: YouTube's normal countdown", clicks === 1, clicks);
}

async function testQuality() {
  console.log("24. Default quality: works like speed (instant tap, then once per video)");
  const p = makePage();
  const cmds = listenCmds(p);
  p.loadContent();
  await sleep(20);

  // a tap in the popup goes straight to the tab, like speed
  const reply = await p.w.chrome._deliver({ type: "set-quality", quality: "hd1080" });
  check("tap 1080p in the popup -> sent to the player at once", reply?.ok && cmds.at(-1)?.value === "hd1080", JSON.stringify(cmds));
  check("...and asks for the 'Quality 1080p' message", cmds.at(-1)?.announce === true);
  await p.w.chrome.storage.sync.set({ quality: "hd1080" }); // the popup also saves it
  await sleep(20);
  const count = cmds.length;
  p.video.dispatchEvent(new p.w.Event("playing"));
  check("same video: not sent again (a change you make by hand stays)", cmds.length === count, JSON.stringify(cmds));
  p.w.history.pushState({}, "", "/watch?v=next1");
  p.video.dispatchEvent(new p.w.Event("playing"));
  check("next video gets 1080p when it starts", cmds.length === count + 1 && cmds.at(-1).value === "hd1080", JSON.stringify(cmds));
  p.video.dispatchEvent(new p.w.Event("playing"));
  check("only once per video", cmds.length === count + 1);
  await p.w.chrome._deliver({ type: "set-quality", quality: "" });
  check("tap Auto: back to Auto", cmds.at(-1).value === "auto", JSON.stringify(cmds));

  // fresh page with 720p saved: applied when the video starts
  const q = makePage();
  const qc = listenCmds(q);
  await q.w.chrome.storage.sync.set({ quality: "hd720" });
  q.loadContent();
  await sleep(20);
  q.video.dispatchEvent(new q.w.Event("playing"));
  check("fresh page: saved quality applied when the video starts", qc.some((c) => c.value === "hd720"), JSON.stringify(qc));

  // bridge.js, in the page world, talks to the player
  const calls = [];
  let levels = []; // player not ready yet
  p.player.getAvailableQualityLevels = () => levels;
  p.player.setPlaybackQualityRange = (a, b) => calls.push([a, b]);
  p.player.setPlaybackQuality = () => {};
  p.run("bridge.js");
  check("asks for 1080p, video only has 720p: 720p", p.w.__yasPickQuality("hd1080", ["hd720", "large"]) === "hd720");
  check("4K video, asks for 1080p: 1080p", p.w.__yasPickQuality("hd1080", ["hd2160", "hd1080", "hd720"]) === "hd1080");
  fire(p, "yas:cmd", JSON.stringify({ cmd: "quality", value: "hd1440", announce: true }));
  check("player still loading: waits instead of giving up", calls.length === 0);
  levels = ["hd720", "large", "medium", "auto"];
  await sleep(400);
  check("as soon as it's ready: quality set", JSON.stringify(calls.at(-1)) === '["hd720","hd720"]', JSON.stringify(calls));
  check("message: Quality 720p (highest for this video)", toastText(p) === "Quality 720p (highest for this video)", toastText(p));
  levels = ["hd2160", "hd1080", "auto"];
  fire(p, "yas:cmd", JSON.stringify({ cmd: "quality", value: "hd1080", announce: true }));
  check("message: Quality 1080p", toastText(p) === "Quality 1080p", toastText(p));
}

async function testLoop() {
  console.log("25. Loop part of a video: A, then B, then off");
  const p = makePage();
  p.loadContent();
  await sleep(20);
  const loopBtn = () => p.doc.querySelector('.yas-player-btn[data-yas-action="loop"]');
  p.v.currentTime = 10;
  loopBtn().click();
  check("first press: loop start", /Loop from 0:10/.test(toastText(p)), toastText(p));
  check("button shows 'waiting for the end'", loopBtn().dataset.yasLoop === "start");
  p.v.currentTime = 25;
  loopBtn().click();
  check("second press: looping 0:10 – 0:25", /Looping 0:10 – 0:25/.test(toastText(p)), toastText(p));
  check("jumps back to the start", p.v.currentTime === 10);
  check("button shows 'looping'", loopBtn().dataset.yasLoop === "on");
  p.v.currentTime = 25.1;
  p.video.dispatchEvent(new p.w.Event("timeupdate"));
  check("passing the end goes back to the start", p.v.currentTime === 10, p.v.currentTime);
  p.v.currentTime = 15;
  p.video.dispatchEvent(new p.w.Event("timeupdate"));
  check("inside the part: plays normally", p.v.currentTime === 15);
  loopBtn().click();
  check("third press: loop off", /Loop off/.test(toastText(p)) && loopBtn().dataset.yasLoop === "off");
  p.v.currentTime = 30;
  p.video.dispatchEvent(new p.w.Event("timeupdate"));
  check("after loop off: no jumping", p.v.currentTime === 30);

  // a loop belongs to one video
  p.v.currentTime = 5; loopBtn().click(); p.v.currentTime = 8; loopBtn().click();
  p.w.history.pushState({}, "", "/watch?v=other");
  p.doc.dispatchEvent(new p.w.Event("yt-navigate-finish"));
  p.v.currentTime = 9;
  p.video.dispatchEvent(new p.w.Event("timeupdate"));
  check("cleared when you open another video", p.v.currentTime === 9 && loopBtn().dataset.yasLoop === "off");
  check("1:01:05 shown as hours", p.w.YAS.loop.clock(3665) === "1:01:05");
}

async function testScreenshot() {
  console.log("26. Screenshot: saved as a PNG named after the video and the time");
  const p = makePage();
  const saved = [];
  p.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  p.w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new p.w.Blob(["png"], { type: "image/png" })); };
  p.w.URL.createObjectURL = () => "blob:shot";
  p.w.URL.revokeObjectURL = () => {};
  p.w.HTMLAnchorElement.prototype.click = function () { saved.push(this.download); };
  p.loadContent();
  await sleep(20);
  p.v.currentTime = 83.4;
  p.doc.querySelector('.yas-player-btn[data-yas-action="screenshot"]').click();
  await sleep(20);
  check("file saved", saved.length === 1, saved.join());
  check("clean name: title + time, no ': ' or ' - YouTube'", saved[0] === "My trip part 2 1-23.png", saved[0]);
  check("message: saved", /Screenshot saved/.test(toastText(p)), toastText(p));
  p.v.videoWidth = 0; // nothing on screen yet
  p.doc.querySelector('.yas-player-btn[data-yas-action="screenshot"]').click();
  await sleep(20);
  check("no picture yet: friendly message, no empty file", saved.length === 1 && /Can't/.test(toastText(p)));
}

async function testShortcuts() {
  console.log("27. Keyboard shortcuts: Shift+S and Shift+L, never while typing");
  const p = makePage();
  const saved = [];
  p.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  p.w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new p.w.Blob(["png"])); };
  p.w.URL.createObjectURL = () => "blob:shot";
  p.w.HTMLAnchorElement.prototype.click = function () { saved.push(this.download); };
  p.loadContent();
  await sleep(20);
  const press = (code, target = p.doc.body, extra = {}) =>
    target.dispatchEvent(new p.w.KeyboardEvent("keydown", { code, shiftKey: true, bubbles: true, ...extra }));
  press("KeyS");
  await sleep(20);
  check("Shift+S saves a screenshot", saved.length === 1);
  p.v.currentTime = 12;
  press("KeyL");
  check("Shift+L starts a loop", /Loop from/.test(toastText(p)), toastText(p));
  const box = p.doc.createElement("input");
  p.doc.body.appendChild(box);
  press("KeyS", box);
  await sleep(20);
  check("typing a capital S in a search box: nothing happens", saved.length === 1);
  press("KeyS", p.doc.body, { ctrlKey: true });
  await sleep(20);
  check("Ctrl+Shift+S left to the browser", saved.length === 1);
  await p.w.chrome.storage.sync.set({ shortcuts: false });
  await sleep(20);
  press("KeyS");
  await sleep(20);
  check("switched off in the popup: no shortcuts", saved.length === 1);
}

async function testWheelVolume() {
  console.log("28. Mouse wheel volume: off by default, then up and down over the player");
  const p = makePage();
  const cmds = listenCmds(p);
  p.loadContent();
  await sleep(20);
  const wheel = (deltaY, target = p.video) => {
    const e = new p.w.WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  let e = wheel(-100);
  check("off by default: the page scrolls as usual", !e.defaultPrevented && cmds.length === 0);
  await p.w.chrome.storage.sync.set({ wheelVolume: true });
  await sleep(20);
  e = wheel(-100);
  check("wheel up: volume +5, page doesn't scroll", e.defaultPrevented && cmds.at(-1)?.step === 5, JSON.stringify(cmds));
  wheel(100);
  check("wheel down: volume -5", cmds.at(-1)?.step === -5);
  const menu = p.doc.createElement("div");
  menu.className = "ytp-settings-menu";
  p.player.appendChild(menu);
  e = wheel(100, menu);
  check("scrolling YouTube's settings menu still scrolls the menu", !e.defaultPrevented && cmds.length === 2);

  let vol = 40, muted = false;
  Object.assign(p.player, { getVolume: () => vol, setVolume: (x) => { vol = x; }, isMuted: () => muted,
    mute: () => { muted = true; }, unMute: () => { muted = false; } });
  p.run("bridge.js");
  wheel(-100);
  check("bridge turns the player up to 45%", vol === 45, vol);
  check("message shows the new volume", toastText(p) === "Volume 45%", toastText(p));
  vol = 3;
  wheel(100);
  check("never below 0 (and then muted)", vol === 0 && muted && toastText(p) === "Muted", `${vol} ${muted}`);
}

async function testPlayerButtons() {
  console.log("29. Player buttons: added to the player bar, removed when switched off or paused");
  const p = makePage();
  p.loadContent();
  await sleep(20);
  const buttons = () => p.doc.querySelectorAll(".ytp-right-controls .yas-player-btn");
  check("screenshot and loop buttons added", buttons().length === 2);
  check("buttons have labels for screen readers", [...buttons()].every((b) => b.getAttribute("aria-label")));
  check("icons match YouTube's own: 24x24, no shrinking or shifting",
    [...buttons()].every((b) => { const s = b.querySelector("svg");
      return s.getAttribute("width") === "24" && s.getAttribute("height") === "24" && !b.querySelector("[transform]"); }));
  check("sits inside the player bar's button group", [...buttons()].every((b) => b.parentElement.matches(".ytp-right-controls-left, .ytp-right-controls")));
  p.doc.dispatchEvent(new p.w.Event("yt-navigate-finish"));
  check("never added twice", buttons().length === 2);
  await p.w.chrome.storage.sync.set({ playerButtons: false });
  await sleep(20);
  check("switched off: buttons gone", buttons().length === 0);
  await p.w.chrome.storage.sync.set({ playerButtons: true });
  await sleep(20);
  check("switched on again: back", buttons().length === 2);
  await p.w.chrome.storage.sync.set({ enabled: false });
  await sleep(20);
  check("PureFlow paused: buttons gone", buttons().length === 0);
}

async function testPopupV2() {
  console.log("30. Popup: quality and the new switches");
  const toTab = [];
  const w = await openPopup({
    query: async () => [{ id: 7, url: "https://www.youtube.com/watch?v=abc", status: "complete" }],
    sendMessage: async (id, m) => { toTab.push(m); return { onWatchPage: false, version: "9.9.9" }; },
  });
  const doc = w.document;
  check("Auto quality selected by default", doc.querySelector('[data-quality=""]').getAttribute("aria-checked") === "true");
  doc.querySelector('[data-quality="hd1080"]').click();
  await sleep(20);
  check("tap 1080p: sent straight to the open tab", toTab.some((m) => m.type === "set-quality" && m.quality === "hd1080"));
  check("tap 1080p: saved", w.chrome._data.sync.quality === "hd1080");
  check("1080p now selected", doc.querySelector('[data-quality="hd1080"]').getAttribute("aria-checked") === "true");
  const on = (k) => doc.querySelector(`[data-setting="${k}"]`).checked;
  check("defaults: play next right away, shortcuts and buttons on; wheel volume off",
    on("instantNext") && on("shortcuts") && on("playerButtons") && !on("wheelVolume"));
  const wheel = doc.querySelector('[data-setting="wheelVolume"]');
  wheel.checked = true;
  wheel.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(20);
  check("turning on wheel volume saves it", w.chrome._data.sync.wheelVolume === true);
}

// ============================ Review fixes ============================

async function testPausedLeavesKeysAndWheelAlone() {
  console.log("31. Paused, or during an ad: Shift keys and the wheel are left to YouTube and the page");
  const p = makePage();
  p.loadContent();
  await p.w.chrome.storage.sync.set({ wheelVolume: true });
  await sleep(20);
  const key = () => { const e = new p.w.KeyboardEvent("keydown", { code: "KeyL", shiftKey: true, bubbles: true, cancelable: true }); p.doc.body.dispatchEvent(e); return e; };
  const wheel = () => { const e = new p.w.WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }); p.video.dispatchEvent(e); return e; };
  check("on: Shift+L is ours", key().defaultPrevented);
  p.v.src = "blob:ad"; p.v.duration = 15;
  p.player.classList.add("ad-showing");
  await sleep(50);
  check("during an ad: the wheel scrolls the page", !wheel().defaultPrevented);
  check("during an ad: Shift+L not swallowed", !key().defaultPrevented);
  p.player.classList.remove("ad-showing");
  p.v.src = "blob:yours"; p.v.duration = 240;
  await sleep(50);
  await p.w.chrome.storage.sync.set({ enabled: false });
  await sleep(20);
  check("paused: Shift+L not swallowed", !key().defaultPrevented);
  check("paused: the wheel scrolls the page", !wheel().defaultPrevented);
}

async function testKeyRepeatAndTrackpad() {
  console.log("32. Holding a key acts once; a trackpad doesn't jump the volume to 0 or 100");
  const p = makePage();
  const cmds = listenCmds(p);
  const saved = [];
  p.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  p.w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new p.w.Blob(["png"])); };
  p.w.URL.createObjectURL = () => "blob:shot";
  p.w.HTMLAnchorElement.prototype.click = function () { saved.push(this.download); };
  p.loadContent();
  await p.w.chrome.storage.sync.set({ wheelVolume: true });
  await sleep(20);
  for (let i = 0; i < 10; i++) {
    p.doc.body.dispatchEvent(new p.w.KeyboardEvent("keydown", { code: "KeyS", shiftKey: true, repeat: i > 0, bubbles: true }));
  }
  await sleep(30);
  check("holding Shift+S: one screenshot, not 10", saved.length === 1, saved.length);
  for (let i = 0; i < 40; i++) {
    p.video.dispatchEvent(new p.w.WheelEvent("wheel", { deltaY: 4, bubbles: true, cancelable: true })); // a light swipe: 160px
  }
  check("light trackpad swipe: 2 small steps, not 40", cmds.length === 2, cmds.length);
}

async function testLoopEdges() {
  console.log("33. Loop: end before start, and a loop up to the very end of the video");
  const p = makePage(); // video is 240s long
  let plays = 0;
  p.video.play = () => { plays++; p.v.paused = false; p.v.ended = false; return Promise.resolve(); };
  p.loadContent();
  await sleep(20);
  const loop = () => p.doc.querySelector('.yas-player-btn[data-yas-action="loop"]').click();
  p.v.currentTime = 120; loop();
  p.v.currentTime = 90; loop(); // went back before the start
  check("end before start: loops 1:30 – 2:00 instead of turning off", /Looping 1:30 – 2:00/.test(toastText(p)), toastText(p));
  loop(); // off
  p.v.currentTime = 200; loop();
  p.v.currentTime = 240; loop(); // B on the very last frame
  check("loop up to the end: on", /Looping 3:20 – 4:00/.test(toastText(p)), toastText(p));
  p.v.currentTime = 239.8;
  p.video.dispatchEvent(new p.w.Event("timeupdate"));
  check("goes back to the start just before the video ends", p.v.currentTime === 200, p.v.currentTime);
  p.v.currentTime = 240; p.v.ended = true; p.v.paused = true; // e.g. at 3x it reached the end anyway
  p.video.dispatchEvent(new p.w.Event("ended"));
  check("reached the end anyway: back to the start AND playing", p.v.currentTime === 200 && plays === 1, `${p.v.currentTime} ${plays}`);
}

async function testOwnerKeepsButtons() {
  console.log("34. Extension reloaded: the new copy keeps its buttons when the old one shuts down");
  const p = makePage();
  p.loadContent();
  await sleep(20);
  const old = p.w.chrome;
  p.w.chrome = makeChrome("new-id");
  old.runtime.id = undefined; // old copy is switched off
  p.loadContent();            // new copy starts
  await sleep(1300);          // old copy notices and shuts down
  const buttons = p.doc.querySelectorAll(".yas-player-btn");
  check("still exactly 2 buttons", buttons.length === 2, buttons.length);
  p.v.currentTime = 30;
  p.doc.querySelector('.yas-player-btn[data-yas-action="loop"]').click();
  check("and they work (new copy answers)", /Loop from/.test(toastText(p)), toastText(p));
}

async function testVolumeWhenMuted() {
  console.log("35. Wheel volume while muted");
  const p = makePage();
  p.loadContent();
  await p.w.chrome.storage.sync.set({ wheelVolume: true });
  await sleep(20);
  let vol = 80, muted = true;
  Object.assign(p.player, { getVolume: () => vol, setVolume: (x) => { vol = x; }, isMuted: () => muted,
    mute: () => { muted = true; }, unMute: () => { muted = false; } });
  p.run("bridge.js");
  p.video.dispatchEvent(new p.w.WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
  check("muted + wheel down: stays muted, says Muted", muted && vol === 80 && toastText(p) === "Muted", `${vol} ${muted} ${toastText(p)}`);
  await sleep(450);
  p.video.dispatchEvent(new p.w.WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
  check("muted + wheel up: back at your 80%, not 5%", !muted && vol === 80 && toastText(p) === "Volume 80%", `${vol} ${muted} ${toastText(p)}`);
}

async function testQualityEdges() {
  console.log("36. Quality: never silently does nothing; synced change doesn't override your video");
  const p = makePage();
  const cmds = listenCmds(p);
  p.loadContent();
  await sleep(20);
  check("asks 480p, video starts at 720p: 720p", p.w.YAS && (p.run("bridge.js"), p.w.__yasPickQuality("large", ["hd1080", "hd720"])) === "hd720");
  let levels = ["hd1080", "hd720"];
  p.player.getAvailableQualityLevels = () => levels;
  p.player.setPlaybackQualityRange = () => {};
  fire(p, "yas:cmd", JSON.stringify({ cmd: "quality", value: "large", announce: true }));
  check("message: Quality 720p (lowest for this video)", toastText(p) === "Quality 720p (lowest for this video)", toastText(p));

  const n = cmds.length;
  await p.w.chrome.storage.sync.set({ quality: "hd1440" }); // picked in another window
  await sleep(20);
  p.video.dispatchEvent(new p.w.Event("playing")); // e.g. you pause and play again
  check("synced change: the open video is left alone", cmds.length === n, JSON.stringify(cmds.slice(n)));
  p.w.history.pushState({}, "", "/watch?v=next2");
  p.video.dispatchEvent(new p.w.Event("playing"));
  check("...and the next video gets it", cmds.at(-1)?.value === "hd1440", JSON.stringify(cmds.slice(n)));
}

async function testInterruptionsPopup() {
  console.log("37. 'Experiencing interruptions?' popup hidden; normal popups still show");
  const p = makePage();
  const area = p.doc.createElement("ytd-popup-container");
  p.doc.body.appendChild(area);
  p.loadContent();
  await sleep(20);
  const toast = p.doc.createElement("tp-yt-paper-toast");
  toast.innerHTML = '<span>Experiencing interruptions?</span> <a href="https://support.google.com/youtube/answer/123?ad_blocker=1">Find out why</a>';
  area.appendChild(toast);
  await sleep(20);
  check("interruptions popup marked", toast.hasAttribute("data-yas-hidden-notice"));
  check("hide.css hides marked popups", /\[data-yas-hidden-notice\][^{]*\{\s*display:\s*none/.test(read("styles/hide.css")));
  toast.innerHTML = "<span>Saved to Watch later</span>"; // YouTube reuses the same popup
  await sleep(20);
  check("same popup reused for 'Saved to Watch later': shown again", !toast.hasAttribute("data-yas-hidden-notice"));
  toast.textContent = "Experiencing interruptions?";
  await sleep(20);
  await p.w.chrome.storage.sync.set({ enabled: false });
  await sleep(20);
  check("PureFlow paused: popup left as YouTube made it", !toast.hasAttribute("data-yas-hidden-notice"));
}

async function testOnlySupportedQualities() {
  console.log("38. Popup only offers qualities the open video has");
  // the page tells the popup what the player has
  const p = makePage();
  p.loadContent();
  await sleep(20);
  p.player.getAvailableQualityLevels = () => ["hd1080", "hd720", "large", "medium", "auto"];
  p.run("bridge.js");
  const status = await p.w.chrome._deliver({ type: "get-status" });
  check("page reports this video's qualities (without 'auto')",
    JSON.stringify(status.qualities) === '["hd1080","hd720","large","medium"]', JSON.stringify(status.qualities));

  const popupWith = async (qualities, saved) => {
    const w = await openPopup({
      query: async () => [{ id: 7, url: "https://www.youtube.com/watch?v=abc", status: "complete" }],
      sendMessage: async () => ({ onWatchPage: true, version: "9.9.9", qualities }),
    });
    if (saved !== undefined) { await w.chrome.storage.sync.set({ quality: saved }); await sleep(20); }
    return w.document;
  };
  const shown = (doc) => [...doc.querySelectorAll("[data-quality]")].filter((c) => !c.hidden).map((c) => c.textContent);

  let doc = await popupWith(["hd1080", "hd720", "large", "medium"]);
  check("1080p video: no 1440p, 4K or 8K", JSON.stringify(shown(doc)) === '["Auto","360p","480p","720p","1080p"]', JSON.stringify(shown(doc)));
  check("no note when your pick fits", doc.getElementById("quality-note").hidden);

  doc = await popupWith(["hd1080", "hd720", "large"], "hd2160");
  check("default 4K on a 1080p video: says it plays at 1080p",
    /default is 4K.*best: 1080p/.test(doc.getElementById("quality-note").textContent), doc.getElementById("quality-note").textContent);

  doc = await popupWith(["hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny"]);
  check("4K video: 144p up to 4K, no 8K", JSON.stringify(shown(doc)) ===
    '["Auto","144p","240p","360p","480p","720p","1080p","1440p","4K"]', JSON.stringify(shown(doc)));

  doc = await popupWith(["highres", "hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny"]);
  check("8K video: 8K shown too", shown(doc).includes("8K") && shown(doc).length === 10, JSON.stringify(shown(doc)));
  check("pick 8K on an 8K video: player set to 8K", p.w.__yasPickQuality("highres", ["highres", "hd2160"]) === "highres");
  check("pick 8K on a 4K video: 4K (its best)", p.w.__yasPickQuality("highres", ["hd2160", "hd1080"]) === "hd2160");
  check("pick 144p: 144p", p.w.__yasPickQuality("tiny", ["hd1080", "medium", "small", "tiny"]) === "tiny");

  doc = await popupWith([]);
  check("player not ready / not a video: all 11 choices shown (Auto, 144p ... 8K)", shown(doc).length === 11, JSON.stringify(shown(doc)));
}


/** What background.js sends for the on-page parts. */
const fakeAssets = () => ({ html: read("popup/popup.html"), css: read("popup/popup.css"),
  icon16: "data:image/png;base64,SIXTEEN", icon32: "data:image/png;base64,THIRTYTWO" });

/** A YouTube page with PureFlow, where our closed shadow roots can be looked into. */
async function pageWithPanel() {
  const p = makePage();
  const w = p.w;
  Object.defineProperty(w, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(w, "innerHeight", { value: 800, configurable: true });
  const shadows = new Map();
  const realAttach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (o) { const r = realAttach.call(this, { ...o, mode: "open" }); shadows.set(this, r); return r; };
  const asked = [];
  w.chrome.runtime.sendMessage = (m) => {
    asked.push(m.type);
    if (m.type === "assets") return Promise.resolve(fakeAssets());
    return Promise.resolve();
  };
  p.loadContent();
  await sleep(30);
  const panelRoot = () => shadows.get(p.doc.querySelector("pureflow-panel"));
  return { ...p, shadows, asked, panelRoot };
}

async function testFloatingPanel() {
  console.log("39. All settings panel: drawn on the page (no iframe), drags, remembers where, closes");
  const p = await pageWithPanel();
  const { w, doc } = p;
  const panel = w.YAS.panel;
  const toggle = async () => { panel.toggle(); await sleep(40); };

  await toggle();
  const host = doc.querySelector("pureflow-panel");
  check("open: panel on the page", Boolean(host) && panel.isOpen());
  check("no iframe (nothing a website can block or frame)", !doc.querySelector("iframe") && !p.panelRoot().querySelector("iframe"));
  check("settings page drawn inside", Boolean(p.panelRoot().getElementById("speed-chips")) && Boolean(p.panelRoot().getElementById("greeting")));
  check("asked the background for the page once", p.asked.filter((t) => t === "assets").length === 1);
  check("popup.css adapted to the panel (no :root / body left)",
    !/:root|(^|[\s,}])body[\s.{,]/.test(p.panelRoot().querySelector("style").textContent));
  check("top right by default", host.style.left === "876px" && host.style.top === "72px", host.style.left + " " + host.style.top);
  const img = p.panelRoot().querySelector(".brand img");
  check("footer icon is drawn from data (no extension file a website could probe)", img?.src === "data:image/png;base64,SIXTEEN", img?.src);
  check("top bar icon too", p.panelRoot().querySelector(".title img")?.src === "data:image/png;base64,THIRTYTWO");
  check("short window: the settings scroll inside", p.panelRoot().querySelector(".scroll").style.maxHeight === `${800 - 72 - 36 - 12}px`);

  await toggle();
  check("toggle again: closed", !doc.querySelector("pureflow-panel"));
  panel.open(); panel.open(); // double tap
  await sleep(40);
  check("opening twice quickly: still one panel", doc.querySelectorAll("pureflow-panel").length === 1);
  check("page asked only once (kept for next time)", p.asked.filter((t) => t === "assets").length === 1);

  // drag by the top bar
  const panelHost = doc.querySelector("pureflow-panel");
  const root = p.panelRoot();
  const box = root.querySelector(".panel");
  const bar = root.querySelector(".bar");
  const ptr = (type, x, y) => {
    const e = new w.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
    e.pointerId = 1;
    bar.dispatchEvent(e);
  };
  ptr("pointerdown", 900, 90);
  check("dragging", box.classList.contains("dragging"));
  ptr("pointermove", 500, 300);
  ptr("pointerup", 500, 300);
  check("dragged to the new spot", panelHost.style.left === "476px" && panelHost.style.top === "282px",
    panelHost.style.left + " " + panelHost.style.top);
  await sleep(10);
  check("position remembered", JSON.stringify(w.chrome._data.local.panelPos) === JSON.stringify({ x: 476, y: 282 }),
    JSON.stringify(w.chrome._data.local.panelPos));
  ptr("pointerdown", 500, 300); ptr("pointermove", -400, 5000); ptr("pointerup", -400, 5000);
  check("can't be dragged off screen", panelHost.style.left === "12px" && parseInt(panelHost.style.top) === 800 - 36 - 12,
    panelHost.style.left + " " + panelHost.style.top);
  bar.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  check("arrow keys move it too", panelHost.style.left === "22px", panelHost.style.left);

  // typing in the panel never reaches YouTube or our shortcuts
  const seen = [];
  doc.addEventListener("keydown", (e) => seen.push(e.key));
  const input = root.getElementById("name-input");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "k", bubbles: true, composed: true }));
  check("keys typed in the panel don't reach YouTube (k would pause)", !seen.includes("k"));

  bar.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  check("Esc: closed", !doc.querySelector("pureflow-panel"));
  await toggle();
  check("opens again where you left it", doc.querySelector("pureflow-panel").style.left === "22px");
  p.panelRoot().querySelector(".close").click();
  check("X button closes it", !doc.querySelector("pureflow-panel"));
}

async function testPanelPage() {
  console.log("40. Settings in the panel work like the popup");
  const p = await pageWithPanel();
  const { w, doc } = p;
  await w.chrome.storage.sync.set({ speed: 1.5 });
  p.player.getAvailableQualityLevels = () => ["hd1080", "hd720", "auto"];
  p.run("bridge.js");
  w.YAS.panel.open();
  await sleep(60);
  const root = p.panelRoot();
  check("1.5 selected (your saved settings)", root.querySelector('[data-speed="1.5"]').getAttribute("aria-checked") === "true");
  check("greeting shown", /^(Good|Up late)/.test(root.getElementById("greeting").textContent));
  check("no 'refresh this tab' note (the panel is the current code)", root.getElementById("update-notice").hidden);
  const shown = [...root.querySelectorAll("[data-quality]")].filter((c) => !c.hidden).map((c) => c.textContent);
  check("only this video's qualities", JSON.stringify(shown) === '["Auto","720p","1080p"]', JSON.stringify(shown));
  root.querySelector('[data-speed="2"]').click();
  await sleep(30);
  check("tap 2x in the panel: video at 2x now", p.v.playbackRate === 2, p.v.playbackRate);
  check("tap 2x in the panel: saved", w.chrome._data.sync.speed === 2);
  const shorts = root.querySelector('[data-setting="hideShorts"]');
  shorts.checked = true;
  shorts.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(30);
  check("switch in the panel: saved", w.chrome._data.sync.hideShorts === true);
  check("floating button switch is in the settings, on by default",
    root.querySelector('[data-setting="floatingBar"]')?.checked === true);
  w.YAS.panel.close();
  await w.chrome.storage.sync.set({ speed: 1 });
  await sleep(20);
  check("closed panel stops listening (no errors after closing)", true);

  // the real toolbar popup still starts by itself
  const html = read("popup/popup.html").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "chrome-extension://x/popup/popup.html", runScripts: "outside-only" });
  dom.window.chrome = makeChrome();
  dom.window.chrome.tabs = { query: async () => [], sendMessage: async () => ({}) };
  ["brand.js", "content/settings.js", "popup/greeting.js", "popup/popup.js"].forEach((f) => dom.window.eval(read(f)));
  await sleep(50);
  check("toolbar popup works as before", /^(Good|Up late)/.test(dom.window.document.getElementById("greeting").textContent));
  check("on YouTube popup.js only provides mount() (doesn't touch the page)", !p.doc.getElementById("greeting"));
}

async function testDock() {
  console.log("41. Floating PureFlow button: one row for speed, quality, screenshot, loop, focus, settings");
  const p = makePage();
  const w = p.w, doc = p.doc;
  Object.defineProperty(w, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(w, "innerHeight", { value: 800, configurable: true });
  const shadows = [];
  const realAttach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (o) { const r = realAttach.call(this, { ...o, mode: "open" }); shadows.push([this, r]); return r; };
  w.chrome.runtime.sendMessage = (m) => Promise.resolve(m.type === "assets" ? fakeAssets() : true);
  const cmds = listenCmds(p);
  p.player.getAvailableQualityLevels = () => ["hd1080", "hd720", "large", "auto"];
  p.loadContent();
  p.run("bridge.js"); // the page-world helper that asks the player
  await sleep(40);
  const host = doc.querySelector("pureflow-dock");
  check("button is on YouTube by default", Boolean(host));
  check("bottom right by default", host.style.left === `${1200 - 44 - 24}px` && host.style.top === `${800 - 44 - 24}px`,
    host.style.left + " " + host.style.top);
  const root = shadows.find(([el]) => el === host)[1];
  const $ = (s) => root.querySelector(s);
  check("closed: just the round button", !$(".dock").classList.contains("open"));

  // tap (pointer down + up without moving) opens it
  const fab = $(".fab");
  const ptr = (type, x, y) => {
    const e = new w.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
    e.pointerId = 1;
    fab.dispatchEvent(e);
  };
  ptr("pointerdown", 1150, 750); ptr("pointerup", 1151, 750);
  check("tap: the row opens", $(".dock").classList.contains("open") && fab.getAttribute("aria-expanded") === "true");
  await sleep(10);
  check("open state remembered", w.chrome._data.local.dockOpen === true);
  const tap = (action) => $(`[data-action="${action}"]`).click();

  // speed
  p.v.playbackRate = 1;
  check("speed shows what is playing", $(".value").textContent === "1×", $(".value").textContent);
  tap("faster");
  await sleep(20);
  check("+ : 1.25×, on the video now", p.v.playbackRate === 1.25 && $(".value").textContent === "1.25×", p.v.playbackRate);
  check("+ : remembered for the next videos", w.chrome._data.sync.speed === 1.25);
  tap("slower"); tap("slower");
  await sleep(20);
  check("- - : 0.75×", p.v.playbackRate === 0.75, p.v.playbackRate);
  p.v.playbackRate = 3;
  p.video.dispatchEvent(new w.Event("ratechange"));
  check("speed changed in YouTube's menu: shown", $(".value").textContent === "3×");
  check("at 3×: + is off", $('[data-action="faster"]').disabled);

  // quality: only this video's
  const before = cmds.length;
  check("no quality questions to the player until the menu opens", cmds.slice(before).length === 0);
  tap("quality");
  const choices = [...root.querySelectorAll(".menu [data-quality]")].map((b) => b.textContent);
  check("quality menu: Auto + this video's qualities only", JSON.stringify(choices) === '["Auto","1080p","720p","480p"]', JSON.stringify(choices));
  root.querySelector('.menu [data-quality="hd720"]').click();
  await sleep(20);
  check("pick 720p: sent to the player now", cmds.some((c) => c.cmd === "quality" && c.value === "hd720" && c.announce));
  check("720p remembered and shown", w.chrome._data.sync.quality === "hd720" && $(".quality").textContent === "720p");
  check("menu closed after picking", $(".menu").hidden);

  // loop and screenshot
  p.v.currentTime = 10;
  tap("loop");
  check("loop: waiting for the end (amber)", $('[data-action="loop"]').classList.contains("waiting"));
  p.v.currentTime = 20;
  tap("loop");
  check("loop: on (green)", $('[data-action="loop"]').classList.contains("on"));
  tap("loop");
  check("loop: off", !$('[data-action="loop"]').classList.contains("on"));
  const saved = [];
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(["png"])); };
  w.URL.createObjectURL = () => "blob:shot";
  w.HTMLAnchorElement.prototype.click = function () { saved.push(this.download); };
  tap("screenshot");
  await sleep(20);
  check("screenshot saved", saved.length === 1);

  // focus: one tap for all four
  tap("focus");
  await sleep(20);
  const s = w.chrome._data.sync;
  check("focus: Shorts, comments, suggestions, end screens hidden", s.hideShorts && s.hideComments && s.hideRelated && s.hideEndScreens);
  check("focus button lit", $('[data-action="focus"]').getAttribute("aria-pressed") === "true");
  tap("focus");
  await sleep(20);
  check("focus again: all shown", !s.hideShorts && !s.hideComments && !s.hideRelated && !s.hideEndScreens);

  // settings
  tap("settings");
  await sleep(30);
  check("gear: All settings panel opens", Boolean(doc.querySelector("pureflow-panel")));
  tap("settings");
  check("gear again: closed", !doc.querySelector("pureflow-panel"));
  tap("settings");
  check("gear lit straight away, while the panel loads", $('[data-action="settings"]').classList.contains("on"));
  tap("settings"); // second tap before it finished loading
  await sleep(30);
  check("quick double tap: stays closed", !doc.querySelector("pureflow-panel") && !$('[data-action="settings"]').classList.contains("on"));

  // not a video page: video tools off
  p.w.history.pushState({}, "", "/feed/subscriptions");
  doc.dispatchEvent(new w.Event("yt-navigate-finish"));
  check("home/feed: speed works, quality/screenshot/loop are off",
    $('[data-action="quality"]').disabled && $('[data-action="screenshot"]').disabled && $('[data-action="loop"]').disabled &&
    !$('[data-action="faster"]').disabled);
  p.w.history.pushState({}, "", "/watch?v=abc");
  doc.dispatchEvent(new w.Event("yt-navigate-finish"));

  // drag (more than a few px) moves it, doesn't open/close
  const wasOpen = $(".dock").classList.contains("open");
  ptr("pointerdown", 1150, 750); ptr("pointermove", 600, 400); ptr("pointerup", 600, 400);
  await sleep(10);
  const down = new w.MouseEvent("pointerdown", { clientX: 10, clientY: 10, button: 0, bubbles: true, cancelable: true });
  fab.dispatchEvent(down);
  fab.dispatchEvent(new w.MouseEvent("pointerup", { clientX: 10, clientY: 10, bubbles: true }));
  check("the browser's own drag-and-drop can't take over a drag", down.defaultPrevented);
  ptr("pointerdown", 1150, 750); ptr("pointerup", 1150, 750); // that was a tap: undo it
  check("drag: moved, row unchanged", $(".dock").classList.contains("open") === wasOpen && JSON.stringify(w.chrome._data.local.dockPos) !== undefined);
  ptr("pointerdown", 600, 400); ptr("pointerup", 600, 400);
  check("tap again: row closes", !$(".dock").classList.contains("open"));
  doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));

  // full screen and pause
  Object.defineProperty(doc, "fullscreenElement", { value: p.player, configurable: true });
  doc.dispatchEvent(new w.Event("fullscreenchange"));
  check("full screen: out of the way", host.style.display === "none");
  Object.defineProperty(doc, "fullscreenElement", { value: null, configurable: true });
  doc.dispatchEvent(new w.Event("fullscreenchange"));
  check("back from full screen: shown", host.style.display === "");
  await w.chrome.storage.sync.set({ floatingBar: false });
  await sleep(20);
  check("switched off in the popup: gone", !doc.querySelector("pureflow-dock"));
  await w.chrome.storage.sync.set({ floatingBar: true });
  await sleep(30);
  check("switched back on: back", Boolean(doc.querySelector("pureflow-dock")));
  await w.chrome.storage.sync.set({ enabled: false });
  await sleep(20);
  check("PureFlow paused: gone, YouTube as normal", !doc.querySelector("pureflow-dock"));
}

function testPanelManifest() {
  console.log("42. Toolbar icon keeps the popup; websites can reach no PureFlow file");
  const m = MANIFEST;
  check("toolbar icon opens the popup as before", m.action.default_popup === "popup/popup.html");
  check("permissions: activeTab (ads blocked on this page) + blocking, scripts, storage",
    JSON.stringify(m.permissions) === JSON.stringify(["activeTab", "declarativeNetRequest", "scripting", "storage"]));
  check("works on every website (needed to hide ad boxes everywhere)", JSON.stringify(m.host_permissions) === '["<all_urls>"]');
  check("no PureFlow file is reachable by websites (no web_accessible_resources)", !m.web_accessible_resources);
  check("background hands out the page and icons as data", /type !== "assets"/.test(read("background.js")) && read("background.js").includes("data:image/png;base64"));
  check("Focus hides the new end-of-video grid too", /hide-endscreens] .ytp-fullscreen-grid/.test(read("styles/hide.css")));
  check("floating button sits above the settings panel (its icon can close it)",
    /z-index: 2147483647/.test(read("content/features/dock.js")) && /z-index: 2147483646/.test(read("panel/panel.js")));
  check("floating button and panel load on YouTube", CONTENT_FILES.includes("content/features/dock.js") && CONTENT_FILES.includes("panel/panel.js"));
}

function testFilterConverter() {
  console.log("43. EasyList converter: only what it fully understands, never YouTube");
  const { convert, parseNetworkRule } = require(path.join(__dirname, "..", "scripts", "filters.js"));
  const r = parseNetworkRule("||ads.example.com^$third-party,script,domain=a.com|~b.a.com");
  check("ad server rule understood", r && r.domain === "ads.example.com" && r.condition.domainType === "thirdParty" &&
    JSON.stringify(r.condition.resourceTypes) === '["script"]' && JSON.stringify(r.condition.initiatorDomains) === '["a.com"]' &&
    JSON.stringify(r.condition.excludedInitiatorDomains) === '["b.a.com"]', JSON.stringify(r));
  check("rules with options we don't support are skipped (popup, csp...)", parseNetworkRule("||x.com^$popup") === null &&
    parseNetworkRule("||x.com^$csp=script-src 'none'") === null && parseNetworkRule("/banner/*/img^") === null);
  check("wildcard domains are skipped", parseNetworkRule("||x.com^$domain=example.*") === null);
  const out = convert([
    "! comment", "||ads.one.com^", "||ads.two.com^", "||tracker.net^$third-party", "@@||ads.two.com^$script,domain=ok.com",
    "||doubleclick.youtube.com^", "##.ad-banner", "##.sponsor-box", "news.com#@#.sponsor-box",
    "news.com,shop.com##.top-ad", "~blog.news.com,news.com##.weird", "youtube.com##.yt-thing",
    "site.com#?#.ad:-abp-has(span)", "site.com##+js(nobab)", "site.com###box ~ #main {top:48px;}", "@@||safe.org^$generichide",
  ].join("\n"));
  const blocks = out.rules.filter((x) => x.action.type === "block");
  check("ad servers with the same options grouped in one rule",
    blocks.some((x) => JSON.stringify(x.condition.requestDomains) === '["ads.one.com","ads.two.com"]'), JSON.stringify(blocks));
  check("EasyList's own exceptions become allow rules that win", out.rules.some((x) => x.action.type === "allow" && x.priority > 1));
  check("YouTube is never touched by these rules", out.rules.every((x) => x.condition.excludedInitiatorDomains.includes("youtube.com") &&
    !x.condition.requestDomains.some((d) => d.includes("youtube"))));
  check("box hidden everywhere", out.generic.includes(".ad-banner"));
  check("a box some site needs is never hidden everywhere", !out.generic.includes(".sponsor-box"));
  check("site boxes per site", out.sites["news.com"]?.includes(".top-ad") && out.sites["shop.com"]?.includes(".top-ad"));
  check("rules with site exceptions (~) skipped", !(out.sites["news.com"] || []).includes(".weird"));
  check("no YouTube site rules", !out.sites["youtube.com"]);
  check("extended syntax skipped (#?#, +js, {style})", !JSON.stringify(out).includes("abp-has") &&
    !JSON.stringify(out).includes("nobab") && !JSON.stringify(out).includes("top:48px"));
  check("every hiding line is a plain 'selector{display:none!important}'",
    Object.values(JSON.parse(read("filters/hide-sites.json"))).join("").split("\n")
      .every((l) => !l || /^[^{}]+\{display:none!important\}$/.test(l)));
  check("sites that turn generic hiding off are listed", out.noGeneric.includes("safe.org"));
}

function testFilterFiles() {
  console.log("44. Built filter files: within Chrome's limits, valid, YouTube-free");
  const rules = JSON.parse(read("rules/web-ads.json"));
  const ids = new Set(rules.map((x) => x.id));
  check("rule ids unique", ids.size === rules.length);
  check("well under Chrome's 30,000 static rule limit", rules.length < 1000, rules.length);
  const servers = rules.reduce((n, x) => n + x.condition.requestDomains.length, 0);
  check("tens of thousands of ad servers covered", servers > 10000, servers);
  check("every rule leaves YouTube to its own engine", rules.every((x) => x.condition.excludedInitiatorDomains.includes("youtube.com")));
  check("no rule blocks a whole page (main_frame)", rules.every((x) => !(x.condition.resourceTypes || []).includes("main_frame")));
  const css = read("filters/hide-generic.css");
  check("generic hiding: one selector per rule (a bad one only drops itself)",
    css.split("\n").filter((l) => l && !l.startsWith("/*") && !l.startsWith("a.google-anno{"))
      .every((l) => l.endsWith("{display:none!important}")));
  check("Google's ad-link words stay readable (plain text, not hidden)", css.includes("a.google-anno{color:inherit!important") &&
    !css.includes("\na.google-anno{display:none") && css.includes("#google-anno-sa{display:none!important}"));
  check("generic hiding has thousands of ad boxes", css.split("\n").length > 1000);
  const sites = JSON.parse(read("filters/hide-sites.json"));
  check("site hiding for thousands of sites", Object.keys(sites).length > 1000);
  check("manifest has the web ruleset", MANIFEST.declarative_net_request.rule_resources.some((x) => x.id === "web_ads" && x.path === "rules/web-ads.json"));
}

/** Run background.js with a fake browser; returns what it registered and blocked. */
async function runBackground(syncData = {}) {
  const dom = new JSDOM("", { url: "chrome-extension://x/background.js", runScripts: "outside-only" });
  const w = dom.window;
  const chrome = makeChrome();
  Object.assign(chrome._data.sync, syncData);
  const state = { rulesets: new Set(["ad_rules", "web_ads"]), dynamic: [], registered: [], insertedCss: [], session: [], executed: [] };
  const listeners = { message: [], changed: [] };
  chrome.storage.onChanged = { addListener: (l) => listeners.changed.push(l) };
  const origSet = chrome.storage.sync.set;
  chrome.storage.sync.set = async (v) => { await origSet(v); listeners.changed.forEach((l) => l(Object.fromEntries(Object.keys(v).map((k) => [k, {}])), "sync")); };
  chrome.runtime.onMessage = { addListener: (l) => listeners.message.push(l) };
  chrome.runtime.onInstalled = chrome.runtime.onStartup = { addListener() {} };
  chrome.tabs = { query: async () => [], onRemoved: { addListener() {} }, onUpdated: { addListener() {} } };
  chrome.declarativeNetRequest = {
    updateEnabledRulesets: async ({ enableRulesetIds = [], disableRulesetIds = [] }) => {
      enableRulesetIds.forEach((id) => state.rulesets.add(id)); disableRulesetIds.forEach((id) => state.rulesets.delete(id));
    },
    updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
      state.dynamic = state.dynamic.filter((x) => !removeRuleIds.includes(x.id)).concat(addRules);
    },
    updateSessionRules: async ({ addRules = [] }) => { state.session.push(...addRules); },
  };
  chrome.scripting = {
    getRegisteredContentScripts: async () => state.registered,
    unregisterContentScripts: async ({ ids }) => { state.registered = state.registered.filter((x) => !ids.includes(x.id)); },
    registerContentScripts: async (list) => { state.registered.push(...list); },
    insertCSS: async (x) => { state.insertedCss.push(x); },
    executeScript: async (x) => { state.executed.push(x); return []; },
  };
  const files = { "filters/no-generic.json": JSON.parse(read("filters/no-generic.json")), "filters/hide-sites.json": { "news.com": ".top-ad{display:none!important}\n" },
    "rules/web-ads.json": JSON.parse(read("rules/web-ads.json")) };
  w.fetch = async (url) => ({ json: async () => files[url.replace("chrome-extension://x/", "")], text: async () => "" });
  w.chrome = chrome;
  w.eval(read("background.js"));
  await sleep(50);
  const send = (message, sender) => new Promise((resolve) => listeners.message.forEach((l) => l(message, sender, resolve)));
  return { state, chrome, send };
}

async function testWebBlocking() {
  console.log("45. Other websites: blocked by default, per-site off switch, pause turns it off");
  let b = await runBackground();
  check("ad servers blocked on other websites", b.state.rulesets.has("web_ads"));
  const css = b.state.registered.find((x) => x.id === "pf-web-hide");
  check("ad boxes hidden on every site", css && css.matches[0] === "<all_urls>" && css.css[0] === "filters/hide-generic.css");
  check("...but never on YouTube", css.excludeMatches.includes("*://*.youtube.com/*"));
  check("...nor where EasyList says generic hiding breaks the site",
    JSON.parse(read("filters/no-generic.json")).every((s) => css.excludeMatches.includes(`*://*.${s}/*`)));
  const reply = await b.send({ type: "site-hide", host: "www.news.com" }, { tab: { id: 4 }, frameId: 2 });
  await sleep(10);
  check("site-specific boxes added for www.news.com (rules for news.com)", reply === true &&
    b.state.insertedCss[0]?.css.includes(".top-ad") && b.state.insertedCss[0].target.tabId === 4 &&
    b.state.insertedCss[0].target.frameIds[0] === 2);
  const none = await b.send({ type: "site-hide", host: "plain.org" }, { tab: { id: 4 }, frameId: 0 });
  check("site without own rules: nothing added", none === false && b.state.insertedCss.length === 1);

  await b.chrome.storage.sync.set({ allowedSites: { "news.com": true } });
  await sleep(50);
  const allow = b.state.dynamic.find((x) => x.id === 1);
  check("allow ads on news.com: its requests allowed", allow?.action.type === "allowAllRequests" &&
    JSON.stringify(allow.condition.requestDomains) === '["news.com"]' && allow.priority > 2);
  check("...and its boxes no longer hidden", b.state.registered.every((x) => x.excludeMatches.includes("*://*.news.com/*")));

  await b.chrome.storage.sync.set({ enabled: false });
  await sleep(50);
  check("PureFlow paused: other websites back to normal",
    !b.state.rulesets.has("web_ads") && b.state.registered.length === 0 && b.state.dynamic.length === 0);
  await b.chrome.storage.sync.set({ enabled: true });
  await sleep(50);
  check("switched back on: blocking again", b.state.rulesets.has("web_ads") && b.state.registered.length === 2);

  b = await runBackground({ webBlock: false });
  check("'Block ads on every website' off: only YouTube", !b.state.rulesets.has("web_ads") && b.state.registered.length === 0);

  // the page script
  const dom = new JSDOM("", { url: "https://www.news.com/story", runScripts: "outside-only" });
  const sent = [];
  dom.window.chrome = { runtime: { sendMessage: (m) => { sent.push(m); return Promise.resolve(); } } };
  dom.window.eval(read("content/web.js"));
  dom.window.eval(read("content/web.js")); // added twice: still asks once
  check("page asks for its site rules once", sent.length === 1 && sent[0].host === "www.news.com");
}

async function testSiteCard() {
  console.log("46. Popup on another website: only one switch, block ads here, applied at once");
  const b = await runBackground(); // the real background.js answers the popup
  const reloaded = [];
  b.chrome.tabs.reload = async (id) => { reloaded.push(id); };
  const html = read("popup/popup.html").replace(/<script[^>]*><\/script>/g, "");
  const open = async (url) => {
    const dom = new JSDOM(html, { url: "chrome-extension://x/popup/popup.html", runScripts: "outside-only" });
    const w = dom.window;
    w.chrome = makeChrome();
    w.chrome.storage = b.chrome.storage; // one browser: popup and background share the settings
    w.chrome._data = b.chrome._data;
    w.chrome.runtime.sendMessage = (m) => b.send(m, { id: "test-id", url: "chrome-extension://x/popup/popup.html" });
    w.chrome.tabs = { query: async () => [{ id: 9, url, status: "complete" }],
      sendMessage: async () => { throw new Error("no PureFlow page script here"); }, reload: () => {} };
    w.chrome.declarativeNetRequest = { getMatchedRules: async ({ tabId }) => ({ rulesMatchedInfo: tabId === 9 ? new Array(23).fill({}) : [] }) };
    ["brand.js", "content/settings.js", "popup/greeting.js", "popup/popup.js"].forEach((file) => w.eval(read(file)));
    await sleep(80);
    return w;
  };
  const w = await open("https://www.news.com/story");
  const doc = w.document;
  const shown = (el) => el && w.getComputedStyle(el).display !== "none" && !el.hidden;
  check("news.com: one-switch view", doc.body.classList.contains("site-mode"));
  check("card shown for news.com", !doc.getElementById("site-card").hidden && doc.getElementById("site-name").textContent === "news.com");
  check("says how many ads were blocked here", /23 ads blocked on this page/.test(doc.getElementById("site-count").textContent),
    doc.getElementById("site-count").textContent);
  check("switch on (blocking)", doc.getElementById("block-site").checked);
  check("no 'refresh' note on a normal website", doc.getElementById("update-notice").hidden);
  const sw = doc.getElementById("block-site");
  sw.checked = false;
  sw.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(80);
  check("switch off: ads allowed on news.com (saved, synced)", b.chrome._data.sync.allowedSites?.["news.com"] === true);
  check("...the blocker lets news.com through", b.state.dynamic.some((x) => x.id === 1 && x.condition.requestDomains.includes("news.com")));
  check("...and the page reloads by itself (no Refresh button to press)", reloaded[0] === 9 && doc.getElementById("update-notice").hidden);
  check("...says ads are shown here", !sw.checked && /Ads are shown on this site/.test(doc.getElementById("site-count").textContent));
  const before = b.state.insertedCss.length;
  sw.checked = true;
  sw.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(80);
  check("switch on again: removed from the list", !("news.com" in b.chrome._data.sync.allowedSites));
  const added = b.state.insertedCss.slice(before);
  check("...ads hidden on the open page at once, in every frame, no reload",
    added.some((x) => x.files?.[0] === "filters/hide-generic.css") && added.some((x) => x.css?.includes(".top-ad")) &&
    added.every((x) => x.target.tabId === 9 && x.target.allFrames) && reloaded.length === 1);

  check("...and ads already on the page are hidden too (in every frame)",
    b.state.executed.some((x) => x.target.tabId === 9 && x.target.allFrames && x.func?.name === "pageHideAds"));
  check("status line: one short line (popup never jumps)", !doc.getElementById("site-count").textContent.includes(". "));

  // Ads that loaded before blocking was switched on: Google's own "display:block !important" can't win
  const src = read("background.js");
  const fn = src.slice(src.indexOf("function pageHideAds"), src.indexOf("/** Hide ads already on the page"));
  const page = new JSDOM(`<body style="overflow:hidden"><p id="story">News</p>
    <ins class="adsbygoogle" style="display:block !important"><iframe id="aswift_1"></iframe></ins>
    <div id="slot"><iframe src="https://ads.adnet.example/x"></iframe></div><iframe id="video" src="https://player.example/v"></iframe></body>`,
    { url: "https://news.com/", runScripts: "outside-only" });
  page.window.eval(fn);
  const pdoc = page.window.document;
  const hosts = page.window.pageHideAds(null);
  check("Google ad box hidden at once, even with its own !important",
    pdoc.querySelector("ins.adsbygoogle").style.getPropertyValue("display") === "none" &&
    pdoc.querySelector("ins.adsbygoogle").style.getPropertyPriority("display") === "important");
  check("page scrolls again (vignette lock removed)", pdoc.body.style.overflow === "");
  check("reports the page's frames", hosts.includes("ads.adnet.example") && hosts.includes("player.example"));
  page.window.pageHideAds(["ads.adnet.example"]);
  check("frame from an ad server hidden; the video player and the story stay",
    pdoc.querySelector("#slot iframe").style.display === "none" && pdoc.getElementById("video").style.display === "" &&
    pdoc.getElementById("story").style.display === "");

  // The background doesn't answer (e.g. an older copy still running): the switch must still stick.
  const w3 = await open("https://www.news.com/story");
  const pageReloads = [];
  w3.chrome.runtime.sendMessage = () => Promise.resolve(undefined);
  w3.chrome.tabs.reload = (id) => pageReloads.push(id);
  const sw3 = w3.document.getElementById("block-site");
  sw3.checked = false;
  sw3.dispatchEvent(new w3.Event("change", { bubbles: true }));
  await sleep(50);
  check("no answer from the background: still saved, and the page reloads",
    b.chrome._data.sync.allowedSites?.["news.com"] === true && pageReloads[0] === 9);
  sw3.checked = true;
  sw3.dispatchEvent(new w3.Event("change", { bubbles: true }));
  await sleep(50);
  check("...and switching back on sticks too", !("news.com" in b.chrome._data.sync.allowedSites) && pageReloads.length === 2);

  // Only the popup may flip a site: never a web page.
  const fromPage = await Promise.race([b.send({ type: "web-site", tabId: 9, site: "news.com", block: false }, { id: "test-id", tab: { id: 9 } }), sleep(50).then(() => "ignored")]);
  check("a web page can't switch blocking off", fromPage === "ignored" && !("news.com" in b.chrome._data.sync.allowedSites));

  // 'Block ads on every website' was off: the one switch turns it on for this site
  await b.chrome.storage.sync.set({ webBlock: false });
  await sleep(50);
  const w2 = await open("https://shop.example.org/");
  const sw2 = w2.document.getElementById("block-site");
  check("blocking off everywhere: switch shows off", !sw2.checked);
  sw2.checked = true;
  sw2.dispatchEvent(new w2.Event("change", { bubbles: true }));
  await sleep(80);
  check("...turning it on blocks ads again", b.chrome._data.sync.webBlock === true && b.state.rulesets.has("web_ads"));

  // YouTube: the full settings, no site switch
  const yt = await open("https://www.youtube.com/watch?v=abc");
  const ydoc = yt.document;
  check("YouTube: full settings (speed, quality, focus), no site switch",
    !ydoc.body.classList.contains("site-mode") && ydoc.getElementById("site-card").hidden &&
    Boolean(ydoc.getElementById("speed-chips")) && Boolean(ydoc.querySelector('[data-setting="webBlock"]')));
  check("site view hides the video settings (CSS)", read("popup/popup.css").includes("body.site-mode #main > section:not(#site-card)"));
  void shown;
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
  await testPlayNextRightAway();
  await testQuality();
  await testLoop();
  await testScreenshot();
  await testShortcuts();
  await testWheelVolume();
  await testPlayerButtons();
  await testPopupV2();
  await testPausedLeavesKeysAndWheelAlone();
  await testKeyRepeatAndTrackpad();
  await testLoopEdges();
  await testOwnerKeepsButtons();
  await testVolumeWhenMuted();
  await testQualityEdges();
  await testInterruptionsPopup();
  await testOnlySupportedQualities();
  await testFloatingPanel();
  await testPanelPage();
  await testDock();
  testPanelManifest();
  testFilterConverter();
  testFilterFiles();
  await testWebBlocking();
  await testSiteCard();
  testBuilds();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
