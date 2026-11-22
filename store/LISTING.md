# PureFlow: Chrome Web Store listing

Copy each part into the matching field in the Chrome Web Store Developer Dashboard.
The word "YouTube" is used in only one public place: the "not affiliated" line.

Upload file: `store/pureflow-chrome-<version>.zip`

---

## 1. Store listing tab

**Name** (comes from the manifest)
```
PureFlow - Ad Blocker & Focus Mode
```

**Summary** (comes from the manifest, 115 of 132 characters)
```
Block video ads, skip sponsors and hide Shorts. Ad-free, distraction-free watching that is light, fast and private.
```

**Description** (paste as is)
```
PureFlow makes watching videos calm again. No ads, fewer distractions, and nothing about you ever leaves your browser.

WHAT IT DOES
• Blocks video ads, banner ads and sponsored cards
• If an ad still slips in, it is muted at once and skipped
• Focus mode: hide Shorts, comments, recommendations and end-of-video suggestions
• Playback speed from 1x to 3x, applied the moment you tap it
• Skip sponsor parts inside videos (optional)
• Support creators: allow ads on channels you choose
• See how many ads were blocked and how much time you saved
• Light and dark mode, plus a friendly greeting with your name

HOW TO USE
1. Install PureFlow, then click the puzzle icon in Chrome and pin PureFlow.
2. Open any video. Ads are blocked straight away, nothing to set up.
3. Click the PureFlow icon to turn on focus mode, set your speed or add your name.
4. Want to support a creator? Open one of their videos and switch on "Allow ads on this channel".
5. Need a break from PureFlow? Use the switch at the top of the popup to pause it.

LIGHT AND FAST
PureFlow uses Chrome's built-in blocking engine and only runs where it is needed. Nothing runs in the background when you are not watching.

PRIVATE BY DESIGN
• No account, no tracking, no analytics
• Your settings and stats stay in your browser
• Sponsor skip is off until you turn it on. When on, it sends only a 4-character code to SponsorBlock, never the video or anything about you

CREDITS
Sponsor segment data from SponsorBlock (sponsor.ajay.app), licensed CC BY-NC-SA 4.0.

PureFlow is an independent project. Not affiliated with, endorsed by, or sponsored by YouTube or Google LLC. YouTube is a trademark of Google LLC.
```

**Category:** Tools
**Language:** English

**Images** (all in `store/images/`, already the exact sizes Google asks for)

| Store field | File | Size |
|---|---|---|
| Store icon | `pureflow-store-icon-128x128.png` | 128 x 128 |
| Screenshot 1 | `pureflow-screenshot-1-ad-free-1280x800.png` | 1280 x 800 |
| Screenshot 2 | `pureflow-screenshot-2-one-popup-1280x800.png` | 1280 x 800 |
| Screenshot 3 | `pureflow-screenshot-3-focus-mode-1280x800.png` | 1280 x 800 |
| Screenshot 4 | `pureflow-screenshot-4-speed-and-sponsors-1280x800.png` | 1280 x 800 |
| Screenshot 5 | `pureflow-screenshot-5-how-to-use-1280x800.png` | 1280 x 800 |
| Small promo tile | `pureflow-small-promo-tile-440x280.png` | 440 x 280 |
| Marquee promo tile | `pureflow-marquee-promo-tile-1400x560.png` | 1400 x 560 |

Upload the screenshots in this order (1 to 5). The first one is what people see first.

**Additional fields**
- Official URL: leave empty, or your site (dineshshinde.com) if it is verified in Search Console
- Homepage URL: link to your `how-to-use.html` page once it is online (optional)
- Support URL: your email or GitHub issues page

---

## 2. Privacy practices tab

These answers go only to Google's reviewers, not the public page. They must name the site
PureFlow runs on, so the domain `youtube.com` appears here. Leave it, it is required to be accurate.

**Single purpose**
```
PureFlow improves watching videos on youtube.com by removing ads and distractions (Shorts, comments, recommendations, end-of-video suggestions) and giving simple playback controls (speed, optional sponsor skip).
```

**Permission justifications**
| Permission | Paste this |
|---|---|
| declarativeNetRequest | Blocks requests to known ad servers on youtube.com using Chrome's built-in rule engine. Also lets ads through on channels the user chooses to support. |
| scripting | Starts PureFlow in youtube.com tabs that were already open when the extension was installed, updated or switched on, so the user doesn't have to reload them. |
| storage | Saves the user's settings (on/off, focus mode, speed) and local stats (ads blocked, time saved). |
| Host permission (www.youtube.com, m.youtube.com) | PureFlow only works on youtube.com: it removes ads from the video player and hides page parts the user chose to hide. It runs on no other site. |

**Remote code:** No, I am not using remote code.

**Data usage:** tick only
- [x] Website content (only when the optional "Skip sponsor parts" setting is on: the first 4 characters of a SHA-256 hash of the video id are sent to SponsorBlock. Off by default.)

Leave everything else unticked. The optional first name never leaves the computer, so it is not "collected".

**Certify all three boxes** (not selling data, not using it for other purposes, not for credit/lending).

**Privacy policy URL:** the link where you put `store/privacy.html` online.

---

## 3. Distribution tab
- Visibility: Public
- Regions: All regions
- Price: Free
