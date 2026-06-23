# Recipe — Code-defined grid + discrete movement (push, ICE, PORTAL, bump-attack)

The board and the move resolver: a 2D int grid loaded from `data/<level>.json` (the single source of truth, mutated in place), plus `tryMove(dir)` that resolves one discrete step — bounds + wall blocking, box pushing (with chains), ICE sliding, PORTAL teleport, and bump-to-attack. Chassis-correct vanilla-JS port of OpenGame's `BoardManager` (`getCell/setCell`, the entity index, `gridToWorld/worldToGrid`) + the grid GDD's movement rules. No Phaser, no tilemap.

## When to use

- Any grid-logic game (`genres/grid-logic.md`). The board + `tryMove` are the foundation every sub-type builds on.
- The grid is data (`grid` int array in `data/<level>.json`) and changes at runtime (holes fill, doors open, items collected).
- Movement is discrete: one input = one cell (or one slide). Entities snap to cells; no sub-cell positions.

## When NOT to use

- **Match-3 (`grid_subtype: match`)** — there is no `tryMove(dir)`; pieces don't walk. Movement is swap-two-cells + gravity-drop. Use the match cascade in `turn-loop.md`; you still want `board.js` (getCell/setCell, gridToWorld) but not this movement resolver.
- **Free / pixel movement** — if the character moves smoothly in pixels (top-down RPG overworld, platformer), this is the wrong genre. Cells are for discrete games only.
- **No pushing, no special cells** (a bare maze walk) — keep `tryMove` but delete the push / ICE / PORTAL branches. Don't carry dead branches; fork down to the bounds+wall check.

## Files this affects

- `src/board.js` — grid accessors + coordinate conversion + entity index (~120–180 LOC)
- `src/movement.js` — `tryMove(dir)` + push resolution + ICE slide + PORTAL teleport + bump-attack (~150–250 LOC)
- `src/entities.js` — `entityAt`, `moveEntity`, flag queries, `damageEntity` (~120–200 LOC)
- `data/<level>.json` — `grid`, `cellLegend`, `entities[]` (the level data — see `genres/grid-logic.md` §schema)
- `data/grid-config.json` — `cellSize`, `animationSpeed`

## Dependencies on foundation

```js
// src/state.js
state.level = null;        // the parsed data/<level>.json (grid, entities, cellLegend, win, lose)
state.entities = [];       // live entity objects (copied from level.entities, mutated during play)
state.anim = [];           // animation queue (turn-loop.md drains it)

// Canonical cell-type ints (genres/grid-logic.md §"Cell types") — keep stable
const EMPTY=0, WALL=1, FLOOR=2, GOAL=3, HAZARD=4, SPAWN=5, SPECIAL=6, ICE=7, PORTAL=8;
const DIRS = { up:{dx:0,dy:-1}, down:{dx:0,dy:1}, left:{dx:-1,dy:0}, right:{dx:1,dy:0} };
```

## Pattern

### 1. The board (src/board.js) — grid is row-major `grid[y][x]`

```js
function getCell(level, gx, gy) {
  if (!inBounds(level, gx, gy)) return WALL;       // out of bounds reads as wall (blocks everything)
  return level.grid[gy][gx];                        // ROW-MAJOR: [y][x]
}
function setCell(level, gx, gy, value) {            // runtime mutation: hole fills, door opens
  if (inBounds(level, gx, gy)) level.grid[gy][gx] = value;
}
function inBounds(level, gx, gy) {
  return gx >= 0 && gx < level.cols && gy >= 0 && gy < level.rows;
}

// Coordinate conversion — board is centered in the viewport via an offset
function gridOffset(level) {
  return { x: Math.floor((VIEW.w - level.cols * level.cellSize) / 2),
           y: Math.floor((VIEW.h - level.rows * level.cellSize) / 2) };
}
function gridToWorld(level, gx, gy) {               // cell -> pixel center (render + anim)
  const o = gridOffset(level);
  return { x: o.x + gx * level.cellSize + level.cellSize / 2,
           y: o.y + gy * level.cellSize + level.cellSize / 2 };
}
function worldToGrid(level, wx, wy) {               // pixel (mouse) -> cell (click select)
  const o = gridOffset(level);
  return { gx: Math.floor((wx - o.x) / level.cellSize),
           gy: Math.floor((wy - o.y) / level.cellSize) };
}
```

### 2. Entity index (src/entities.js) — fast "who is at this cell?"

OpenGame's `BoardManager` keeps a `Map<"x,y", id[]>` so cell lookups are O(1) instead of scanning every entity. For OGF's small boards a linear scan is fine and simpler:

```js
function entityAt(gx, gy) {                          // first blocking entity at a cell
  return state.entities.find(e => e.alive !== false && e.gridX === gx && e.gridY === gy) || null;
}
function entitiesAt(gx, gy) {                        // all (a walkable item under a player)
  return state.entities.filter(e => e.alive !== false && e.gridX === gx && e.gridY === gy);
}
function entitiesOfType(type) { return state.entities.filter(e => e.type === type && e.alive !== false); }
function playerEntity() { return state.entities.find(e => e.type === "player"); }

function moveEntity(e, toX, toY) {                   // logic is INSTANT; queue the visual slide
  const from = gridToWorld(state.level, e.gridX, e.gridY);
  e.gridX = toX; e.gridY = toY;
  const to = gridToWorld(state.level, toX, toY);
  state.anim.push({ e, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, t: 0, dur: cfg().animationSpeed });
  onEntityEnteredCell(e, toX, toY, getCell(state.level, toX, toY));   // fires tile interactions
}
```

### 3. `tryMove(dir)` — the move resolver (returns true if a turn was taken)

This is the heart. It returns a boolean so `takePlayerTurn` (turn-loop.md) knows whether to advance the pipeline (a wall bump is a no-op — don't burn a turn).

```js
// src/movement.js
function tryMove(dir) {
  const p = playerEntity();
  const d = DIRS[dir];
  if (!d) return false;
  p.facing = dir;

  const nx = p.gridX + d.dx, ny = p.gridY + d.dy;

  // (a) wall / out of bounds -> blocked, no turn
  if (getCell(state.level, nx, ny) === WALL) return false;

  // (b) something occupies the target cell?
  const target = entityAt(nx, ny);
  if (target) {
    // bump-to-attack: walking into a destructible enemy = attack instead of move (roguelike/tactics)
    if (target.type === "enemy" && target.isDestructible && p.maxHp) {
      damageEntity(target, cfg("combat").playerAttack);
      return true;                                   // the attack consumed the turn
    }
    // push a box (and any chain of boxes) one cell
    if (target.isPushable) {
      if (!tryPush(target, d)) return false;         // push blocked -> no move, no turn
      // box moved out of the way; player follows into the vacated cell below
    } else if (!target.isWalkable) {
      return false;                                  // solid non-pushable (statue, locked door)
    }
    // isWalkable entity (item/goal/portal): fall through, player steps onto it
  }

  // (c) move the player
  moveEntity(p, nx, ny);

  // (d) ICE: if the player landed on ice, slide in the same direction until blocked
  if (getCell(state.level, nx, ny) === ICE) slideOnIce(p, d);

  return true;
}
```

### 4. Push (with chains)

A push moves the box one cell in the same direction — but only if the box's destination is a walkable floor with nothing solid in it. Chained pushes (box into box) are blocked unless the WHOLE chain can advance (classic Sokoban rule: you can push one box, not a stack — but support a configurable chain length if the design wants it).

```js
function tryPush(box, d) {
  const bx = box.gridX + d.dx, by = box.gridY + d.dy;     // where the box would go
  if (getCell(state.level, bx, by) === WALL) return false; // box hits a wall
  const blocker = entityAt(bx, by);
  if (blocker) {
    // single-push (Sokoban): a box behind a box does NOT chain — blocked.
    // For chain-push games, recurse: if (blocker.isPushable && tryPush(blocker, d)) { /* ok */ } else return false;
    if (!blocker.isWalkable) return false;
  }
  moveEntity(box, bx, by);
  // hole-fill mechanic: pushing a box onto a HAZARD turns it into FLOOR (box sinks, makes a bridge)
  if (getCell(state.level, bx, by) === HAZARD) {
    setCell(state.level, bx, by, FLOOR);
    box.alive = false;                                     // box consumed
  }
  return true;
}
```

### 5. ICE slide

Ported from OpenGame's `slideEntity(entity, dir, shouldStop)`: the entity keeps moving one cell at a time in the travel direction until a `shouldStop` test passes (wall, a blocking entity, or a non-ice cell). Each intermediate cell fires `onEntityEnteredCell` so a trap or portal MID-slide still triggers.

```js
function slideOnIce(e, d) {
  // keep stepping while the NEXT cell is still ice-reachable and not blocked
  let guard = state.level.cols * state.level.rows;        // hard cap so a bug can't infinite-loop
  while (guard-- > 0) {
    const nx = e.gridX + d.dx, ny = e.gridY + d.dy;
    if (getCell(state.level, nx, ny) === WALL) break;     // wall stops the slide
    const blocker = entityAt(nx, ny);
    if (blocker && !blocker.isWalkable) break;            // entity stops the slide
    moveEntity(e, nx, ny);                                 // step + fire cell-entered (mid-slide traps)
    if (getCell(state.level, nx, ny) !== ICE) break;      // landed on solid ground -> stop
  }
}
```

### 6. PORTAL teleport

Portals are `isWalkable` entities carrying a shared `portalPairId`. On entering a portal cell, find the OTHER portal with the same id and teleport there. **One-way per step**: arriving at the destination portal must NOT immediately re-teleport back — guard with a `justTeleported` flag cleared next turn.

```js
function onEntityEnteredCell(e, gx, gy, cellType) {
  // PORTAL: jump to the paired portal (genres/grid-logic.md §"Cell types")
  if (cellType === PORTAL && !e.justTeleported) {
    const here = entitiesAt(gx, gy).find(o => o.type === "portal");
    if (here) {
      const pair = entitiesOfType("portal").find(o => o.portalPairId === here.portalPairId && o !== here);
      if (pair) {
        e.justTeleported = true;                           // block re-teleport on arrival
        e.gridX = pair.gridX; e.gridY = pair.gridY;        // instant logic move
        const to = gridToWorld(state.level, pair.gridX, pair.gridY);
        state.anim.push({ e, fromX: to.x, fromY: to.y, toX: to.x, toY: to.y, t: 0, dur: cfg().animationSpeed, fade: true });
      }
    }
  } else if (cellType !== PORTAL) {
    e.justTeleported = false;                              // cleared once off the portal
  }
  // HAZARD / item-pickup / SPECIAL hooks resolve in the world phase (turn-loop.md §runWorldPhase)
}
```

### 7. Click → cell (tactics / match selection)

```js
function onCanvasClick(mouseX, mouseY) {
  if (!acceptingInput()) return;
  const { gx, gy } = worldToGrid(state.level, mouseX, mouseY);
  if (!inBounds(state.level, gx, gy)) return;
  const e = entityAt(gx, gy);
  if (e) onEntityClicked(e);            // tactics: select a unit
  else   onCellClicked(gx, gy);         // tactics: move the selected unit here / match: swap
}
```

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `isPushable` | entity in `data/<level>.json` | which entities the player can push |
| Push chain length | `tryPush` recursion | single-box (Sokoban) vs push-a-stack |
| Hole-fill | `tryPush` HAZARD branch | box-into-pit makes a bridge (FLOOR) or just blocks |
| `ICE` (7) cells | `grid` array | slide surfaces; `slideOnIce` reads them |
| `portalPairId` | portal entities | which portals link to which |
| Bump-attack | `tryMove` (b) + `combat-config.json` | enable by giving player + enemy `maxHp` |
| `cellSize` / `animationSpeed` | `data/grid-config.json` | cell pixels / move-lerp duration |

## Common mistakes

1. **Column-major vs row-major mixup.** The grid is `grid[y][x]` (row first). If a helper reads `grid[x][y]`, every wall and goal is transposed and the level looks scrambled. Match OpenGame's `cells[y][x]` order everywhere.

2. **Out-of-bounds reads crash or wrap.** `getCell` must return `WALL` for out-of-bounds (not `undefined`, not wrap-around) so the border blocks movement even when a level forgets its wall ring.

3. **Letting a wall-bump consume a turn.** `tryMove` must return `false` on a blocked move so the pipeline doesn't step enemies / increment `moveCount`. (See `turn-loop.md` mistake #1.)

4. **Push that doesn't check the box's destination.** Pushing a box into a wall (or another box, in single-push) must fail and leave both the box AND the player where they were. Resolve the box first; only move the player if the push succeeded.

5. **ICE slide with no guard → infinite loop.** A malformed level (ice ringed by ice with no exit) can loop forever. Cap the slide at `cols*rows` iterations.

6. **Portal ping-pong.** Without `justTeleported`, the entity arrives on the paired portal, which immediately teleports it back, forever. Set the flag on teleport, clear it once the entity leaves a portal cell.

7. **Animating logic instead of separating them.** The entity's `gridX/gridY` must update INSTANTLY (so `entityAt`, win-check, and the next resolution see the truth); only the SPRITE lerps. If you wait for the animation to update the grid coords, two entities can think they own the same cell mid-move.

8. **Mutating `level.entities` (the loaded JSON) instead of `state.entities`.** Copy the level's `entities[]` into `state.entities` on load and mutate the copy, so reloading/undo can re-read the pristine level. (Undo snapshots `state`, not the file — see `undo-stack.md`.)

## Reference

OpenGame `grid_logic/src/systems/BoardManager.ts` (`getCell/setCell`, `isInBounds`, the `_entityGrid` index, `moveEntity`, `gridToWorld/worldToGrid`) + the GDD movement rules in `generate-gdd.ts` (`slideEntity`, PORTAL pairs, bump-attack via `damageEntity`, `getDirectionDelta`). Phaser/TS source → vanilla-canvas translation here.
