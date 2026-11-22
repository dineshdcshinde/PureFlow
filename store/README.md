# How to publish PureFlow on the Chrome Web Store

Everything Google asks for is in this folder:

| File | What it is |
|---|---|
| `pureflow-chrome-<version>.zip` | The file you upload |
| `LISTING.md` | All the text to copy into the dashboard, field by field |
| `privacy.html` | Privacy policy (put it online, paste the link) |
| `how-to-use.html` | Simple guide for users (optional homepage link) |
| `images/` | Store icon, 5 screenshots, small and marquee promo tiles, all at the right sizes |

## 1. Put the two pages online (5 min, free)
1. In `privacy.html` and `how-to-use.html`, replace `YOUR-SUPPORT-EMAIL` with your real email.
2. Go to https://app.netlify.com/drop and drag both files in together (or put them on dineshshinde.com/pureflow/).
3. Copy the links.

## 2. Developer account (one time)
1. Open https://chrome.google.com/webstore/devconsole and sign in.
2. Accept the developer agreement and pay the one-time registration fee.
3. Account tab: add and verify your contact email. Choose "Non-trader" if asked.

## 3. Upload and submit
1. **New item**, upload the zip.
2. Fill **Store listing**, **Privacy practices** and **Distribution** from `LISTING.md`.
3. Add the images from `images/` (table in `LISTING.md` shows which goes where).
4. **Submit for review**. The first review usually takes a few days.

## Every update after that
Bump `version` in `brand.json`, run `npm run build:chrome`, zip `dist/chrome`, upload, submit.
