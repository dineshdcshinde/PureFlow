# PureFlow

Ad-free, distraction-free YouTube. Light, fast and private.
One engine, built for **Chrome**, **Edge** and **Firefox**.

> Name and store title live in one place: `brand.json`.
> Store title: "PureFlow - Ad Blocker for YouTube™" (keywords for store search).

## Features

| | Feature | Where |
|---|---|---|
| V1 | Block ad servers | `src/rules/ads.json` |
| V1 | Hide ad boxes | `src/styles/hide.css` |
| V1 | Remove the ad plan before the player sees it | `src/inject.js` |
| V1 | Skip ads that still get in (never your own video) | `src/content/ads.js` |
| V2 | Popup: on/off, ads blocked, time saved | `src/popup/` |
| V2 | Support creators: allow ads on channels you pick | `src/content/features/creators.js` |
| V2 | Focus mode: hide Shorts, comments, recommendations, end screens | `src/content/features/focus.js` |
| V2 | Default playback speed | `src/content/features/speed.js` |
| V2 | Skip sponsor parts (opt-in, SponsorBlock) | `src/content/features/sponsor.js` |

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
  inject.js             Removes ad plans from YouTube data (page world)
  content/
    settings.js         Saved settings and stats (shared with the popup)
    overlay.js          Messages on the player
    ads.js              Detect and skip an ad already in the player
    features/           One file per V2 feature
    main.js             Coordinator: decides when things happen
  styles/hide.css       All hiding, switched by attributes on <html>
  rules/ads.json        Blocked ad servers
  popup/                Toolbar popup
  icons/
scripts/build.js        src + platform -> dist/<browser>
tests/test.js           Automated tests (65 checks)
```

## Build and load

Needs Node.js 18+.

```
npm install          # only needed for tests
npm run build        # builds dist/chrome, dist/edge, dist/firefox
```

- **Chrome:** `chrome://extensions` > Developer mode > Load unpacked > `dist/chrome`
- **Edge:** `edge://extensions` > Developer mode > Load unpacked > `dist/edge`
- **Firefox (128+):** `about:debugging#/runtime/this-firefox` > Load Temporary Add-on > `dist/firefox/manifest.json`

After a code change: `npm run build`, then click reload on the extension card.

## Test

```
npm test             # builds Chrome, then runs all checks
```

## Adding a new browser

1. Add `platforms/<browser>.json` with only what differs.
2. Add the name to `PLATFORMS` in `scripts/build.js`.
The engine in `src/` does not change.

## When the message on the player shows

1. An ad is in the player (we hide it, so we explain the black screen).
2. The extension was just switched on in an open tab and the video is stuck over 1.5s.

Normal next/previous never shows a message.

## Privacy

- No data leaves the browser. Settings sync through the browser's own storage.
- Stats stay on this computer.
- Sponsor skip is **off by default**. When on, it sends only the first 4 characters of a
  hash of the video id to SponsorBlock, never the video id itself.

## Before publishing

- Change the Firefox id in `platforms/firefox.json` to your own domain (e.g. pureflow@yourdomain.com).
- Keep `DEBUG = false` in `src/inject.js` and `src/content/main.js`.
- Zip the `dist/<browser>` folder, not the whole project.
- Store listing must say: "Not affiliated with YouTube. YouTube is a trademark of Google LLC."
- Mention sponsor skip and SponsorBlock in the privacy section.

Not affiliated with YouTube. YouTube is a trademark of Google LLC.
