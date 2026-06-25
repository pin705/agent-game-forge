# Convention — i18n + mobile-first + asset fallback (MANDATORY)

Every game the studio produces MUST ship localized, playable on a phone, and
never break on a missing asset. These are not optional polish — they are
acceptance criteria the `verify` stage (browser QA gate) and reviewers enforce.
The foundation seeds already implement all three; copy their pattern.

## 1. Localization (i18n) — default to the player's language

**Rule: never hardcode a user-facing string.** All display text comes from
`data/strings.json` via `t("id")`. The active locale DEFAULTS to the player's
browser language (`navigator.language`) — a Vietnamese player gets Vietnamese
automatically. English is the fallback, not the default-for-everyone.

- Ship `src/i18n.js` (the loader; identical across seeds) and load it before
  render/hud in `index.html`.
- Ship `data/strings.json`: `{ "en": { "id": "..." }, "vi": { "id": "..." }, ... }`.
  Provide **at least `en` + `vi`**; add more locales by adding a key with the
  same ids. Use `{placeholder}` for interpolated values: `t("result",{k:kills,s:score})`.
- In `boot()`: `await loadStrings();` before the first frame.
- Replace every literal in render/hud/menus with `t(...)`. Content catalogs
  (card text, dialogue) localize too when the game is text-heavy — put locale
  variants in the catalog or a strings id.
- Overrides for testing/sharing: `?lang=vi` in the URL, and the choice persists
  (`localStorage`). `setLocale("vi")` switches at runtime.
- **The studio UI (apps/studio) follows the same rule** — its React surface must
  offer EN/VI and default from the user's locale; don't ship an English-only app
  to Vietnamese users.

## 2. Mobile-first — it must be playable on a phone, not just scaled

Rendering-scales-down is NOT enough; the player must be able to *control* the game by touch.

- `index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1" />`.
- `styles.css`: body `min-height:100dvh`; main `max-height:100dvh`; canvas
  `touch-action:none; user-select:none; -webkit-tap-highlight-color:transparent;`
  (so dragging/tapping never scrolls or zooms the page).
- **Movement genres** (platformer, arena, shmup, top-down, grid step): ship
  `src/mobile.js` (the floating virtual joystick) — it feeds the SAME action
  system as keys (merged in `updateInput()`), so gameplay code is unchanged.
  Call `initMobile()` in `boot()` and `drawMobileControls(ctx)` at end of the frame.
  Right-half tap is the universal action (start/confirm/jump/attack).
- **Tap/click genres** (tower-defense, card-battler, clicker, visual-novel): do
  NOT add the joystick (it would hijack taps on build-spots/cards). The canvas
  `click`/`pointer` handlers already fire on touch — just add the touch-action CSS
  and make sure tap targets are ≥ ~44px.
- Provide keyboard AND touch for everything; never ship a game only one can play.

## 3. Asset fallback — a missing image must never crash or blank the screen

The seeds are **asset-free by default** (they render clean shapes) and only show
real art once the `assets` stage fetches/generates it. That means:

- Every sprite/image draw MUST tolerate a missing/not-yet-loaded asset by drawing
  a polished fallback shape (see `draw.js`: `softShape`/`glowDot`) — never throw,
  never leave a blank rect. The image loader resolves missing art to `null` and
  the renderer branches to the shape path.
- A `data/*.json` must never reference an asset path that isn't on disk — that
  produces a 404 the browser QA gate FAILS on. Either ship the asset or leave the
  `sprite` field empty until the `assets` stage fills it (see `player-config.json`
  in the side-scroll seed for the asset-free-by-default pattern).
- The `assets` stage (`pipelines/stages/assets-director.md`) is where real art
  arrives: **fetch CC0 first** (`fetch-asset.py`, free, works offline-ish via
  OpenGameArt), then `gen-image.py` for bespoke art (needs a daemon image-gen API
  key in Settings). If no key and no fitting CC0, the game still ships and plays
  on the polished fallback shapes — degraded look, never broken.

## Acceptance (enforced by the browser QA gate)

`node .agents/tools/qa-browser.mjs . --play-ms 3500` must pass: no console errors,
**no 404 assets**, canvas renders content, title→play works, loop alive. Plus:
load with `?lang=vi` and confirm Vietnamese renders; resize to a phone viewport
(e.g. 390×844) and confirm the game is controllable by touch.
