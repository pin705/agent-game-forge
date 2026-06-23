# Recipe — Path + waves (grid, waypoint follower, wave spawner)

The skeleton of every tower-defense level: a **code-defined cell grid**
(BUILDABLE / PATH / BLOCKED / SPAWN / EXIT), enemies that walk an
**editable polyline path** from `data/<level>.json`, and a **wave
spawner** that emits enemy groups on a timeline. Enemies that reach the
EXIT cost lives.

This recipe gives you `src/grid.js`, `src/path.js`, `src/enemies.js`
(movement only), and `src/waves.js`. Tower targeting/firing is
`towers-and-targeting.md`; gold/lives/win-loss is `economy.md`.

Read the genre file `conventions/genres/tower-defense.md` first — it
defines the canonical level JSON (`grid`, `paths[]`, `buildSpots[]`,
`waves[]`) this recipe reads. Read `runtime-patterns.md` for delta time
and the fixed-timestep loop.

## When to use

- Path-based TD: Kingdom Rush / Bloons style, enemies on a fixed route
- Single-screen (`camera.mode: "locked"`), grid 12-18 cols × 8-12 rows
- 3-6 enemy archetypes (basic / fast / tank / swarm / boss)
- Waves authored by hand in the level JSON `waves[]`

## When NOT to use

- **Free-roaming / pathfinding enemies** (enemy picks its own route, maze
  TD where towers block the path) — fork; you need runtime A* over the
  grid, not a fixed polyline. See Red Blob Games (linked in genre file).
- **Open-field / arena spawning** (no path, enemies home on a base) —
  that's `arena-survivor`, not TD.
- **Lane / column defense** (Plants vs Zombies — enemies walk straight
  rows, towers occupy the same rows) — simpler: drop the polyline, each
  lane is one horizontal segment. Fork the path code to a per-lane y.
- **Procedurally generated paths** — this recipe assumes the path is
  authored in the level JSON and cached once. Fork if paths regenerate.

## Files this affects

- `src/grid.js` — code-defined cell grid + grid↔world helpers (~90 LOC)
- `src/path.js` — polyline length + position-along-path lookups (~70 LOC)
- `src/enemies.js` — spawn + waypoint follow + reach-exit (~180 LOC; the
  movement half — combat half is wired by towers-and-targeting + economy)
- `src/waves.js` — wave timeline / spawn queue (~160 LOC)
- `data/enemies.json` — IDENTITY catalog (per-type stats + animations)
- `data/<level>.json` — `grid`, `paths[]`, `buildSpots[]`, `waves[]`
- `data/economy-config.json` — `startingLives`, `timeBetweenWaves`

## Pattern

### 1. The grid is code-defined (NOT a tilemap)

TD maps do **not** use a tilemap. The visual layer is one generated
background image (`background` in the level JSON); the gameplay layer is a
2D array of cell types defined in code in `src/grid.js`. This matches the
genre file ("OGF projects use code-defined grids") and keeps the editor's
job to the path + buildSpots, not per-tile painting.

```js
// src/grid.js
const CellType = Object.freeze({
  BUILDABLE: 0, // tower can be placed here
  PATH:      1, // enemies walk here; no building
  BLOCKED:   2, // scenery / water; nothing here
  SPAWN:     3, // path entry (visual marker)
  EXIT:      4, // path goal (visual marker; reaching it costs a life)
});

// Per-level cell layout. Keyed by level id so one module serves all maps.
// Each row is a string; one char per cell. Easy to eyeball + diff.
//   '.' BUILDABLE   '#' PATH   'X' BLOCKED   'S' SPAWN   'E' EXIT
const GRID_LAYOUTS = {
  guandu_pass: [
    "....XX....XX....",
    "S################",   // path runs along here
    "....XX....XX....E",
    "................",
    "....XX....XX....",
  ],
};

const CHAR_TO_CELL = { ".": 0, "#": 1, "X": 2, "S": 3, "E": 4 };

function buildGrid(levelId) {
  const rows = GRID_LAYOUTS[levelId];
  if (!rows) throw new Error(`No grid layout for level "${levelId}"`);
  return rows.map((row) => [...row].map((ch) => CHAR_TO_CELL[ch] ?? 0));
}

// cells[row][col] — note [y][x] order (row-major).
function gridToWorld(col, row, cellSize) {
  return { x: col * cellSize + cellSize / 2, y: row * cellSize + cellSize / 2 };
}
function worldToGrid(x, y, cellSize) {
  return { col: Math.floor(x / cellSize), row: Math.floor(y / cellSize) };
}
function isBuildable(cells, col, row) {
  if (row < 0 || row >= cells.length) return false;
  if (col < 0 || col >= cells[0].length) return false;
  return cells[row][col] === CellType.BUILDABLE;
}
```

On level load: `state.grid = buildGrid(levelId)` and read
`cellSize` from the level JSON `grid.cellSize`. The grid is the source of
truth for "can I build here"; `buildSpots[]` (see towers recipe) is the
editable *preferred-slot* layer on top.

> The genre file's level JSON carries `grid: { cellSize, cols, rows }` —
> those three numbers must agree with the `GRID_LAYOUTS` rows
> (`cols === row.length`, `rows === layout.length`). Treat the JSON as the
> editor-facing mirror; the code array is what the runtime reads.

### 2. The path is an editable polyline (from level JSON)

The enemy route is a polyline in `data/<level>.json`, drag-editable in the
Scene tab. Each point uses the canonical `point` shape. Spawn/exit points
sit just off-screen so enemies slide in and out.

```json
"paths": [
  {
    "id": "main_road",
    "points": [
      { "x": -40,  "y": 96  },
      { "x": 290,  "y": 96  },
      { "x": 290,  "y": 410 },
      { "x": 905,  "y": 410 },
      { "x": 1320, "y": 410 }
    ]
  }
]
```

`paths[]` is a plural array (multi-path maps possible); each point needs
no `id`, but the path object does (`"id": "main_road"`) — see common.md's
`id`-on-every-array-entry rule. Cache the segment lengths **once** on
load; never recompute per frame.

```js
// src/path.js
function buildPath(pathDef) {
  const pts = pathDef.points;
  const segLengths = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLengths.push(len);
    total += len;
  }
  return { id: pathDef.id, points: pts, segLengths, totalLength: total };
}

// Interpolated world point at distance `d` pixels along the path.
function pointAtDistance(path, d) {
  if (d <= 0) return { ...path.points[0] };
  let acc = 0;
  for (let i = 0; i < path.segLengths.length; i++) {
    const seg = path.segLengths[i];
    if (acc + seg >= d) {
      const t = seg === 0 ? 0 : (d - acc) / seg;
      const a = path.points[i], b = path.points[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += seg;
  }
  return { ...path.points[path.points.length - 1] };
}
```

### 3. Enemy catalog (data/enemies.json)

Multi-action entity → `animations: {}` object (common.md). Stats are
data, never inlined. `reward` is gold-on-kill (economy recipe);
`leakDamage` is lives lost if it reaches the exit.

```json
[
  {
    "id": "scout",
    "name": "Scout",
    "displayHeight": 48,
    "stats": { "maxHealth": 14, "speed": 95, "reward": 6, "leakDamage": 1 },
    "animations": {
      "walk": { "sprite": "assets/sprites/scout/walk/sheet.png" }
    }
  },
  {
    "id": "brute",
    "name": "Brute",
    "displayHeight": 64,
    "stats": { "maxHealth": 120, "speed": 48, "reward": 18, "leakDamage": 2 },
    "animations": {
      "walk": { "sprite": "assets/sprites/brute/walk/sheet.png" }
    }
  },
  {
    "id": "warlord",
    "name": "Warlord (boss)",
    "displayHeight": 96,
    "stats": { "maxHealth": 1400, "speed": 36, "reward": 200, "leakDamage": 10 },
    "animations": {
      "walk": { "sprite": "assets/sprites/warlord/walk/sheet.png" }
    }
  }
]
```

### 4. Enemy: spawn + move along the path

Use the **distance-along-path** model (not a per-enemy `t` recompute):
each enemy carries `dist` (pixels travelled). Advance `dist` by
`effectiveSpeed * dt`, then look up the world point. `effectiveSpeed`
folds in the slow multiplier from `towers-and-targeting.md` (default 1).

```js
// src/enemies.js  (movement half)
function spawnEnemy(typeId) {
  const type = byId("enemies", typeId);
  if (!type) return;
  const path = state.path; // the active buildPath() result
  const start = path.points[0];
  state.enemies.push({
    id: `e_${state.enemySeq++}`,
    typeId,
    x: start.x, y: start.y,
    dist: 0,
    hp: type.stats.maxHealth,
    maxHp: type.stats.maxHealth,
    speed: type.stats.speed,
    reward: type.stats.reward,
    leakDamage: type.stats.leakDamage ?? 1,
    slowMul: 1, slowTtl: 0,    // set by tower slow effects
    facing: 1,
    dead: false, leaked: false,
  });
}

function updateEnemies(dt) {
  const path = state.path;
  for (const e of state.enemies) {
    if (e.dead) continue;

    // slow effect timer (applied by projectile hits — see towers recipe)
    if (e.slowTtl > 0) { e.slowTtl -= dt; if (e.slowTtl <= 0) e.slowMul = 1; }

    const prevX = e.x;
    e.dist += e.speed * e.slowMul * dt;

    if (e.dist >= path.totalLength) {
      e.leaked = true;          // economy.js reads this → lose a life
      e.dead = true;
      continue;
    }
    const p = pointAtDistance(path, e.dist);
    e.facing = p.x >= prevX ? 1 : -1;
    e.x = p.x; e.y = p.y;
  }
  // collect leaks BEFORE filtering so economy can react this frame
  for (const e of state.enemies) {
    if (e.leaked) loseLives(e.leakDamage);   // economy.js
  }
  state.enemies = state.enemies.filter((e) => !e.dead);
  // tell the wave manager how many cleared (death OR leak both remove one)
}
```

Render: `walk` sheet, flip horizontally when `e.facing < 0`, draw a thin
HP bar above when `e.hp < e.maxHp` (genre + OpenGame both do this).

> Death (hp ≤ 0, from a projectile) is handled in
> `towers-and-targeting.md` / `economy.md` (it pays gold). This module
> owns movement + leak only. Both paths set `e.dead = true` so the single
> filter at the end removes them.

### 5. Wave spawner (src/waves.js)

`waves[]` lives inline in the level JSON. Each wave has `groups[]`
(concurrent batches), an optional `preDelay` (seconds before the wave
starts), and an optional `reward` (gold bonus for clearing it). The
manager flattens each wave into a **time-stamped spawn queue**, drains it,
then waits `timeBetweenWaves` before the next wave — or fires the next
wave early when the player presses the "send now" button.

```json
"waves": [
  { "id": "w1", "preDelay": 1.0, "reward": 25,
    "groups": [ { "type": "scout", "count": 8,  "interval": 0.75 } ] },
  { "id": "w2", "preDelay": 3.0, "reward": 30,
    "groups": [ { "type": "scout", "count": 12, "interval": 0.55 } ] },
  { "id": "w3", "preDelay": 4.0, "reward": 40,
    "groups": [
      { "type": "scout", "count": 8, "interval": 0.6 },
      { "type": "brute", "count": 3, "interval": 1.4 }
    ] },
  { "id": "w5_boss", "preDelay": 5.0, "reward": 150, "boss": true,
    "groups": [ { "type": "warlord", "count": 1, "interval": 0 } ] }
]
```

```js
// src/waves.js
const MIN_SPAWN_INTERVAL = 0.35; // floor so big groups don't overlap visually

function initWaves(level) {
  state.wave = {
    defs: level.waves,
    index: -1,            // -1 = not started
    queue: [],            // [{ type, at }] sorted by spawn time
    elapsed: 0,           // seconds since current wave's spawning began
    active: false,        // currently draining a queue
    alive: 0,             // enemies spawned-but-not-yet-removed this run
    waiting: false,       // between-wave pause
    restTimer: 0,
    done: false,          // all waves started AND field cleared
  };
}

function buildQueue(waveDef) {
  const queue = [];
  let at = waveDef.preDelay ?? 0;
  for (const g of waveDef.groups) {
    const step = Math.max(g.interval, MIN_SPAWN_INTERVAL);
    for (let i = 0; i < g.count; i++) { queue.push({ type: g.type, at }); at += step; }
  }
  queue.sort((a, b) => a.at - b.at);
  return queue;
}

function startNextWave() {
  const w = state.wave;
  w.index++;
  if (w.index >= w.defs.length) { w.active = false; return; }
  w.queue = buildQueue(w.defs[w.index]);
  w.elapsed = 0;
  w.active = true;
  w.waiting = false;
}

// player pressed "send next wave" during the rest pause
function requestNextWaveNow() {
  if (state.wave.waiting) state.wave.restTimer = 0;
}

// call once when an enemy is removed (death OR leak), from updateEnemies tail
function notifyEnemyRemoved() { state.wave.alive = Math.max(0, state.wave.alive - 1); }

function updateWaves(dt) {
  const w = state.wave;
  if (w.done) return;

  if (w.waiting) {
    w.restTimer -= dt;
    if (w.restTimer <= 0) startNextWave();
    return;
  }
  if (!w.active) return;

  w.elapsed += dt;
  while (w.queue.length && w.elapsed >= w.queue[0].at) {
    const next = w.queue.shift();
    spawnEnemy(next.type);   // enemies.js
    w.alive++;
  }

  // wave cleared = queue drained AND field empty
  if (w.queue.length === 0 && w.alive <= 0) onWaveCleared();
}

function onWaveCleared() {
  const w = state.wave;
  const def = w.defs[w.index];
  if (def.reward) earnGold(def.reward);   // economy.js — wave-clear bonus

  if (w.index + 1 >= w.defs.length) {
    w.active = false;
    w.done = true;
    winGame();                            // economy.js — survived all waves
  } else {
    w.active = false;
    w.waiting = true;
    w.restTimer = state.config.timeBetweenWaves; // seconds (see below)
  }
}
```

Wire `notifyEnemyRemoved()` into the enemy removal in step 4 (call it once
per enemy the filter drops). The HUD reads `state.wave.index + 1` /
`state.wave.defs.length` for the wave counter, and shows the
"send next wave" button whenever `state.wave.waiting` is true.

### 6. Config (data/economy-config.json)

`timeBetweenWaves` is in **seconds** here (OpenGame's gameConfig used ms;
the chassis runs delta in seconds — convert at load or author seconds).

```json
{
  "startingGold": 100,
  "startingLives": 20,
  "timeBetweenWaves": 5,
  "sellRefundRate": 0.7
}
```

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| Grid layout | `GRID_LAYOUTS` in grid.js | Which cells are buildable / path / blocked |
| `grid.cellSize` | level JSON | Pixel size of one cell (default 64) |
| `paths[].points` | level JSON | Enemy route (drag-edit in Scene tab) |
| `stats.speed` | enemies.json | Walk speed px/sec |
| `stats.maxHealth` | enemies.json | Enemy HP (tune vs total tower DPS) |
| `stats.leakDamage` | enemies.json | Lives lost if it reaches EXIT |
| `count` / `interval` | level waves[] groups | Wave density + spacing |
| `preDelay` | level waves[] | Lead-in before a wave's first spawn |
| `timeBetweenWaves` | economy-config.json | Rest-pause length (seconds) |
| `MIN_SPAWN_INTERVAL` | waves.js | Floor on spawn spacing (anti-overlap) |
| `boss: true` | level waves[] | Tag for boss music/HP-bar (your hook) |

## Common mistakes

1. **Recomputing path length every frame.** `pointAtDistance` walks the
   segments; if you also recompute `totalLength` each call it's O(n) twice
   per enemy per frame. Cache `segLengths` + `totalLength` once in
   `buildPath()` on load.

2. **`[col][row]` vs `[row][col]` mixup.** The grid array is row-major:
   `cells[row][col]`. `worldToGrid` returns `{col, row}`. Swapping them
   makes towers buildable in the wrong cells and the path mask wrong.
   Pick row-major and keep it everywhere.

3. **Wave "cleared" when the queue drains.** A drained queue means
   *spawning* finished, not that the field is clear. Gate `onWaveCleared`
   on `queue.length === 0 && alive <= 0`, and decrement `alive` on BOTH
   death and leak — otherwise the next wave never starts (or starts while
   the boss is still walking).

4. **Spawning faster than enemies can separate.** A group with
   `interval: 0.1` stacks 10 enemies on the same pixel — towers hit them
   as one blob, health bars overlap. Floor the interval
   (`MIN_SPAWN_INTERVAL`), and size it from `displayHeight / speed`.

5. **Path endpoints on-screen.** If `points[0]` is at the screen edge,
   enemies pop into existence. Put spawn/exit a cell or two off-screen
   (negative x, or x > mapSize.width) so they slide in/out.

6. **Lives lost twice for one leak.** Set `e.dead = true` the same frame
   you set `e.leaked`, and read `leaked` before the filter. If you check
   leaks in a separate pass that also runs next frame, you double-charge.

7. **`timeBetweenWaves` unit mismatch.** OpenGame's source stored it in
   milliseconds (5000); this chassis steps in seconds. Store seconds (5)
   or divide on load — mixing them gives an 83-minute rest pause.

## Reference

OpenGame `modules/tower_defense/src/systems/WaveManager.ts` (queue
build + between-wave timer + clear detection) and
`enemies/BaseTDEnemy.ts` (waypoint follow, reach-end emit). Ported here
to vanilla Canvas: Phaser groups → `state.enemies` array, the scene
EventEmitter (`spawnEnemy` / `enemyReachedEnd`) → direct function calls,
`currentWaypointIndex` stepping → distance-along-path. Grid `CellType`
enum + `gridToWorld` / `isValidPlacement` are from
`modules/tower_defense/src/utils.ts`.
