# PureFlow

**Watch videos without ads and without distractions, and browse every website without ads.**
Free, light and private. One code base for **Chrome**, **Edge** and **Firefox**.

![Version](https://img.shields.io/badge/version-3.0.0-blue)
![Browsers](https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge%20%7C%20Firefox-green)
![Privacy](https://img.shields.io/badge/data%20collected-none-brightgreen)

---

## Features

| Feature | What it does |
|---|---|
| **Ad blocking** | Blocks video, banner and overlay ads before they load |
| **Ads blocked on every website** | Not only YouTube: ad servers are blocked and the empty ad boxes are hidden on any site, using the public EasyList. One switch per site if a site needs its ads |
| **Ad skip backup** | If an ad still gets in, it is muted and skipped at once |
| **No nagging popups** | Hides YouTube's "Experiencing interruptions?" popup (normal popups like "Saved to Watch later" still show) |
| **Focus mode** | Hide Shorts, comments, recommendations and end screens, each with its own switch |
| **Playback speed** | Pick any speed from 1x to 3x. It changes the open video at once, and every video after it |
| **Default quality** | Pick a quality from 144p up to 8K. It changes the open video at once, and every new video starts at it (or the best one below it). The popup only shows the qualities the open video has |
| **Play next right away** | No black wait between videos: skips YouTube's "Up next in 8" countdown when Autoplay is on |
| **Loop part of a video** | Mark a start and an end, and that part repeats |
| **Screenshot** | Save the frame on screen as a PNG, in one click |
| **Player buttons** | Screenshot and loop buttons on the player bar, in line with YouTube's own buttons |
| **Keyboard shortcuts** | `Shift+S` screenshot, `Shift+L` loop |
| **Mouse wheel volume** *(optional)* | Scroll over the video to turn it up or down |
| **Sponsor skip** *(optional)* | Jumps past "this video is sponsored by…" parts, using SponsorBlock data |
| **Support creators** | Allow ads on the channels you choose |
| **Stats** | See how many ads were blocked and how much time you saved |
| **Floating button** | A small PureFlow button on YouTube. Tap it for one row of quick controls: speed − / +, quality, screenshot, loop, focus and all settings. Drag it anywhere; it stays where you put it |
| **All settings on the page** | The ⚙ in that row opens every setting in a panel on the page. Drag it by its top bar |
| **Pause switch** | Turn PureFlow off and on from the popup |
| **Light and dark mode** | Plus a friendly greeting with your name |

---

## Roadmap

**Version 1.0.0**

- [x] Ad blocking and ad skip
- [x] Popup with on/off switch and stats
- [x] Focus mode
- [x] Playback speed
- [x] Sponsor skip (opt-in)
- [x] Support creators
- [x] Chrome, Edge and Firefox builds

**Version 2.0.0**

- [x] Default video quality
- [x] Change volume with the mouse wheel
- [x] Save a screenshot of a video frame
- [x] Keyboard shortcuts
- [x] Loop part of a video
- [x] Play the next video right away (fixes the black screen between videos)
- [x] Screenshot and loop buttons on the player bar
- [x] Hide the "Experiencing interruptions?" popup
- [x] Popup shows only the qualities the open video has (144p to 8K)

**Version 3.0.0**

- [x] Floating PureFlow button on YouTube: one row for speed, quality, screenshot, loop, focus and settings
- [x] All settings in a panel you can drag anywhere on the page
- [x] One-tap focus mode (hide Shorts, comments, suggestions and end screens together)
- [x] Block ads on every website, not only YouTube (EasyList)
- [x] Turn ad blocking off for one website, and see how many ads were blocked on the page

Have an idea? [Open an issue](../../issues) and tell us.

---

## How to use

1. Install PureFlow from your browser's store, or load it yourself (see [Install from source](#install-from-source)).
2. Pin it: click the puzzle icon at the top right of the browser, then the pin next to PureFlow.
3. Open any video, or any website. Ads are blocked straight away, nothing to set up.
4. **On YouTube**, tap the round PureFlow button (bottom right) for one row of quick controls:
   - **− 1× +** slower / faster · **1080p ▾** quality (only what this video has) · 📷 screenshot · ⟲ loop · ◎ focus · ⚙ all settings
   - Drag the button anywhere. Tap it again to fold the row away. Turn it off in the popup under **Tools**.
5. Click the PureFlow icon in the toolbar for all settings:
   - focus items, speed, quality, play next right away, sponsor skip, player buttons, shortcuts, mouse wheel volume, your name
   - **On any other website** the popup is just one switch: **Block ads on this site**, with how many ads were blocked on the page. Turn it on and the ads vanish at once; turn it off and the page reloads with its ads
6. **To support a creator:** open one of their videos, click the PureFlow icon and switch on **"Allow ads on this channel"**.
7. **To take a break:** use the switch at the top of the popup to pause PureFlow.
8. **Screenshot:** click the camera button on the player bar, or press `Shift+S`. The picture goes to your Downloads folder.
9. **Loop a part:** click the loop button (or press `Shift+L`) where the part starts, again where it ends. Press a third time to stop.

---

## How it works

PureFlow stops ads in four layers, so if one misses, the next one catches it:

1. **Block ad servers.** Chrome's built-in blocking engine stops requests to known ad servers ([src/rules/ads.json](src/rules/ads.json)).
2. **Remove the ad plan.** Before the player loads, PureFlow takes the ad list out of the page data, so no ad is scheduled ([src/inject.js](src/inject.js)).
3. **Hide ad boxes.** Banner and sponsored boxes are hidden with CSS ([src/styles/hide.css](src/styles/hide.css)).
4. **Skip what gets through.** If an ad still plays, it is muted and skipped. Your own video is never touched ([src/content/ads.js](src/content/ads.js)).

**On every other website** PureFlow uses the public [EasyList](https://easylist.to):

1. **Block ad servers.** About 46,000 ad servers, in Chrome's built-in blocker ([src/rules/web-ads.json](src/rules/web-ads.json)).
2. **Hide the empty ad boxes.** Common ad boxes everywhere ([src/filters/hide-generic.css](src/filters/hide-generic.css)), plus the boxes EasyList knows for each site ([src/filters/hide-sites.json](src/filters/hide-sites.json)).

These files are made from EasyList by [scripts/filters.js](scripts/filters.js). It only keeps rules it fully understands, and leaves out any hiding rule EasyList says breaks a site, so a page is never broken by a guess. PureFlow adds a few rules of its own for ads EasyList misses (Mediavine / Grow bottom bars, Google "ad intents" bubbles and links, Kargo full-screen ads). Refresh them with `npm run filters -- --update`.

Each extra feature lives in its own file under [src/content/features/](src/content/features/). [src/content/main.js](src/content/main.js) decides when each one runs. Nothing runs in the background when you are not watching.

---

## Project layout

```
brand.json              Name, version, description (one place)
platforms/
  base.json             Manifest shared by every browser
  chrome.json           Chrome-only bits (service worker)
  edge.json             Edge-only bits (service worker)
  firefox.json          Firefox-only bits (background scripts, add-on id)
src/                    THE ENGINE: same code for every browser
  background.js         Adds scripts to open tabs, per-tab allow rules for creators
  inject.js             Removes ad plans from the page data (page world)
  bridge.js             Asks the player for quality and volume changes (page world)
  content/
    settings.js         Saved settings and stats (shared with the popup)
    assets.js           The settings page and icon for the on-page parts (from background.js)
    web.js              Every other website: asks for that site's ad-box rules
    overlay.js          Messages on the player
    ads.js              Detect and skip an ad already in the player
    features/           One file per feature (creators, focus, speed, quality, sponsor, notices,
                        autonext, loop, screenshot, controls, dock = the floating button)
    main.js             Coordinator: decides when things happen
  styles/hide.css       All hiding, switched by attributes on <html>
  rules/ads.json        Blocked ad servers on YouTube
  rules/web-ads.json    Blocked ad servers on every other website (from EasyList)
  filters/              Ad boxes to hide on other websites (from EasyList)
  popup/                The settings page (toolbar popup, and the All settings panel)
  panel/panel.js        All settings, as a draggable panel on the YouTube page
  icons/
scripts/build.js        src + platform -> dist/<browser>
scripts/filters.js      EasyList -> rules/web-ads.json and filters/ (npm run filters)
tests/test.js           Automated tests
store/                  Store listing text, images and privacy policy
docs/                   Public pages (privacy policy)
```

---

## Install from source

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install          # installs test tools
npm run build        # builds dist/chrome, dist/edge and dist/firefox
```

Then load it in your browser:

- **Chrome:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, choose `dist/chrome`
- **Edge:** open `edge://extensions`, turn on Developer mode, click **Load unpacked**, choose `dist/edge`
- **Firefox (128+):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, choose `dist/firefox/manifest.json`

After changing the code, run `npm run build` again, then click reload on the extension card.

### Run the tests

```bash
npm test             # builds every browser, then runs all checks
```

### Add another browser

1. Add `platforms/<browser>.json` with only what is different.
2. Add the name to `PLATFORMS` in [scripts/build.js](scripts/build.js).

The engine in `src/` does not change.

---

## Privacy

- No account, no tracking, no analytics.
- Your settings and stats stay in your browser.
- Your name, if you add it, never leaves your computer.
- Screenshots are made on your computer and saved to your Downloads folder. Nothing is uploaded.
- On other websites, blocking happens inside your browser with a built-in list. PureFlow never sends, stores or looks at the pages you visit; it only uses the site's name to pick that site's ad-box rules, on your computer.
- Sponsor skip is **off by default**. When on, it sends only the first 4 characters of a hash of the video id to SponsorBlock, never the video id itself.

Full policy: [docs/privacy.html](docs/privacy.html)

---

## Help and support

Something not working? Have a question or an idea?

- **Report a problem or ask a question:** [open an issue](../../issues). Please include:
  - your browser and its version
  - your PureFlow version
  - what happened, and what you expected to happen
  - a link to the video, if it is about one video
- **Suggest a feature:** [open an issue](../../issues) and describe what you would like.

I read every issue and reply as soon as I can.

### Quick fixes

| Problem | Try this |
|---|---|
| An ad still shows | Reload the page. If it keeps happening, open an issue with the video link |
| The video is black or stuck | Pause PureFlow with the popup switch, reload, then switch it back on |
| A setting doesn't apply | Speed and quality change at once. For the other settings, reload the video page |
| Black screen for a few seconds between videos | Make sure **Play next video right away** is on in the popup (it only works when YouTube's Autoplay is on) |
| A website looks broken | Click the PureFlow icon on that site and switch off **Block ads on this site** (the page reloads by itself) |
| The floating button is in the way | Drag it somewhere else, or turn it off in the popup under **Tools** |
| A shortcut does nothing | Click on the video first, so the page (not a text box) has focus |
| Nothing works after an update | Open your browser's extensions page, click reload on PureFlow, then reload the YouTube tab |

---

## Contributing

Pull requests are welcome.

1. Keep one job per file, like the rest of the code.
2. Add a test for every new feature in [tests/test.js](tests/test.js).
3. Run `npm test` before sending your pull request.

---

## Credits

Sponsor segment data from [SponsorBlock](https://sponsor.ajay.app), licensed CC BY-NC-SA 4.0.

Ad blocking on other websites uses [EasyList](https://easylist.to), © The EasyList authors, dual licensed GPLv3 and CC BY-SA 3.0. The files built from it ([src/rules/web-ads.json](src/rules/web-ads.json), [src/filters/](src/filters/)) are under the same licence.

PureFlow is an independent project. Not affiliated with, endorsed by, or sponsored by YouTube or Google LLC. YouTube is a trademark of Google LLC.
