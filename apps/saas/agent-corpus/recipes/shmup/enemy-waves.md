# Recipe — Enemy waves, formations + flight paths (shmup)

Implements the shmup wave director: a time-keyed script spawns groups of enemies
in a **formation** (where they appear relative to each other) that move along a
shared **path** (how the group flies through the screen). Movement (path) is
decoupled from shooting (bullet pattern), so any enemy can fly any path and fire
any pattern. The final wave spawns the boss.

## When to use

- Shmup genre — vertical or horizontal scrolling shooter
- Enemies arrive in scripted, timed groups (not endless ring spawns)
- Wave + path data lives in `data/<stage>.json` `waves[]` + `data/paths.json`
  (per `genres/shmup.md`)

## When NOT to use

- **Arena-survivor ring spawning** — continuous time-driven spawns around the
  player, no formations/paths. Use `recipes/arena-survivor/wave-spawner.md`.
- **Side-scroll hand-placed enemies** — enemies sit at fixed level positions and
  patrol. Use `recipes/side-scroll/enemy-patrol.md`.
- **Procedural endless shmup** — if waves are generated on the fly rather than
  scripted, keep the formation + path functions but replace the JSON script with
  a generator.

## Files this affects

- `src/waves.js` — wave script executor + formation spawn + per-enemy path update (~200-400 LOC)
- `src/pool.js` — enemy pool (shared with bullets' enemy pool? no — separate)
- `data/wave-script.json` (or inline in `data/<stage>.json` `waves[]`) — IDENTITY: the script
- `data/paths.json` — path scripts (or inline functions in `src/waves.js`)
- `data/enemies.json` — IDENTITY: enemy catalog (stats, sprite, shootScript)
- `src/bullets.js` / `src/patterns.js` — enemies fire via `shootScript` (see bullet-patterns recipe)

## Dependencies on foundation

```js
// state.js
state.enemies = [];          // live pooled enemies
state.elapsed = 0;           // seconds since stage start (advance in game loop)
state.boss = null;
```

Enemy pool (per `runtime-patterns.md` §pooling — formations spawn many at once):

```js
const enemyPool = makePool(120, () => ({
  alive: false, type: null,
  x: 0, y: 0, spawnX: 0, spawnY: 0,   // spawn origin (paths are relative to it)
  hp: 0, t: 0,                         // t = seconds since this enemy spawned
  path: null, shootScript: null, shootTimer: 0
}));
```

## Wave script (data/<stage>.json `waves[]`)

Matches `genres/shmup.md`. Each wave has an `id`, a spawn time `at`, a
`formation`, an `enemyType` (catalog id), a `count`, `spacing` (px between
formation members), `interval` (delay between successive spawns within the
wave), and a `path` (id into `paths.json`).

```json
"waves": [
  { "id": "w1", "at":  2, "formation": "v_shape", "enemyType": "scout",  "count": 7, "spacing": 60, "interval": 0.15, "path": "swoop_left" },
  { "id": "w2", "at":  6, "formation": "line",    "enemyType": "scout",  "count": 5, "spacing": 80, "interval": 0.10, "path": "drop_down" },
  { "id": "w3", "at": 12, "formation": "column",  "enemyType": "gunner", "count": 4, "spacing": 90, "interval": 0.20, "path": "weave" },
  { "id": "w4", "at": 28, "formation": "single",  "enemyType": "boss",   "count": 1,                                  "path": "boss_intro" }
]
```

`data/enemies.json` (IDENTITY — links a `shootScript` id from the bullet-patterns
recipe):

```json
[
  { "id": "scout",  "hp": 2,  "size": { "w": 44, "h": 44 }, "score": 100,
    "shootScript": "scout_shoot",   "animations": { "fly": { "sprite": "assets/sprites/scout/fly/sheet.png" } } },
  { "id": "gunner", "hp": 6,  "size": { "w": 52, "h": 52 }, "score": 250,
    "shootScript": "gunner_spread", "animations": { "fly": { "sprite": "assets/sprites/gunner/fly/sheet.png" } } },
  { "id": "boss",   "hp": 240, "size": { "w": 220, "h": 180 }, "score": 5000,
    "shootScript": "boss_radial",   "animations": { "idle": { "sprite": "assets/sprites/boss/idle/sheet.png" } } }
]
```

## Pattern

### 1. Formations — offset of each member from the group origin

A formation is a pure function: member index + count + spacing → an (x, y)
offset from the group's spawn anchor. The anchor is a point just off the leading
edge (top for vertical scroll).

```js
// src/waves.js
function formationOffset(name, i, count, spacing) {
  switch (name) {
    case "line":    // horizontal row, centered
      return { x: (i - (count - 1) / 2) * spacing, y: 0 };
    case "column":  // vertical stack
      return { x: 0, y: i * spacing };
    case "v_shape": { // V / chevron, centered
      const half = (count - 1) / 2;
      const d = i - half;
      return { x: d * spacing, y: Math.abs(d) * spacing * 0.6 };
    }
    case "single":
    default:
      return { x: 0, y: 0 };
  }
}
```

### 2. Path scripts — position relative to spawn origin over time `t`

A path is `t (seconds since spawn) → { x, y }` offset from the enemy's spawn
point. Movement and shooting are decoupled: the path moves the enemy, the
`shootScript` (bullet-patterns recipe) makes it fire. Keep paths in
`src/waves.js` (or load coefficients from `data/paths.json`).

```js
const SCROLL = 80;   // mirror the stage scrollSpeed for path math

const paths = {
  drop_down:  (t) => ({ x: 0,                              y: SCROLL * t * 1.6 }),
  swoop_left: (t) => ({ x: -200 + Math.sin(t * 2) * 100,   y: t * 200 }),
  weave:      (t) => ({ x: Math.sin(t * 3) * 240,          y: t * 180 }),
  boss_intro: (t) => t < 2 ? { x: 0, y: 100 * t }          // fly in
                           : { x: Math.sin(t * 0.5) * 200, y: 200 }  // then hover + strafe
};
```

### 3. Wave director — fire each wave when `state.elapsed` passes `at`

Each wave spawns its `count` members over time using `interval` (so a 7-ship V
trickles in rather than popping all at once). Track a per-wave `fired` flag +
`spawnedSoFar` + `nextSpawnTimer`.

```js
let waves = [];   // loaded from level JSON

function initWaves(level) {
  waves = level.waves.map(w => ({ ...w, started: false, done: false, spawnedSoFar: 0, timer: 0 }));
}

function updateWaves(dt) {
  for (const w of waves) {
    if (w.done) continue;
    if (!w.started) {
      if (state.elapsed < w.at) continue;
      w.started = true; w.timer = 0;     // wave window opens
    }
    // trickle members in on `interval`
    w.timer -= dt;
    if (w.spawnedSoFar < w.count && w.timer <= 0) {
      spawnFormationMember(w, w.spawnedSoFar);
      w.spawnedSoFar++;
      w.timer = w.interval ?? 0;
    }
    if (w.spawnedSoFar >= w.count) w.done = true;
  }
  updateEnemyPaths(dt);
  updateEnemyShooting(dt);               // from bullet-patterns recipe
}
```

### 4. Spawn one formation member

```js
function spawnFormationMember(wave, i) {
  const def = byId("enemies", wave.enemyType);
  if (!def) return;
  const off = formationOffset(wave.formation, i, wave.count, wave.spacing ?? 60);
  // group anchor: centered horizontally, just above the top edge (vertical scroll)
  const anchorX = VIEW.w / 2;
  const anchorY = -60;
  const e = enemyPool.acquire();
  if (!e) return;
  e.alive = true; e.type = wave.enemyType;
  e.spawnX = anchorX + off.x;
  e.spawnY = anchorY + off.y;
  e.x = e.spawnX; e.y = e.spawnY;
  e.hp = def.hp; e.t = 0;
  e.path = wave.path;
  e.shootScript = def.shootScript;
  e.shootTimer = (byId("bullet-patterns", def.shootScript)?.interval) ?? 1;
  state.enemies.push(e);
  if (wave.enemyType === "boss") state.boss = e;
}
```

### 5. Update enemy positions along their path

Position = spawn origin + path offset at the enemy's local time `t`. The path
is in *world* terms relative to the spawn point; the enemy doesn't also inherit
the bg scroll (it flies its own choreography against the moving backdrop).

```js
function updateEnemyPaths(dt) {
  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.t += dt;
    const fn = paths[e.path] || paths.drop_down;
    const off = fn(e.t);
    e.x = e.spawnX + off.x;
    e.y = e.spawnY + off.y;
    // cull when a finished enemy exits the bottom (vertical scroll)
    if (e.path !== "boss_intro" && e.y > VIEW.h + 80) e.alive = false;
  }
}
```

### 6. Death, scoring, boss trigger

```js
function damageEnemy(e, dmg) {
  e.hp -= dmg;
  if (e.hp > 0) return;
  e.alive = false;
  state.score += (byId("enemies", e.type)?.score ?? 0);
  burstParticles(e.x, e.y);              // juice
  playSound("explode");
  if (e === state.boss) onBossDefeated(); // stage clear / next stage
}
```

The boss is just the wave with `enemyType: "boss"` flying `boss_intro` — no
special spawner. Its multi-phase attacks come from swapping its `shootScript`
at HP thresholds (a few lines in `damageEnemy`, or a small boss FSM if it has
3+ phases — then split into `src/boss.js`).

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `at` | wave script | When the wave spawns (seconds) |
| `formation` | wave script | line / column / v_shape / single |
| `count` / `spacing` | wave script | Group size / spread between members |
| `interval` | wave script | Trickle delay between members (0 = all at once) |
| `path` | wave script | Which flight choreography (paths.js id) |
| `shootScript` | enemies.json | Which bullet pattern this enemy fires |
| path coefficients | waves.js / paths.json | Amplitude/period of weave/swoop |
| boss `hp` + phase thresholds | enemies.json + damageEnemy | Boss length + escalation |

## Common mistakes

1. **Spawning a whole formation in one frame** — 7 ships pop instantly, no
   sense of a stream arriving. Trickle members in on `interval`.
2. **Coupling movement to shooting** — baking the fire cadence into the path
   function. Keep `path` (movement) and `shootScript` (firing) separate so any
   enemy flies any path and shoots any pattern.
3. **Enemies inherit the bg scroll on top of their path** — they drift faster
   than intended and leave the screen early. The path is the enemy's full
   choreography; don't also add `scrollSpeed * t`.
4. **No off-screen cull for pass-through enemies** — a `drop_down` ship that
   exits the bottom stays alive in the pool forever, eventually exhausting it.
   Cull when past the exit edge (but NOT the boss, which hovers).
5. **Boss culled by the pass-through rule** — the boss hovers at `y ≈ 200`, which
   is on-screen, so it's fine — but if you cull by `t > someMax` instead of by
   position, the boss vanishes mid-fight. Cull by exit position and exempt the
   boss path.
6. **Formation offset not centered** — `i * spacing` skews `line`/`v_shape` to
   one side off-screen. Center with `(i - (count-1)/2) * spacing`.
7. **`new Enemy()` per spawn** — a formation is many at once; GC stutter. Pool.
8. **Wave timing hardcoded in waves.js** — `at`/`count`/`formation` belong in the
   stage JSON so the level designer re-times waves without touching code.

## Reference

- `genres/shmup.md` §"Level data — wave script", §"Enemy formations" — the
  schema + path examples this recipe implements.
- `recipes/shmup/bullet-patterns.md` — the `shootScript` emitters these enemies
  fire (`updateEnemyShooting`).
- `recipes/shmup/scrolling-bg.md` — `stageProgress()` if you want waves keyed to
  terrain segments instead of raw seconds.
- `runtime-patterns.md` §pooling.

## Files NOT in this recipe

- Bullet emission + pooling → `recipes/shmup/bullet-patterns.md`
- Scrolling background the waves fly over → `recipes/shmup/scrolling-bg.md`
- Player ship + lives + power-ups → `src/ship.js`
- A 3+ phase boss state machine → split into `src/boss.js` (fork from this recipe's
  single-`shootScript` boss)
