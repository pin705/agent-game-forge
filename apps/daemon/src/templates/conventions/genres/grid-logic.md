# Genre — Grid-logic (discrete-grid games)

Games played on a discrete 2D grid where everything snaps to whole cells — no sub-cell positions, no physics engine, no gravity. The world is a 2D integer array of cell types plus a list of grid-bound entities. Player input advances the game by discrete **steps** or **turns**, the board resolves, animations play, then win/lose is checked.

This genre covers five sub-types that share one engine and differ only in their **turn model** and **input**:

| `spec.grid_subtype` | Turn model | Input | Examples |
|---|---|---|---|
| `puzzle` | **step** — one input = one game step | Arrows / WASD | Sokoban, sliding puzzle, Baba Is You |
| `tactics` | **turn** — select unit, act, end turn | Click select + move | Fire Emblem, Into the Breach, chess |
| `match` | **freeform** — process input immediately, cascade | Click / swap cells | Bejeweled, Candy Crush |
| `arcade` | **realtime** — a timer auto-steps the board | Arrows (buffered) | Snake, Pac-Man, Tetris |
| `roguelike` | **step** — like puzzle, plus enemy AI + combat | Arrows + Space | Mystery Dungeon, Shiren |

Default: `puzzle` (step mode). **Roguelike is puzzle + enemy AI + HP**, so build it on the puzzle base and add the combat layer. Pick the sub-type FIRST — it decides the turn loop (`recipes/grid-logic/turn-loop.md`) and the input mapping below; everything else is shared.

> ⚠️ **OGF projects do NOT use a game framework** — vanilla JS + HTML5 Canvas reading `data/*.json`. The OpenGame `grid_logic` module this genre is ported from is Phaser/TypeScript; the patterns below are the chassis-correct vanilla-canvas translation. There is NO `BoardManager` class, NO `Phaser.Events.EventEmitter`, NO tween system. State lives in the shared global `state` object (per `common.md` §"Module architecture"); animations are plain time-lerps in the render loop. See `runtime-patterns.md` for the Phaser → vanilla translation table.
>
> ⚠️ **OGF Scene editor support for grid-logic is LIMITED**: the grid itself is a code-rendered overlay on a background image — it is NOT a drag-editable tilemap. Entities are placement objects (drag-editable position). The cell grid + win/lose logic are edited via JSON / chat, not on the canvas. See "Scene editor support" below — be honest about this in spec planning.

This file assumes you've read `common.md` (canonical shapes, `id` on every array entry, module architecture, config-vs-identity split) and `game-design.md`.

## Why a code-defined grid (NOT a tilemap, NOT generate2dmap tiles)

The single most important architectural decision in this genre: **the grid is data in `data/<level>.json`, the single source of truth, mutated at runtime.** Cells change during play — a hole fills when a box drops in, a door opens, an item is collected, ice melts. A tilemap (or a `generate2dmap` tile layer) would be a SECOND copy of that data and the two would drift out of sync. So:

- The **visual** layer is ONE background image (`type: background`, top-down) the runtime draws under the grid, plus optional per-cell-type sprites (goal, hazard, ice, portal) the code stamps at grid positions.
- The **logic** layer is the `grid` int array + `entities[]` in `data/<level>.json`, loaded into `state` and mutated in place.
- Do NOT call `generate2dmap` for the playfield. Generate the background and the entity/cell sprites only.

This mirrors how `tower-defense.md` and `shmup.md` treat their code-defined grids — background image + code overlay, never a Tiled/LDtk import.

## Level data schema — `data/<level>.json`

A grid-logic level is a 2D int grid + a cell-type legend + an `entities[]` list. Top-level `mapSize` is REQUIRED (so the Scene editor can open the file at all — see `common.md` §"Background dimensions" case A).

```json
{
  "id": "level_1",
  "grid_subtype": "puzzle",
  "cols": 8,
  "rows": 8,
  "cellSize": 64,
  "mapSize": { "width": 512, "height": 512 },
  "background": { "image": "assets/maps/level_1/base.png" },

  "grid": [
    [1,1,1,1,1,1,1,1],
    [1,5,2,2,2,2,2,1],
    [1,2,1,2,1,2,2,1],
    [1,2,2,2,2,2,2,1],
    [1,2,1,2,1,2,2,1],
    [1,2,2,2,2,2,3,1],
    [1,2,2,7,7,2,3,1],
    [1,1,1,1,1,1,1,1]
  ],

  "cellLegend": {
    "0": "empty", "1": "wall", "2": "floor", "3": "goal",
    "4": "hazard", "5": "spawn", "6": "special", "7": "ice", "8": "portal"
  },

  "entities": [
    { "id": "player_1", "type": "player", "gridX": 1, "gridY": 1,
      "sprite": "assets/sprites/player/sheet.png",
      "isWalkable": false, "isPushable": false, "isDestructible": false, "sizeFactor": 0.8 },

    { "id": "box_1", "type": "box", "gridX": 3, "gridY": 3,
      "sprite": "assets/sprites/box/box.png",
      "isWalkable": false, "isPushable": true, "isDestructible": false, "sizeFactor": 0.85 },
    { "id": "box_2", "type": "box", "gridX": 5, "gridY": 4,
      "sprite": "assets/sprites/box/box.png",
      "isWalkable": false, "isPushable": true, "isDestructible": false, "sizeFactor": 0.85 },

    { "id": "portal_a1", "type": "portal", "gridX": 3, "gridY": 6, "portalPairId": "A",
      "sprite": "assets/sprites/cell_portal/portal.png",
      "isWalkable": true, "isPushable": false, "isDestructible": false },
    { "id": "portal_a2", "type": "portal", "gridX": 6, "gridY": 1, "portalPairId": "A",
      "sprite": "assets/sprites/cell_portal/portal.png",
      "isWalkable": true, "isPushable": false, "isDestructible": false }
  ],

  "win":  { "kind": "boxes_on_goals" },
  "lose": { "kind": "moves_exceeded", "maxMoves": 60 }
}
```

### The `grid` array

- A `rows × cols` array of integers. **Row-major**: `grid[y][x]` (y = row from top, x = column from left). This is the order the OpenGame source uses (`cells[y][x]`) — keep it, or every coordinate helper inverts.
- Each int is a **cell type** resolved through `cellLegend`. Authoring tip: write levels as ASCII first (see "Cell types" table), then transcribe to ints.
- The border row/column should be `1` (wall) for `puzzle` / `tactics` / `roguelike` so nothing walks off the edge. `arcade` (Snake/Pac-Man) may wrap or use walls per design.
- The grid is the SOURCE OF TRUTH and is mutated in place: `state.level.grid[y][x] = FLOOR` when a hole fills. Snapshot it for undo (see `recipes/grid-logic/undo-stack.md`).

### `cellLegend`

Maps the int values in `grid` to names. Keep the canonical numbering below so recipes and any shared helper agree. Including it in the file (rather than hardcoding in JS) lets the Scene editor and the user read the level without the source.

### `entities[]` — REQUIRED `id` on every entry

Per `common.md` §"JSON entry contract", **every** entity needs a unique `id` — the Scene editor addresses entities by `id` for every move/delete. Each entity carries:

| Field | Meaning |
|---|---|
| `id` | Unique key (REQUIRED). `<type>_<n>` or semantic. |
| `type` | Type string for queries (`player`, `box`, `enemy`, `key`, `goal`, `bomb`, `portal`). |
| `gridX`, `gridY` | Integer cell coordinates (NOT pixels — pixels are derived via `gridToWorld`). |
| `sprite` | Asset path. Multi-action entities (enemies with idle/attack) use the `animations: {}` object instead — see `common.md` §"Multi-action entity". |
| `isWalkable` | Can others occupy/pass this cell? `true` for items, goals, portals. |
| `isPushable` | Can this be pushed by the player? `true` for boxes/crates. |
| `isDestructible` | Can this be destroyed? `true` for enemies, breakable blocks, items. |
| `hp`, `maxHp` | OPTIONAL. Omit (or `0`) = no combat. `maxHp > 0` enables the HP/bump-attack system (roguelike/tactics). |
| `sizeFactor` | OPTIONAL fraction of a cell the sprite fills (0–1). Player ~0.8, crate ~0.85, enemy ~0.75, item ~0.5. Default 0.85. |
| `facing` | OPTIONAL `"up"|"down"|"left"|"right"` for directional attacks / sprite orientation. |
| `portalPairId` | OPTIONAL shared id linking two `portal` entities (see ICE/PORTAL recipe). |

A cell can hold a terrain type AND an entity at the same coordinate: a box on a floor cell is `grid[y][x] = 2` (floor) plus a `box` entity at that `gridX/gridY`. Terrain and entities are separate layers.

## Cell types (canonical legend)

Keep these int values stable across every level and recipe (ported verbatim from the OpenGame `grid_logic` `CellType` enum so the ICE/PORTAL recipe and any shared helper line up):

| Int | Name | ASCII | Meaning |
|---|---|---|---|
| 0 | `empty` | `.` | Void / out of bounds (not walkable, not drawn). |
| 1 | `wall` | `#` | Impassable barrier. Blocks movement + pushes. |
| 2 | `floor` | `_` | Walkable ground. |
| 3 | `goal` | `G` | Target cell (box destination, exit, capture point). |
| 4 | `hazard` | `!` | Dangerous cell — damages/kills an entity that enters (traps, lava, water). |
| 5 | `spawn` | `S` | Player start cell (exactly one per level). |
| 6 | `special` | `*` | Game-specific (pressure plate, switch, tall grass for stealth). Meaning defined per level. |
| 7 | `ice` | `~` | Slippery — an entity entering slides in its travel direction until blocked (see ICE recipe). |
| 8 | `portal` | `O` | Teleport pad — paired with another portal by `portalPairId` (see PORTAL recipe). |

**Authoring rules** (from OpenGame's grid GDD section):
- Size: 6–16 cols × 6–16 rows for puzzle; up to ~20×20 for tactics.
- Exactly one `spawn` (5). Every `goal` (3) must be reachable from spawn. **Every puzzle MUST be solvable** — trace a solution before committing the level.
- `hazard` (4) cells need clear visual + audio feedback on entry.
- Cell types can change at runtime: `state.level.grid[y][x] = FLOOR`. The board is mutable; that's the whole reason it isn't a tilemap.

## Turn model — player phase → world phase → enemy phase → win/lose check

The core loop is a **3-phase pipeline** that runs once per player action (ported from OpenGame's `TurnManager` `WAITING → PROCESSING → ANIMATING → CHECKING` cycle, collapsed to vanilla). Input is LOCKED for the whole pipeline; it reopens only when the phase returns to waiting.

```
WAITING (accept input)
  → player acts (move / push / bump-attack / ability / swap)
  → PLAYER PHASE   : resolve the player's action, queue its animations
  → WORLD PHASE    : traps fire, tiles transform, items get collected, ice/portals resolve
  → ENEMY PHASE    : each enemy takes its AI step (roguelike/tactics); periodic emitters tick
  → CHECK WIN/LOSE : win? → win screen. lose? → lose screen. else:
  → (match only) CHAIN: if the board changed, re-run PROCESSING (cascades) until stable
  → back to WAITING
```

- **`puzzle` / `roguelike` / `arcade` (step/realtime)**: one input = one full pipeline pass, then `turnNumber++`. Realtime differs only in that a timer (`stepIntervalMs`) triggers the step instead of a keypress; buffer the player's last direction and apply it on the tick.
- **`tactics` (turn)**: the player may take multiple actions (move several units, or one unit move + attack) before **ending the turn**. Only on end-turn does the world + enemy phase run. Track `actionsThisTurn` vs `actionsPerTurn`, and offer an explicit "end turn" (Space / button).
- **`match` (freeform)**: no enemy phase. A swap → resolve matches → gravity → refill → **re-check for new matches** (the chain loop) until the board is stable, then accept the next input.

Pure puzzles (Sokoban, sliding) have **no enemy phase and no HP** — skip those branches entirely; the world phase just handles ice/portals/goal checks. See `recipes/grid-logic/turn-loop.md` for the full paste-ready pipeline + the per-sub-type variants.

### Win / lose conditions — exact boolean, data-driven

Win/lose are EXACT booleans declared per level and evaluated in the check phase. Express the common ones as data so the user can tweak without code:

| `win.kind` | True when | Sub-type |
|---|---|---|
| `boxes_on_goals` | every `box` entity sits on a `goal` cell | puzzle (Sokoban) |
| `reach_goal` | the `player` entity is on a `goal` cell | puzzle / roguelike |
| `all_enemies_defeated` | no `enemy` entities remain | tactics / roguelike |
| `score_target` | `state.score >= win.target` | match / arcade |
| `collect_all` | all `key`/`item` entities collected | puzzle / roguelike |

| `lose.kind` | True when | Sub-type |
|---|---|---|
| `moves_exceeded` | `state.moveCount > lose.maxMoves` | puzzle |
| `player_dead` | player `hp <= 0` | roguelike / tactics |
| `timer_expired` | `state.timeLeft <= 0` | arcade |
| `out_of_board` | snake/entity hits wall or self | arcade |

Anything more exotic (multi-condition, scripted) → write a `checkWin(state)` / `checkLose(state)` function and reference it; keep the simple cases in data.

## Input mapping (by sub-type)

Discrete only — no analog, no held-key acceleration. One press = one intent.

| Key | Action | Active in |
|---|---|---|
| Arrows / WASD | `onDirection(dir)` — move / push / bump-attack in that direction | puzzle, arcade, roguelike |
| Space | `onAction()` — ability, ranged attack, interact, **end turn** (tactics) | roguelike, tactics |
| Z | **Undo** last move (puzzle/tactics; see undo recipe) | puzzle, tactics, roguelike |
| Left click | `onCellClicked(gx, gy)` / `onEntityClicked(e)` — select / swap | tactics, match |
| Esc | Pause | all |

- **Input debounce**: discrete games feel mushy if a held arrow fires every frame. Debounce direction input (~120–150 ms) OR require key-up between steps. For `arcade`, buffer the last direction and consume it on the timer tick.
- **Input lock during the pipeline**: ignore all input while `state.turnPhase !== "waiting"`. The OpenGame source auto-locks during PROCESSING/ANIMATING/CHECKING — replicate with a single guard at the top of every input handler.

## Coordinate conversion — grid ↔ world

The grid is centered on the canvas via an offset (so a small board isn't jammed in the corner). Two helpers, used everywhere (ported from OpenGame `gridToWorld` / `worldToGrid`):

```js
// state.level has cols, rows, cellSize; offset centers the board in the viewport
function gridOffset(level) {
  return {
    x: Math.floor((VIEW.w - level.cols * level.cellSize) / 2),
    y: Math.floor((VIEW.h - level.rows * level.cellSize) / 2),
  };
}
function gridToWorld(level, gx, gy) {          // cell -> pixel center
  const o = gridOffset(level);
  return { x: o.x + gx * level.cellSize + level.cellSize / 2,
           y: o.y + gy * level.cellSize + level.cellSize / 2 };
}
function worldToGrid(level, wx, wy) {           // pixel (e.g. mouse) -> cell
  const o = gridOffset(level);
  return { gx: Math.floor((wx - o.x) / level.cellSize),
           gy: Math.floor((wy - o.y) / level.cellSize) };
}
function inBounds(level, gx, gy) {
  return gx >= 0 && gx < level.cols && gy >= 0 && gy < level.rows;
}
```

`worldToGrid` is how click-to-select (tactics/match) turns a mouse position into a cell. `gridToWorld` is how render + move-animations turn a cell into pixels.

## Movement animation — time-lerp, NOT instant snap

Logic is instant (entity's `gridX/gridY` change immediately when the move resolves), but the SPRITE slides over ~150–200 ms so the move reads. Vanilla replacement for OpenGame's tween-based `AnimationQueue`:

- On a resolved move, store `e.fromX/e.fromY` (old world pos), `e.animT = 0`, `e.animDur = cfg.animationSpeed`.
- In the update loop, advance `e.animT`; render at `lerp(from, to, easeOut(e.animT / e.animDur))`.
- **Keep the input lock until every queued animation finishes** — otherwise the next move starts mid-slide and positions desync. This is the vanilla equivalent of the AnimationQueue's "input auto-locked during the entire pipeline".
- Sequential vs parallel: chained pushes (player pushes box A into box B) animate **sequentially**; a gravity drop of many match-3 pieces animates **in parallel**. Model this as a small queue of `{ entities, dur, parallel }` steps, drained in the update loop.

## Scene editor support

Grid-logic is a **LIMITED** editor genre (same tier as top-down-rpg's tilemap). Be explicit with the user during spec planning:

- **Drag-editable**: the **position of entities** in `entities[]` (boxes, enemies, the player spawn marker, portals, items, goals-as-entities). These are placement objects with `gridX/gridY` — the editor snaps them to cells. **Limited**: the editor moves them in pixel space and you snap to the nearest cell; it does not understand grid semantics (won't stop you dropping a box on a wall — the runtime resolves that).
- **NOT drag-editable**: the `grid` int array itself. The grid is rendered by code as an overlay on the background image — the editor treats the playfield as one rendered image, exactly like top-down-rpg treats its tilemap. Editing terrain (adding a wall, moving a goal cell, painting ice) is done by editing `data/<level>.json` `grid` directly or by asking you in chat.
- **NOT editable on canvas**: win/lose conditions, turn config, entity stats (hp/damage), animation timing. Chat or JSON.

When the user expects to "paint the level" on the canvas, set expectations: they place ENTITIES on the canvas; they edit the TERRAIN GRID via chat/JSON. This is a real limitation of code-defined grids, not a bug — push back gracefully and offer to make grid edits for them.

## Recommended module split (grid-logic)

**Phase 0**: there is no grid-logic foundation seed yet, so build from scratch using `common.md` §"Module architecture (universal)" + the layout below. Every project gets the universal modules (constants/config/catalogs/dom/state/assets/audio/input/render/scene + thin game.js). Grid-logic adds these on top:

| Module | Responsibility | Approx LOC |
|---|---|---|
| `src/board.js` | The grid: `getCell/setCell`, `inBounds`, entity index (entity-at-cell lookup), `gridToWorld/worldToGrid`, `gridOffset`. The vanilla replacement for OpenGame's `BoardManager`. | 120-180 |
| `src/entities.js` | Entity create/place/move/remove, `entityAt(gx,gy)`, `entitiesOfType(type)`, flag queries (`isPushable`…), HP + `damageEntity` + death. | 120-200 |
| `src/turn.js` | The 3-phase pipeline (player→world→enemy→check), phase state, turn/move counters, per-sub-type mode (step/turn/realtime/freeform), input lock. Replaces `TurnManager`. | 120-220 |
| `src/movement.js` | `tryMove(dir)`: bounds + wall + push resolution, bump-to-attack, ICE slide, PORTAL teleport, goal/hazard entry. | 150-250 |
| `src/grid-render.js` | Draw background → grid lines (alpha ~0.12) → cell-type sprites (goal/hazard/ice/portal) → entities (with move-lerp) → selection/path overlays → HUD. | 150-250 |
| `src/anim.js` | Move/destroy/shake/pop lerps + the sequential/parallel animation queue drained each frame. Replaces `AnimationQueue`. | 80-150 |
| `src/undo.js` | Snapshot (grid + entities + custom state) before each move; `pushUndo`/`popUndo`; Z handler. (puzzle/tactics — skip for arcade/match) | 60-120 |
| `src/input.js` | Map arrows/WASD/Space/Z/click → `onDirection/onAction/onCell` with debounce + pipeline lock. (universal `input.js`, extended) | 60-120 |
| `src/ai.js` | Enemy `onStep` AI: chaser (BFS/A* toward player), patrol (reverse on wall), turret (fire every N turns). (roguelike/tactics only) | 100-200 |
| `src/win.js` | `checkWin(state)` / `checkLose(state)` evaluating the level's `win`/`lose` data + win/lose screen state. | 40-100 |

Total per-project: ~14–20 src files, ~1,200–2,200 LOC depending on sub-type (pure puzzle is lean; roguelike with AI + combat is the heavy end).

Genre-specific config files (TUNING):

| File | Holds |
|---|---|
| `data/grid-config.json` | `cellSize`, default `maxMoves`, `animationSpeed` (move-lerp ms), `inputDebounceMs`, `stepIntervalMs` (arcade), `actionsPerTurn` (tactics). |
| `data/combat-config.json` | Player attack damage, per-type enemy damage, cooldown turns, healing values. (roguelike/tactics) |
| `data/audio-config.json` | sfx tone freqs for move/push/collect/attack/match/win/lose/undo. |

Identity files (IDENTITY):

| File | Holds |
|---|---|
| `data/levels.json` | Level registry (ordered). |
| `data/<level_id>.json` | Per level: `grid`, `cellLegend`, `entities[]`, `win`, `lose`, `background`, `mapSize`. |
| `data/entities.json` | Catalog for MULTI-action / multi-instance entities (enemies with idle/attack, units). Single-instance props (a unique box sprite) can stay inline in the level. |
| `data/pieces.json` | (match only) The 5–7 match piece types: id, color, sprite. |

## Spec phase-plan expansion

> ⚠️ Recurring failure (per `common.md` §"Phase plan — split character + system phases"): the spec writer compresses the whole engine into "Phase 5: board + movement + push + undo + enemies + win/lose". That single phase is half the game — it blows the daemon stall watchdog, breaks the view_image reference chain across many gen calls, and is impossible to verify in one 30-second check. Grid-logic is especially prone to this because the board, the turn loop, movement, undo, and AI feel like "one system" but are five.

Expand the post-visuals work into **one concern per phase**, in dependency order. A puzzle (Sokoban) reference plan:

```
Phase 1: Visual anchor (top-down style anchor)
Phase 2: Level 1 background image (top-down board surface, ONE generated image)
Phase 3: Board + grid render (load grid from data/level_1.json, draw bg + grid lines + cell-type sprites, center via offset) — VERIFY: grid renders over the background, correct size
Phase 4: Player sprite + discrete movement (arrows move player cell-to-cell with the move-lerp; wall + bounds collision) — VERIFY: player walks the grid, can't pass walls
Phase 5: Box entities + push (player pushes a box one cell; chained-push blocked by wall/second box) — VERIFY: push works, box stops at walls
Phase 6: Turn pipeline + win condition (player→world→check; boxes_on_goals win screen) — VERIFY: covering all goals shows the win screen
Phase 7: Undo stack (Z snapshots + restores grid+entities; move counter decrements) — VERIFY: Z reverts the last push exactly
Phase 8: Special cells (ICE slide + PORTAL teleport in the world phase) — VERIFY: stepping on ice slides; portal teleports to its pair
Phase 9: HUD + lose (move counter, moves_exceeded lose screen, level-complete → next level) — VERIFY: HUD shows moves, exceeding limit loses
Phase 10: Audio + juice (move/push/collect/win/undo sfx, box-land pop, hazard shake)
```

Sub-type deltas (swap/add phases, keep one-concern-per-phase):

- **`roguelike`**: after Phase 5, ADD — *Enemy sprites* (1 phase) · *Enemy AI step in enemy phase* (chaser/patrol — 1 phase) · *HP + bump-to-attack* (1 phase) · *Death + player_dead lose* (1 phase). The enemy phase joins the turn pipeline in Phase 6.
- **`tactics`**: turn model is **turn** not step — ADD *unit selection (click) + move range highlight* (1 phase) · *end-turn + enemy turn* (1 phase) · *attack range + damage* (1 phase). Win = `all_enemies_defeated`.
- **`match`**: NO enemy phase, NO undo. Replace Phases 4–8 with *piece grid + swap* · *match detection (3+ in a row)* · *clear + gravity + refill* · *cascade/chain loop* · *score + score_target win*. Turn model is **freeform**.
- **`arcade`** (Snake/Tetris): turn model is **realtime** — ADD a `stepIntervalMs` timer that auto-steps; buffer the last direction. Replace undo (Phase 7) with *speed ramp + out_of_board lose*.

Per `common.md`, do NOT flatten to one mega-phase, and a phase title with 3+ "+" connectives is the smell that it's too big. When in doubt: split.

## Reference implementation + recipes

Source the gameplay knowledge from OpenGame's `grid_logic` module (`OpenGame/agent-test/templates/modules/grid_logic/` — `BoardManager.ts`, `TurnManager.ts`, `AnimationQueue.ts`) and its GDD section (`generate-gdd.ts`, the `grid_logic` branches). Those are Phaser/TS — translate to vanilla per the patterns above and the recipes below.

**Read these recipes at phase-execution time:**

| Implementing | Read recipe FIRST |
|---|---|
| `src/turn.js` (3-phase pipeline + win/lose, per sub-type) | `recipes/grid-logic/turn-loop.md` |
| `src/board.js` + `src/movement.js` (grid, discrete move, push, ICE, PORTAL, bump-attack) | `recipes/grid-logic/grid-and-movement.md` |
| `src/undo.js` (snapshot board+entities, Z to undo, custom-state list) | `recipes/grid-logic/undo-stack.md` |

Each recipe has a "When to use / When NOT to use" section — if your sub-type differs (match has no undo, arcade has no push), the recipe tells you to skip or fork.

## Reference repos to learn from

- [Sokoban (Wikipedia mechanics)](https://en.wikipedia.org/wiki/Sokoban) — the canonical push-to-goal rules (chained-push blocking, solvability).
- [Into the Breach](https://subsetgames.com/itb.html) — tactics on a small grid with perfect-information turns; the gold standard for "every move is legible".
- [Bejeweled / match-3 mechanics](https://en.wikipedia.org/wiki/Bejeweled) — match → gravity → refill → cascade loop.
- The OpenGame `grid_logic` module itself (`BoardManager` entity index + undo stack, `TurnManager` phase machine, `AnimationQueue` sequential/parallel) — read for the WHAT; write vanilla.
