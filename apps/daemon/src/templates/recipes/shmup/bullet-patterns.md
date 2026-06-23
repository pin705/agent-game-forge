# Recipe — Bullet patterns (shmup)

Implements data-driven **bullet emitters**: each pattern (stream / spread / ring
/ homing / lateral_pod) is a small function that, given an origin + aim, spawns
pooled bullets. Enemies (and the boss) reference a pattern id + cooldown via a
`shootScript`; the player ship fires a fixed pattern forward. This is the
signature shmup mechanic — bullets everywhere, object-pooled.

## When to use

- Shmup genre (`genre: shmup`) — vertical or horizontal scrolling shooter
- Enemies + player emit bullets along defined patterns
- Pattern definitions live in `data/bullet-patterns.json` (per `genres/shmup.md`)
- Bullets are numerous (50-200 alive at peak) → pooled

## When NOT to use

- **Arena-survivor auto-attack** — there the *weapon* owns the targeting and the
  player never aims. Use `recipes/arena-survivor/auto-attack.md`.
- **Side-scroll single-projectile enemies** (one fireball at a time) — overkill;
  use `recipes/side-scroll/projectiles.md`.
- **Bullet-hell with replay-precise deterministic patterns** — if you need
  frame-exact reproducibility, seed an RNG and avoid `Math.random()` in emitters
  (this recipe uses deterministic angle math already; only `homing` reads live
  target positions).

## Files this affects

- `src/patterns.js` — emitter functions, one per pattern type (~300-500 LOC)
- `src/bullets.js` — bullet update + bounds cull + hit detection (~200-400 LOC)
- `src/pool.js` — TWO pools: player bullets + enemy bullets (MANDATORY)
- `data/bullet-patterns.json` — IDENTITY/TUNING: pattern defs (id, type, params)
- `data/projectiles.json` — IDENTITY: bullet sprites per kind
- `src/ship.js` + `src/waves.js` — callers (player fire; enemy `shootScript`)

## Dependencies on foundation

```js
// state.js
state.playerBullets = [];   // live pooled player shots
state.enemyBullets  = [];   // live pooled enemy shots
state.player = { x, y, w, h, ... };
state.enemies = [];          // from waves.js; each may carry a shootTimer
```

Two pools (per `genres/shmup.md` — never `new Bullet()` in the hot loop):

```js
const playerBulletPool = makePool(200, mkBullet);
const enemyBulletPool  = makePool(400, mkBullet);
function mkBullet() {
  return { alive: false, kind: null, x: 0, y: 0, vx: 0, vy: 0,
           dmg: 1, radius: 5, life: 0, turnRate: 0, target: null };
}
```

## Pattern definitions (data/bullet-patterns.json)

Matches the schema in `genres/shmup.md`. Each entry has an `id` (per `common.md`
JSON entry contract) and a `type` that selects the emitter:

```json
[
  { "id": "scout_shoot",   "type": "stream",  "kind": "enemy_basic", "speed": 320, "interval": 1.2, "dmg": 1 },
  { "id": "gunner_spread", "type": "spread",  "kind": "enemy_basic", "speed": 260, "interval": 1.6, "count": 5, "arc": 40, "dmg": 1 },
  { "id": "boss_radial",   "type": "ring",    "kind": "enemy_basic", "speed": 180, "interval": 2.0, "count": 16, "dmg": 1 },
  { "id": "homing_missile","type": "homing",  "kind": "enemy_homing","speed": 240, "interval": 3.0, "turnRate": 4, "dmg": 2 },
  { "id": "pod_sweep",     "type": "lateral_pod","kind": "enemy_basic","speed": 300, "interval": 1.0, "dmg": 1 },
  { "id": "player_main",   "type": "stream",  "kind": "player_shot", "speed": 700, "interval": 0.14, "dmg": 1 }
]
```

`interval` is the emitter's own cooldown; the *caller* (enemy shootScript or
player fire button) ticks it. `speed` is along the aim direction. `arc` is the
total fan width in degrees (spread). `count` is bullets per emission
(spread/ring).

## Pattern

### 1. Spawn one bullet via the right pool

```js
// src/bullets.js
function spawnBullet(side, def, x, y, vx, vy) {
  const pool = side === "player" ? playerBulletPool : enemyBulletPool;
  const b = pool.acquire();
  if (!b) return null;             // pool exhausted → skip
  b.alive = true; b.kind = def.kind;
  b.x = x; b.y = y; b.vx = vx; b.vy = vy;
  b.dmg = def.dmg ?? 1; b.radius = def.radius ?? 5;
  b.life = def.life ?? 6; b.turnRate = def.turnRate ?? 0; b.target = null;
  (side === "player" ? state.playerBullets : state.enemyBullets).push(b);
  return b;
}
```

### 2. Emitters — one function per pattern type

`aim` is a unit vector (enemies usually fire "down" the scroll, or toward the
player; player fires "up"). Keep emitters pure: origin + aim + def → bullets.

```js
// src/patterns.js
function emit(side, def, originX, originY, aim) {
  switch (def.type) {
    case "stream":  return emitStream(side, def, originX, originY, aim);
    case "spread":  return emitSpread(side, def, originX, originY, aim);
    case "ring":    return emitRing(side, def, originX, originY);
    case "homing":  return emitHoming(side, def, originX, originY, aim);
    case "lateral_pod": return emitLateralPod(side, def, originX, originY);
  }
}

function emitStream(side, def, x, y, aim) {
  spawnBullet(side, def, x, y, aim.x * def.speed, aim.y * def.speed);
}

function emitSpread(side, def, x, y, aim) {
  const n = def.count ?? 5;
  const arc = (def.arc ?? 40) * Math.PI / 180;       // total fan, degrees → rad
  const base = Math.atan2(aim.y, aim.x);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) - 0.5;     // -0.5 .. +0.5, centered
    const a = base + t * arc;
    spawnBullet(side, def, x, y, Math.cos(a) * def.speed, Math.sin(a) * def.speed);
  }
}

function emitRing(side, def, x, y) {
  const n = def.count ?? 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    spawnBullet(side, def, x, y, Math.cos(a) * def.speed, Math.sin(a) * def.speed);
  }
}

function emitHoming(side, def, x, y, aim) {
  const b = spawnBullet(side, def, x, y, aim.x * def.speed, aim.y * def.speed);
  if (b) b.target = state.player;                    // enemy homing → tracks player
}

function emitLateralPod(side, def, x, y) {
  // two bullets fired perpendicular to the scroll axis (left + right)
  spawnBullet(side, def, x, y, -def.speed, 0);
  spawnBullet(side, def, x, y,  def.speed, 0);
}
```

### 3. Update bullets — move, home, expire, cull off-screen

```js
function updateBulletPool(list, dt) {
  for (const b of list) {
    if (!b.alive) continue;

    if (b.turnRate > 0 && b.target) {                // homing steer
      const dx = b.target.x - b.x, dy = b.target.y - b.y;
      const len = Math.hypot(dx, dy) || 1;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      b.vx += ((dx / len) * sp - b.vx) * Math.min(1, dt * b.turnRate);
      b.vy += ((dy / len) * sp - b.vy) * Math.min(1, dt * b.turnRate);
    }

    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0 || offScreen(b)) b.alive = false;  // free for compaction
  }
}

function offScreen(b) {
  const m = 40;   // margin so bullets aren't culled at the very edge
  return b.x < -m || b.x > VIEW.w + m || b.y < -m || b.y > VIEW.h + m;
}

function updateBullets(dt) {
  updateBulletPool(state.playerBullets, dt);
  updateBulletPool(state.enemyBullets, dt);
}
```

### 4. Hit detection — player bullets vs enemies; enemy bullets vs player

AABB or circle (per `genres/shmup.md` — per-pixel is overkill). Circle is
cheap + forgiving:

```js
function hit(b, ent, entR) {
  const r = b.radius + entR;
  return (b.x - ent.x) ** 2 + (b.y - ent.y) ** 2 <= r * r;
}

function resolveBulletHits() {
  // player shots → enemies
  for (const b of state.playerBullets) {
    if (!b.alive) continue;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (hit(b, e, (e.size?.w ?? 40) / 2)) {
        damageEnemy(e, b.dmg);          // waves.js / enemies.js
        b.alive = false; break;
      }
    }
  }
  // enemy shots → player (skip during i-frames)
  if (state.player.invuln <= 0) {
    for (const b of state.enemyBullets) {
      if (!b.alive) continue;
      if (hit(b, state.player, state.player.hitboxR ?? 6)) {
        damagePlayer(b.dmg);            // ship.js: lives--, invuln frames
        b.alive = false;
      }
    }
  }
}
```

> **Player hitbox is SMALL** (the "grazing" feel): set `player.hitboxR` ~6px even
> though the ship sprite is ~48px. Classic shmups make the real hitbox a few
> pixels at the ship's center so near-misses feel fair.

### 5. Caller side — enemy shootScript + player fire

```js
// waves.js — each enemy with a shootScript ticks its own emitter cooldown:
function updateEnemyShooting(dt) {
  for (const e of state.enemies) {
    if (!e.alive || !e.shootScript) continue;
    const def = byId("bullet-patterns", e.shootScript);
    e.shootTimer -= dt;
    if (e.shootTimer <= 0) {
      e.shootTimer = def.interval;
      const aim = aimDownOrAtPlayer(e, def);     // scroll-down, or toward player
      emit("enemy", def, e.x, e.y, aim);
    }
  }
}

// ship.js — player holds fire; vertical shmup aims up (fixed direction):
function updatePlayerShooting(dt) {
  const def = byId("bullet-patterns", "player_main");
  state.player.shootTimer -= dt;
  if (state.player.shootTimer <= 0 && keyDown("fire")) {
    state.player.shootTimer = def.interval;
    const aim = SCROLL_AXIS === "vertical" ? { x: 0, y: -1 } : { x: 1, y: 0 };
    emit("player", def, state.player.x, state.player.y - state.player.h / 2, aim);
  }
}
```

Player aim is **fixed** (up for vertical, forward for horizontal) — per
`genres/shmup.md`. Free aim is twin-stick territory, a different genre.

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `type` | bullet-patterns.json | stream / spread / ring / homing / lateral_pod |
| `speed` | bullet-patterns.json | Bullet velocity along aim |
| `interval` | bullet-patterns.json | Emitter cooldown (the caller ticks it) |
| `count` | bullet-patterns.json | Bullets per emission (spread / ring) |
| `arc` | bullet-patterns.json | Fan width in degrees (spread) |
| `turnRate` | bullet-patterns.json | Homing steer strength (0 = straight) |
| `player.hitboxR` | ship-config.json | Grazing tightness (small = forgiving feel) |
| pool sizes (200 / 400) | pool.js | Raise for denser bullet-hell |

## Common mistakes

1. **`new Bullet()` per shot** — GC stutter at 60+ shots/sec. Two pools,
   `acquire`/`release` only. (The #1 shmup performance bug.)
2. **One shared pool for player + enemy bullets** — they have different counts +
   collision targets; mixing them complicates hit tests and the cap. Two pools.
3. **Forgetting to cull off-screen bullets** — pool fills, `acquire()` returns
   null, no new bullets fire (the game looks "jammed"). Cull when `offScreen`.
4. **Player hitbox = sprite size** — every near-miss is a hit; the game feels
   unfair. Use a tiny center hitbox (~6px).
5. **Spread fan not centered on aim** — `i * step` skews the whole fan to one
   side. Center it: `t = (i/(n-1)) - 0.5`, angle `= base + t * arc`.
6. **Ignoring i-frames on player hit** — one bullet cluster drains all lives in a
   single frame. Gate player-hit checks behind `invuln <= 0` and grant invuln
   frames in `damagePlayer`.
7. **Homing bullets reading a dead/removed target** — guard `if (b.target && b.target.alive)`
   (or null the target on enemy death) or the steer math divides by a stale point.
8. **Pattern params hardcoded in patterns.js** — `count`/`speed`/`arc` belong in
   `bullet-patterns.json` so designers tune density without touching code.

## Reference

- `genres/shmup.md` §"Bullets — object pooling is MANDATORY", §"Shoot patterns",
  §"Player — aim direction" — the pattern table + pooling rule this implements.
- `runtime-patterns.md` §pooling, §AABB/circle collision.
- `recipes/shmup/enemy-waves.md` — assigns `shootScript` ids to spawned enemies
  and supplies the path scripts those enemies fly.

## Files NOT in this recipe

- Enemy spawning + formations + flight paths → `recipes/shmup/enemy-waves.md`
- Scrolling background the bullets fly over → `recipes/shmup/scrolling-bg.md`
- Player ship movement + lives + power-ups → `src/ship.js`
