# Recipe — Wave spawner + difficulty curve (arena survivor)

Implements the Vampire-Survivors spawn director: a time-keyed wave schedule,
enemies spawned on a **ring just outside the viewport**, a hard cap on alive
enemies, and a difficulty curve that ramps spawn rate + enemy HP over time.
Plus scripted **map events** (encircling swarms, boss spawn) layered on top of
the periodic waves.

## When to use

- Arena-survivor genre (`genre: arena-survivor`) — VS / Brotato style
- Open arena, camera follows player, enemies converge from all sides
- Difficulty driven by TIME (survive-the-clock), not by killing a fixed roster
- Wave content lives in `data/<arena>.json` `waves[]` (per `genres/arena-survivor.md`)

## When NOT to use

- **Side-scroll / shmup enemy spawning** — those spawn from screen edges along
  the scroll axis, not on a ring. Use `recipes/shmup/enemy-waves.md` or the
  side-scroll enemy placement instead.
- **Fixed bounded arena with hand-placed enemies** (a Brotato single-room with
  pre-placed spawns) — you can still use the wave schedule, but spawn inside
  bounds instead of ring-outside; see Adaptation knobs.
- **Boss-only arena** (locked camera, no periodic spawns) — skip the spawner;
  just spawn the boss directly.

## Files this affects

- `src/spawner.js` — wave director + ring spawn + cap (~150-300 LOC)
- `src/enemies.js` — `pushEnemy()` (object-pooled) + chase update; spawner calls it
- `src/pool.js` — object pool (MANDATORY — never `new` in the spawn loop)
- `data/<arena>.json` — IDENTITY: `waves[]`, `mapEvents[]`, `spawnRing`, `arena`
- `data/enemy-spawn-curve.json` — TUNING: ramp coefficients, HP scale per minute
- `data/enemies.json` — IDENTITY: enemy catalog (stats, sprite, ai)

## Dependencies on foundation

```js
// state.js
state.enemies = [];          // live enemies (pooled objects, .alive flag)
state.elapsed = 0;           // seconds since run start (advanced in game loop)
state.camera = { x: 0, y: 0 };
state.player = { x, y, hp, ... };
```

Object pool from `src/pool.js` (see `runtime-patterns.md` §pooling):

```js
const enemyPool = makePool(400, () => ({
  alive: false, type: null, x: 0, y: 0, hp: 0, maxHp: 0,
  speed: 0, damage: 0, hurtTimer: 0, animTime: 0
}));
```

## Level data — wave schedule (data/<arena>.json)

Matches the schema in `genres/arena-survivor.md`. Each wave: a window of time
during which one enemy type spawns at a minimum count + interval.

```json
{
  "id": "endless_field",
  "arena": { "width": 4000, "height": 4000, "wrap": false },
  "viewport": { "width": 1280, "height": 720 },
  "spawnRing": { "innerMargin": 80, "maxAlive": 300 },
  "playerSpawn": { "x": 2000, "y": 2000 },
  "waves": [
    { "id": "w1", "startTime":   0, "duration": 60, "enemyType": "bat",      "minCount": 12, "interval": 1.5 },
    { "id": "w2", "startTime":  60, "duration": 60, "enemyType": "skeleton", "minCount": 18, "interval": 1.0 },
    { "id": "w3", "startTime": 120, "duration": 60, "enemyType": "wolf",     "minCount": 24, "interval": 0.8 },
    { "id": "w4", "startTime": 180, "duration": 90, "enemyType": "bat",      "minCount": 30, "interval": 0.6, "modifier": "swarm" }
  ],
  "mapEvents": [
    { "id": "ev_swarm", "at": 90,  "kind": "encircling_swarm", "params": { "type": "bat", "count": 60 } },
    { "id": "ev_boss",  "at": 240, "kind": "boss",             "params": { "type": "ancient_skull" } }
  ]
}
```

Every array entry has an `id` (per `common.md` JSON entry contract — the Scene
editor addresses spawn rings + boss spawn + pickups by id).

## Difficulty curve (data/enemy-spawn-curve.json — TUNING)

Plain JSON (no `{value:}` wrapper — per OGF config rules):

```json
{
  "intervalScale": { "start": 1.0, "min": 0.35, "rampSeconds": 600 },
  "enemyHpScale":  { "perMinute": 0.15, "max": 4.0 },
  "globalMaxAlive": 300
}
```

`intervalScale` multiplies each wave's `interval` (faster over time).
`enemyHpScale.perMinute` adds 15% HP per elapsed minute.

## Pattern

### 1. Ring spawn — pick a point just outside the visible viewport

This is the canonical VS pattern (per `genres/arena-survivor.md`). Spawn on a
ring centered on the player, radius = half the viewport diagonal + margin, so
the enemy walks in from just off-screen.

```js
// src/spawner.js
function randomRingPoint(player, viewport, margin) {
  const theta = Math.random() * Math.PI * 2;
  const radius = Math.hypot(viewport.width, viewport.height) / 2 + margin;
  return {
    x: clamp(player.x + Math.cos(theta) * radius, 0, ARENA.width),
    y: clamp(player.y + Math.sin(theta) * radius, 0, ARENA.height),
  };
}
```

### 2. Spawn one enemy via the pool (never `new`)

```js
function spawnEnemy(type, x, y) {
  if (state.enemies.length >= maxAliveNow()) return;   // hard cap (see step 4)
  const def = byId("enemies", type);                   // catalog lookup
  if (!def) return;
  const e = enemyPool.acquire();
  if (!e) return;                                      // pool exhausted
  e.alive = true;
  e.type = type;
  e.x = x; e.y = y;
  e.maxHp = Math.round(def.stats.hp * hpScaleNow());   // difficulty scaling
  e.hp = e.maxHp;
  e.speed = def.stats.speed;
  e.damage = def.stats.damage;
  e.hurtTimer = 0; e.animTime = 0;
  state.enemies.push(e);
}
```

### 3. Wave director — drive spawns off `state.elapsed`

Each wave carries a private `timer` that counts down between spawns while the
wave's time window is active. Compute the *effective* interval by applying the
difficulty curve.

```js
let waves = [];        // loaded from level JSON, each gets a runtime .timer + .spawned
let mapEvents = [];     // loaded from level JSON, each gets .fired = false

function initSpawner(level) {
  ARENA = level.arena;
  VIEWPORT = level.viewport;
  RING = level.spawnRing;
  waves = level.waves.map(w => ({ ...w, timer: 0, spawned: 0 }));
  mapEvents = (level.mapEvents || []).map(ev => ({ ...ev, fired: false }));
}

function updateSpawner(dt) {
  const t = state.elapsed;

  // 1. Periodic waves
  for (const w of waves) {
    const active = t >= w.startTime && t < w.startTime + w.duration;
    if (!active) continue;
    w.timer -= dt;
    if (w.timer <= 0) {
      w.timer = w.interval * intervalScaleNow();   // effective interval (curve-scaled)
      const p = randomRingPoint(state.player, VIEWPORT, RING.innerMargin);
      spawnEnemy(w.enemyType, p.x, p.y);
      w.spawned++;
    }
  }

  // 2. Scripted map events (fire once when elapsed passes `at`)
  for (const ev of mapEvents) {
    if (ev.fired || t < ev.at) continue;
    ev.fired = true;
    fireMapEvent(ev);
  }
}
```

### 4. Difficulty curve helpers + hard cap

```js
function intervalScaleNow() {
  const c = SPAWN_CURVE.intervalScale;
  const k = clamp(state.elapsed / c.rampSeconds, 0, 1);
  return c.start + (c.min - c.start) * k;   // lerp start → min
}

function hpScaleNow() {
  const c = SPAWN_CURVE.enemyHpScale;
  return Math.min(c.max, 1 + (state.elapsed / 60) * c.perMinute);
}

function maxAliveNow() {
  // per-level override OR global tuning cap; whichever is smaller
  return Math.min(RING.maxAlive ?? Infinity, SPAWN_CURVE.globalMaxAlive);
}
```

> **The cap is HARD, not soft** (per `genres/arena-survivor.md`): when alive
> count hits the cap, periodic-wave spawns silently skip this tick. Boss /
> map-event spawns IGNORE the cap (see `fireMapEvent`).

### 5. Map events — swarms + boss (ignore the cap)

```js
function fireMapEvent(ev) {
  if (ev.kind === "encircling_swarm") {
    // ring of N enemies all at once, evenly spaced around the player
    const n = ev.params.count;
    const radius = Math.hypot(VIEWPORT.width, VIEWPORT.height) / 2 + RING.innerMargin;
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * Math.PI * 2;
      const x = clamp(state.player.x + Math.cos(theta) * radius, 0, ARENA.width);
      const y = clamp(state.player.y + Math.sin(theta) * radius, 0, ARENA.height);
      forceSpawnEnemy(ev.params.type, x, y);   // bypasses cap
    }
  } else if (ev.kind === "boss") {
    const p = randomRingPoint(state.player, VIEWPORT, RING.innerMargin);
    state.boss = forceSpawnEnemy(ev.params.type, p.x, p.y);
    playSound("boss_spawn");
  }
}

function forceSpawnEnemy(type, x, y) {
  const e = enemyPool.acquire();   // no cap check
  // ...same init as spawnEnemy()...
  return e;
}
```

### 6. Despawn far-away enemies (leash)

Enemies that drift far behind the player (the player ran away) waste pool slots.
Despawn beyond a leash distance so the slot frees for a fresh on-ring spawn.

```js
function cullStrayEnemies() {
  const leash = Math.hypot(VIEWPORT.width, VIEWPORT.height) * 2;  // 2× diagonal
  for (const e of state.enemies) {
    if (!e.alive) continue;
    if (Math.hypot(e.x - state.player.x, e.y - state.player.y) > leash) {
      e.alive = false;          // release; compaction step splices !alive out
    }
  }
}
```

Run a compaction pass each frame to remove `!alive` entries and return them to
the pool (`enemyPool.release(e)`); see `runtime-patterns.md` §pooling.

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `waves[].interval` | level JSON | Base seconds between spawns in that wave |
| `waves[].minCount` | level JSON | Floor on alive-of-this-type (top up if below) |
| `waves[].modifier` | level JSON | Tag (`swarm`/`fast`) read by enemies.js for variants |
| `spawnRing.innerMargin` | level JSON | How far off-screen enemies appear |
| `spawnRing.maxAlive` | level JSON | Per-level alive cap |
| `intervalScale.rampSeconds` | curve config | How long until spawn rate hits its floor |
| `enemyHpScale.perMinute` | curve config | Tankiness ramp |
| Bounded-arena spawn | code | Replace `randomRingPoint` with a uniform in-bounds point IF the arena is a small fixed room |

## Common mistakes

1. **Spawning enemies uniformly across the arena** — half spawn off-screen,
   behind the player, or in dead corners. Always spawn on the ring just outside
   the viewport. (The #1 arena-survivor spawn bug.)
2. **No hard alive cap** — 1000+ enemies → 5 fps. Cap at ~300, hard-skip
   periodic spawns when full. (Per `genres/arena-survivor.md`.)
3. **`new Enemy()` per spawn** — GC stutter as enemies churn. Use the pool;
   `acquire()` / `release()` only.
4. **Difficulty baked into the catalog** — putting scaled HP in `enemies.json`.
   Keep base stats in the catalog, the *ramp* in `enemy-spawn-curve.json`, and
   multiply at spawn time (`hpScaleNow()`).
5. **Map-event boss respects the cap** — if the arena is already at 300 enemies
   the boss never spawns. Boss + swarm events must bypass the cap.
6. **Wave `timer` initialized to the interval** — first spawn waits a full
   interval before the wave starts. Initialize `timer = 0` so the first enemy
   appears immediately when the wave window opens.
7. **No leash cull** — when the player kites, stale enemies pile up off-screen
   and hold pool slots so on-ring spawns stop. Cull beyond ~2× viewport
   diagonal.
8. **Reading `data/*.json` numbers inline in JS** — spawn rates hardcoded in
   `spawner.js`. They belong in `enemy-spawn-curve.json` so the user can tune
   the difficulty in chat without a code change.

## Reference

- `genres/arena-survivor.md` §"Enemy spawn — ring outside viewport",
  §"Hard cap on alive enemies", §"Level data" — the schema + canonical patterns
  this recipe implements.
- `runtime-patterns.md` §pooling — the object pool contract.
- VS wiki — Timed Enemy Spawn: "one wave every minute, each wave specifying a
  minimum amount and a spawn interval."

## Files NOT in this recipe

- Weapon auto-fire that kills these enemies → `recipes/arena-survivor/auto-attack.md`
- XP orbs dropped on enemy death + level-up → `recipes/arena-survivor/xp-and-levelup.md`
- Enemy chase AI + contact damage detail → `src/enemies.js` (genre file §"Enemy AI")
