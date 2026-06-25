# Tower-defense foundation seed — Guandu Pass

A complete, runnable, **asset-free** vanilla-Canvas tower-defense seed: title → play, a fixed polyline path across a grid, enemies spawning in timed waves, click-to-place auto-targeting towers that fire pooled projectiles, gold/lives economy, and the mandatory juice layer (`juice.js` + `particles.js`) wired into every hit/death/place/leak. Everything draws with Canvas2D primitives (no Image, no external files) and the whole thing is data-driven from `data/td-config.json` (path waypoints, grid, starting gold/lives, tower stats, wave script). Win by surviving all 5 waves; lose if lives hit 0. Modules mirror the side-scroll seed idioms (global-script style, `frame()` try/catch + `drawErrorOverlay` + window error handlers, hit-stop dt gate).

## Controls (mouse + keyboard)
- **Click** a grass cell to place the selected tower (rejected if too close to the path, occupied, or you can't afford it).
- **Click** a tower button (bottom bar) or press **1 / 2 / 3** to choose Arrow / Cannon / Frost.
- **N** sends the next wave early during the rest pause.
- **Enter / Space / click** starts the game from the title and restarts after win/defeat.
