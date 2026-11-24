# PureFlow: Launch and V2 Plan

Status: V1 done (tag v1.0.0). Version 2.0.0 built: everything from V2 and V3 below, plus "Play next video right away" (fixes the black screen between videos).
The code is now one shared engine (src/) with per-browser setups (platforms/) for Chrome, Edge and Firefox.

---

## 1. Legal and Chrome Web Store check

I'm not a lawyer. This is what the public rules say (checked Nov 2026).

### Is ad blocking legal?
- YouTube says blocking its ads breaks **YouTube's Terms of Service**. That is a rule between YouTube and its users, not a law.
- What YouTube does in practice: warning popups and blocked playback for users. Not legal cases against users.
- Ad blocking is legal in most places.

### Does the Chrome Web Store allow it?
Yes. Many YouTube ad blockers are listed, including "AdBlock on YouTube™" by AdBlock.

### Rules we must follow
| Rule | What we do |
|---|---|
| No impersonation: don't look made by or approved by YouTube/Google | Our own name + "for YouTube™" + disclaimer: "Not affiliated with YouTube. YouTube is a trademark of Google LLC." |
| User data: no collecting browsing activity unless a feature needs it | We collect nothing. Say so in the privacy form. Keep stats on the user's computer only |
| Must add value / be unique | V2 features below |
| No misleading claims ("Editor's Choice", "Number One") | Keep the listing honest |
| Test before submitting, give real support contact | Run tests, add a support email |

### Real risks
- YouTube changes its code often, so we must ship fixes quickly.
- Google owns YouTube and the store, so rules could get stricter later.

---

## 2. How we stand out

Enhancer for YouTube™ (1M+ users) does everything: speed, volume, screenshots, shortcuts, playlists.
Big ad blockers get complaints about slow YouTube and high memory use.

**Our angle: the lightest way to watch YouTube without ads and distractions.**
Fast, private (zero data collected), clean.

---

## 3. Launch checklist (V1)

- [x] Name: PureFlow. Store title: "PureFlow - Ad Blocker for YouTube™"
- [x] Renamed everywhere (brand.json)
- [x] Icons: 16, 32, 48, 128 px
- [ ] Set `DEBUG = false` in inject.js and content/main.js
- [ ] Zip the extension WITHOUT the `tests` folder
- [ ] Store listing: short description, long description, 3 to 5 screenshots, disclaimer line
- [ ] Privacy: "collects no data", explain `scripting` and youtube.com access
- [ ] Support email
- [ ] Submit, then watch reviews for the first 2 weeks

---

## 4. V2 features (in this order)

| # | Feature | Why | Notes |
|---|---|---|---|
| 1 | **Popup**: on/off switch + stats ("ads blocked", "time saved") | People love seeing proof it works | Stats stored only on the user's computer |
| 2 | **Support creators**: allow ads on chosen channels | Fair, builds trust and good reviews | Toggle on the channel page |
| 3 | **Focus mode**: hide Shorts, recommendations, comments, end screens | Big demand | Each item its own toggle |
| 4 | **Sponsor skip**: skip "sponsored by" parts inside videos | Very loved feature | Uses SponsorBlock public data. Must be opt-in and listed in the privacy policy |
| 5 | **Default speed** + **default quality** + **mouse wheel volume** (all done in 2.0.0) | Most used Enhancer features | Quality and volume go through bridge.js (page world) |

## 5. V3 (done in 2.0.0)
- [x] Screenshot a video frame (player button + Shift+S)
- [x] Keyboard shortcuts (Shift+S, Shift+L)
- [x] Loop part of a video (player button + Shift+L)

## 5b. Fix in 2.0.0: black screen between videos
Measured on real YouTube: after a video ends, YouTube waits 3 to 9 s on "Up next in 8" over a black player; the next video then loads in about 0.3 to 1 s. PureFlow added no measurable delay. Fix: when Autoplay is on, press "Play now" at once (content/features/autonext.js). Next video now plays about 1 s after the end.

## 6. Name ideas (checked Nov 2026)

Store title format: `<Name> – Ad Skipper for YouTube™` + disclaimer in the description.

| Name | Status |
|---|---|
| SkipLane | Rejected: user found an existing "SkipLane" on Chrome |
| **BreezeTube** | No extension found |
| **StraightPlay** | No extension found |
| **Skipwise** | No extension found (a gift app "Skipwish" exists, different field) |
| **PlayPure** | No extension found (an audio app "PurePlay" exists) |
| QuietPlay | Rejected: QuietTube and QuietWeb already exist |
| AdHush | Rejected: already exists (ad-muting tool) |
| NoBreak | Rejected: too close to many "No Ads" / "Nonstop" extensions |

Before deciding: search the name yourself on chromewebstore.google.com, and check the domain.

## 7. Rules for building
- Keep it light: no timers running when nothing is happening
- One file, one job (same structure as V1)
- Every new feature gets a test in `tests/test.js`
- Launch first, then build V2 based on what reviews ask for
