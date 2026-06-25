# Verify director

**Stage goal:** prove the game is production-shippable — clean static pass **and**
a clean run in a REAL browser. A game that passes static checks but shows a black
screen, throws in the console, 404s an asset, or soft-locks is NOT done. This stage
is the gate that stops buggy/garbage games reaching the user.

**Produces:** `verify_report` (static result + browser QA result + the two screenshots).

## Process

### 1. Static pass
Run the full static verifier from the project root:
```
python .agents/tools/verify-game.py
```
It checks JS syntax, JSON validity, OGF level schema, asset-path resolution, and
`index.html` references (`conventions/verification.md`). Fix every reported error and
re-run until exit 0. Common misses: a `data/*.json` referencing a sprite that wasn't
fetched/generated; an array entry missing its `id`; a level missing top-level `mapSize`.

### 2. Real-browser QA gate (MANDATORY — this is what static checks can't see)
Run the headless real-browser gate from the project root:
```
node .agents/tools/qa-browser.mjs . --play-ms 3500
```
It launches the game in a real headless Chrome and asserts:
- **zero** console errors, uncaught exceptions, and missing/404 assets (favicon ignored),
- the canvas actually **renders content** at title AND during play (not a black/blank void),
- the **title → play** transition fires on the Start input (Enter / Space / click),
- the **frame loop stays alive** after input (`state.time` advances → no soft-lock/freeze),
- no on-canvas **error overlay** (`state.error` stays null).

It writes `./.ogf-qa/title.png` and `./.ogf-qa/gameplay.png` — **look at both**. The pixel
check proves "something rendered," not "it looks right": open the screenshots and confirm
the game actually reads as the intended scene (player/enemies/HUD visible, not one lone rect
in a void). If a screenshot looks wrong, treat it as a failure even if the gate exited 0.

Fix every blocker and re-run until exit 0 **and** both screenshots look correct. Typical
fixes: a `data/*.json` pointing at an asset path that doesn't exist on disk (drop the path or
generate the art); a render function reading a field the seed never set; a scene/start-mode
mismatch; a tower/card click region that never resolves.

> Setup: the gate uses `playwright-core` + the system Chrome (no browser download). If it
> reports "no Chrome found," set `OGF_CHROME=/path/to/chrome`. If `playwright-core` is missing,
> `npm i -D playwright-core` in the daemon workspace.

### 3. Asset ledger
Confirm every asset in `data/asset-credits.json` still exists on disk.

Auto-advance; checkpoint with the report (include both screenshot paths).

## Done when

`verify-game.py` exits 0, `qa-browser.mjs` exits 0, both screenshots look correct, and asset
paths resolve. `pipeline.py done verify`.
