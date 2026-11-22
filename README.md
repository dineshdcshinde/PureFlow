# PureFlow

**Watch videos without ads and without distractions.**
Free, light and private. One code base for **Chrome**, **Edge** and **Firefox**.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Browsers](https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge%20%7C%20Firefox-green)
![Privacy](https://img.shields.io/badge/data%20collected-none-brightgreen)

---

## Features

| Feature | What it does |
|---|---|
| **Ad blocking** | Blocks video, banner and overlay ads before they load |
| **Ad skip backup** | If an ad still gets in, it is muted and skipped at once |
| **Focus mode** | Hide Shorts, comments, recommendations and end screens, each with its own switch |
| **Playback speed** | Pick any speed from 1x to 3x, applied to every video |
| **Sponsor skip** *(optional)* | Jumps past "this video is sponsored by…" parts, using SponsorBlock data |
| **Support creators** | Allow ads on the channels you choose |
| **Stats** | See how many ads were blocked and how much time you saved |
| **Pause switch** | Turn PureFlow off and on from the popup |
| **Light and dark mode** | Plus a friendly greeting with your name |

---

## Roadmap

**Released: version 1.0.0**

- [x] Ad blocking and ad skip
- [x] Popup with on/off switch and stats
- [x] Focus mode
- [x] Playback speed
- [x] Sponsor skip (opt-in)
- [x] Support creators
- [x] Chrome, Edge and Firefox builds

**Coming next**

- [ ] Default video quality
- [ ] Change volume with the mouse wheel
- [ ] Save a screenshot of a video frame
- [ ] Keyboard shortcuts
- [ ] Loop part of a video

Have an idea? [Open an issue](../../issues) and tell us.

---

## How to use

1. Install PureFlow from your browser's store, or load it yourself (see [Install from source](#install-from-source)).
2. Pin it: click the puzzle icon at the top right of the browser, then the pin next to PureFlow.
3. Open any video. Ads are blocked straight away, nothing to set up.
4. Click the PureFlow icon to:
   - turn focus mode items on or off
   - set your playback speed
   - turn on sponsor skip
   - add your name for the greeting
5. **To support a creator:** open one of their videos, click the PureFlow icon and switch on **"Allow ads on this channel"**.
6. **To take a break:** use the switch at the top of the popup to pause PureFlow.

---

## How it works

PureFlow stops ads in four layers, so if one misses, the next one catches it:

1. **Block ad servers.** Chrome's built-in blocking engine stops requests to known ad servers ([src/rules/ads.json](src/rules/ads.json)).
2. **Remove the ad plan.** Before the player loads, PureFlow takes the ad list out of the page data, so no ad is scheduled ([src/inject.js](src/inject.js)).
3. **Hide ad boxes.** Banner and sponsored boxes are hidden with CSS ([src/styles/hide.css](src/styles/hide.css)).
4. **Skip what gets through.** If an ad still plays, it is muted and skipped. Your own video is never touched ([src/content/ads.js](src/content/ads.js)).

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
  content/
    settings.js         Saved settings and stats (shared with the popup)
    overlay.js          Messages on the player
    ads.js              Detect and skip an ad already in the player
    features/           One file per feature (creators, focus, speed, sponsor)
    main.js             Coordinator: decides when things happen
  styles/hide.css       All hiding, switched by attributes on <html>
  rules/ads.json        Blocked ad servers
  popup/                Toolbar popup
  icons/
scripts/build.js        src + platform -> dist/<browser>
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
npm test             # builds Chrome, then runs all checks
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
| A setting doesn't apply | Reload the video page after changing it |
| Nothing works after an update | Open your browser's extensions page and click reload on PureFlow |

---

## Contributing

Pull requests are welcome.

1. Keep one job per file, like the rest of the code.
2. Add a test for every new feature in [tests/test.js](tests/test.js).
3. Run `npm test` before sending your pull request.

---

## Credits

Sponsor segment data from [SponsorBlock](https://sponsor.ajay.app), licensed CC BY-NC-SA 4.0.

PureFlow is an independent project. Not affiliated with, endorsed by, or sponsored by YouTube or Google LLC. YouTube is a trademark of Google LLC.
