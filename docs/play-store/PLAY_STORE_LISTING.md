# Capy Paint — Google Play Store Listing & Release Ops Guide

Complete store copy, form declarations, and asset checklist for publishing **Capy Paint** (`com.capyboop.paint`) to Google Play Console targeting `v3.1.3` (`versionCode = 30103`, dynamically sourced from [`web/package.json`](../../web/package.json)).

---

## 1. Store Listing Copy

- **App Name (`<= 30` chars)**: `Capy Paint - Color by Number` (`28` chars)
- **Short Description (`<= 80` chars)**: `Relaxing offline color-by-number puzzles, photo coloring & SVG printables.` (`74` chars)
- **Category**: `Puzzle`
- **Tags**: `Coloring`, `Puzzle`, `Casual`, `Offline`, `Single player`
- **Free / Paid & Ads**: `Free`, `Contains ads: No` (100% ad-free core app across Web and Android), `In-app purchases: No`
- **Full Description (`<= 4000` chars)**:

```text
Unwind with Capy Paint, a cozy, 100% ad-free color-by-number and free-coloring puzzle studio built for calm, creative play online or completely offline.

PICK & PAINT AT YOUR OWN PACE
- Start coloring right away with crisp, pre-generated built-in artworks including Capy Forest, Capybara, Mushroom Forest, and Snail Guitar.
- Play a fresh deterministic Puzzle of the Day offline every day featuring rotating built-in artworks and curated preset styles.
- Choose Auto-Select Color (Easy), Precise (Standard), or Free Color creative mode with custom HSL/Hex palettes and curated themes.

TURN ANY PHOTO INTO A PUZZLE OR PRINTABLE SHEET
- Import favorite family photos, pets, sketches, or landscapes straight from your Android Photo Picker. All color quantization and region segmentation runs 100% locally on your device.
- Zoom smoothly up to 12x to tackle tiny details using pinch-to-zoom or effortless one-finger double-tap-and-drag zoom.
- Dive into Infinite Zoom 2x Detail Tiles on intricate areas and return with a single tap via the Parent Puzzle breadcrumb.
- Export crisp black-and-white Printable Vector SVG coloring sheets for physical paper play.

THOUGHTFUL TOOLS & ACCESSIBILITY
- Drag effortlessly with Paint Mode to color connected areas in one sweep.
- Stuck on a tiny shape? Second-tap any active color swatch to highlight and center the next unfinished region.
- Built-in Undo/Redo and chronological YouTube-style timeline Replay (0.5x to 20x speed) with Follow Painting camera tracking.
- Accessibility options including Large Text & Buttons, independent Text Size (85% to 150%) and UI Size (85% to 140%) sliders, Fat-Finger Tap Assist with adjustable reach, Reduced Motion, customizable highlight styles, and optional tactile audio + hardware haptics.

PRIVATE, COMPACT & OFFLINE-FIRST
- No forced accounts, zero behavioral tracking SDKs, and zero third-party ads.
- Your saves, thumbnails, and custom photo puzzles live safely on your device with portable .capy archive exports, built-in Browser Storage cleanup, and Share Progress links.
```

---

## 2. Graphic Assets & Form Factor Checklist

All ready-to-upload PNG assets live in [`docs/play-store/`](./):

- **App Icon (`512x512` PNG)**: [`docs/play-store/app_icon_512.png`](./app_icon_512.png)
- **Feature Graphic (`1024x500` PNG)**: [`docs/play-store/feature_graphic.png`](./feature_graphic.png)
- **Phone Screenshots (`1080x1920`, `9:16`)**:
  - [`docs/play-store/screenshots/phone_1_coloring.png`](./screenshots/phone_1_coloring.png) — Active coloring canvas & centered Palette Dock
  - [`docs/play-store/screenshots/phone_2_zoom_hint.png`](./screenshots/phone_2_zoom_hint.png) — Precision zoom & smart numbered shape highlighting
  - [`docs/play-store/screenshots/phone_3_gallery_daily.png`](./screenshots/phone_3_gallery_daily.png) — Create tab featuring Puzzle of the Day & gallery
  - [`docs/play-store/screenshots/phone_4_saves_clean.png`](./screenshots/phone_4_saves_clean.png) — Clean Saves library with Thumbnails, Share Progress Link & Printable SVG
- **Tablet Screenshots (`1920x1200`, `16:10`)**:
  - [`docs/play-store/screenshots/tablet_1_canvas.png`](./screenshots/tablet_1_canvas.png) — Wide tablet canvas gameplay
  - [`docs/play-store/screenshots/tablet_2_create_gallery.png`](./screenshots/tablet_2_create_gallery.png) — Tablet Create gallery & Puzzle of the Day

> [!IMPORTANT]
> **Target Form Factors (Do Not Opt Into Android TV Yet)**: Upload Phone and Tablet builds/screenshots **only**. Keep the Android TV form factor unchecked in Google Play Console Release > Setup > Form Factors until full `1920x1080` TV D-pad cursor/reticle navigation and living-room Co-op ship in a follow-up post-Play-Store launch release.

---

## 3. Data Safety, Privacy & Content Rating Answers

- **Privacy Policy URL**: [https://capypaint.com/privacy-policy.html](https://capypaint.com/privacy-policy.html) (backed by [`web/public/privacy-policy.html`](../../web/public/privacy-policy.html); also served via [https://paint.capyboop.com/privacy-policy.html](https://paint.capyboop.com/privacy-policy.html) and fallback GitHub Pages URL: [https://shthed.github.io/capy/privacy-policy.html](https://shthed.github.io/capy/privacy-policy.html))
- **Developer Contact Email (Store Settings)**: Set [capyboop@gmail.com](mailto:capyboop@gmail.com) (matching [`SECURITY.md`](../../SECURITY.md)) under Play Console **Store settings -> Store listing contact details** before submitting for review.
- **App Access**: All core gameplay, custom photo puzzles, built-in artworks, the daily Puzzle of the Day, saves, SVG exports, and replay features work immediately with zero login required (`All functionality is available without special access`).
- **Advertising**: `No, my app does not contain ads.`
- **Data Safety (`v3.1.3`)**:
  - Core gameplay, photo segmentation, and saves are 100% local-first on-device with zero advertising, analytics, or behavioral tracking SDKs bundled, and startup Play Games sign-in remains disabled ([`MainActivity.kt`](../../app/src/main/java/com/capyboop/paint/MainActivity.kt) never invokes `requestPlayGamesSignIn()` on launch, [`AndroidManifest.xml`](../../app/src/main/AndroidManifest.xml) sets `SUPPRESS_GAME_PROFILE_CREATION="true"`, and `CAPY_PLAY_GAMES_APP_ID` stays unset for initial launch).
  - **Optional Anonymous In-Game Feedback (`About -> Send Feedback`)**: Voluntary, user-initiated text submissions are sent over encrypted HTTPS to the Capy Paint feedback relay along with app version and platform only (no account, email, or personal identity required) to open an anonymous issue on `capyboop/paint`. In Play Console Data Safety, disclose this optional, ephemeral/user-initiated text submission (not linked to user identity, encrypted in transit, not shared with third-party ad/analytics networks) so Play Console answers stay 100% aligned with [`web/public/privacy-policy.html`](../../web/public/privacy-policy.html).
  - **Optional BYOC Cloud Sync**: Cloud/Co-op UI remains feature-gated off by default in `v3.1.3`. Once opt-in Bring-Your-Own-Cloud providers (Google Drive `appDataFolder`, Microsoft OneDrive, Apple CloudKit, or Google Play Games Services v2) are enabled by default for end users, update Data Safety to include opt-in cloud save sync.
- **IARC Content Rating Questionnaire**:
  - Category: `Games` (`Reference, News, or Educational` = No; `Game` = Yes).
  - Violence / Fear / Sexuality / Gambling / Substances / Profanity: `No` across all prompts (`Everyone` / `PEGI 3` / `USK 0`).
  - User-generated content sharing / Location / Ads / Purchases: `No` (all photos remain local on-device `.capy` puzzles).
- **Target Audience**: Ages `13+` / General Audience (safe for families; avoid selecting "Primarily directed to children" unless completing Family Policy review).

---

## 4. Play Console Release Steps (Human Ops)

1. Verify GitHub Actions signing secrets on the source repository (`CAPY_KEYSTORE_BASE64`, `CAPY_KEYSTORE_PASSWORD`, `CAPY_KEY_ALIAS`, `CAPY_KEY_PASSWORD`) per [`.github/workflows/release.yml`](../../.github/workflows/release.yml), keeping `CAPY_PLAY_GAMES_APP_ID` unset for the initial Phone & Tablet launch.
2. Create and push tag `v<version>` matching [`web/package.json`](../../web/package.json) (currently `v3.1.3`, `versionCode = 30103`) from updated `main` (`git tag -a v3.1.3 -m "v3.1.3" && git push origin v3.1.3`) to build the signed Play Store `capy-v3.1.3.aab` artifact cleanly.
3. In Google Play Console (`com.capyboop.paint`):
   - Configure **Developer contact email** ([capyboop@gmail.com](mailto:capyboop@gmail.com)) and website ([capypaint.com](https://capypaint.com/) or [paint.capyboop.com](https://paint.capyboop.com/)) under **Store settings -> Store listing contact details**.
   - Upload `app_icon_512.png`, `feature_graphic.png`, and the `screenshots/` PNGs under **Main store listing** (Phone and Tablet tabs only; skip TV/Wear).
   - Complete **App content** (Privacy Policy URL, Ads = No, App Access = No restrictions, Content Rating = Everyone, Data Safety aligned with [`web/public/privacy-policy.html`](../../web/public/privacy-policy.html) for local-first storage + optional anonymous `Send Feedback`).
   - Create an **Internal testing** (or **Closed testing**) release, upload `capy-v3.1.3.aab` (`versionCode = 30103`), verify zero pre-launch manifest warnings, and roll out to testers / Production.
