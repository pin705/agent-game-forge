# Grid-Logic Foundation Seed — Crate Logic (Sokoban)

Crate Logic is the studio's known-good, asset-free starting point for grid-logic (`grid_subtype: puzzle`) games: a complete, runnable Sokoban drawn entirely with Canvas2D primitives (zero images, zero external files). It boots title → play, loads a discrete cell grid from `data/<level>.json` (walls, floor, goals, boxes, player spawn), moves the player one cell per arrow/WASD press with a juice-tweened visual slide, pushes a box into open floor (blocking against walls and other boxes, single-push Sokoban rule), highlights boxes that sit on a goal, supports `Z` undo (full grid+entity snapshot stack) and `R` reset, and wins when every box covers a goal — firing a screenshake + flash + "SOLVED" floater before advancing to the next level or the "ALL SOLVED" screen. The `juice.js` core is copied verbatim from the side-scroll seed and wired into the frame loop (`updateJuice`/`drawJuice`), with the same `try/catch` + `drawErrorOverlay` + window `error`/`unhandledrejection` debug protocol.

**Controls**
- Arrow keys / WASD — move the player one cell (pushes a crate ahead of you)
- Z (or Backspace) — undo the last move
- R — reset the current level
- Enter / Space — start from the title; (on completion) restart

**Extend**
- New levels: add a `data/<id>.json` (grid + entities + `win`) and register the id in `data/levels.json`.
- Cell types: `0` empty, `1` wall, `2` floor, `3` goal, `4` hazard, `5` spawn (see `src/constants.js`).
- Movement/push rules live in `src/movement.js`; the turn pipeline + win check in `src/turn.js`; undo in `src/undo.js`.
- All rendering is primitive-based in `src/render.js` / `src/hud.js` — swap colors in `COLORS` (constants.js).
