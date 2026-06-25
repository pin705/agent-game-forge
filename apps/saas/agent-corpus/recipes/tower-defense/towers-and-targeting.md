# Recipe — Towers + targeting (placement, projectiles, slow/splash, upgrades)

Tower placement on buildable cells, a `data/towers.json` stat catalog
(cost / damage / range / fireRate / projectileKey), four targeting modes
(first / last / closest / strongest), pooled projectiles with optional
**splash** and **slow** effects, and per-tower **upgrade** levels.

This recipe gives you `src/towers.js`, `src/projectiles.js`, and
`src/build-mode.js`. It assumes `path-and-waves.md` is in place
(`state.enemies` carry `dist`, `hp`, `slowMul`/`slowTtl`, `pathProgress`).
Gold spend/refund + lives + win/loss live in `economy.md`.

Read the genre file `conventions/genres/tower-defense.md` ("Tower
targeting", "Projectiles — object pool") and `runtime-patterns.md` §5
(object pooling) first.

## When to use

- Path-based TD with click-to-place static towers on a grid
- 3-5 tower types (basic / splash / sniper / slow / rapid)
- Projectiles travel and hit one enemy (optionally splash on impact)
- 2-3 upgrade tiers per tower

## When NOT to use

- **Beam / instant-hit towers** (laser that ticks damage while a target
  is in range, no travel time) — fork `fire()`: apply damage directly on
  cooldown, skip the projectile entirely. Draw a line, don't spawn a
  bullet.
- **Hitscan with no projectile sprite** — same as above; this recipe
  assumes a traveling projectile you can see and pool.
- **Movable / player-controlled towers** (hero unit you drag around) —
  this is for static grid towers; a mobile hero is a separate entity with
  its own movement, closer to `top-down-rpg` controller code.
- **Aura / buff towers** (boost nearby towers, deal no damage) — fork:
  on update, loop towers in range and bump their `damage`/`fireRate`
  multiplier instead of finding an enemy.
- **No upgrades / no slow / no splash** — fine, just omit those blocks;
  the base place + first-target + projectile path stands alone.

## Files this affects

- `src/towers.js` — placement, target selection, fire timer (~280 LOC)
- `src/projectiles.js` — pooled spawn / travel / hit / splash (~180 LOC)
- `src/build-mode.js` — cursor follow, valid-cell highlight, click to
  place / select / upgrade / sell UI (~220 LOC)
- `data/towers.json` — IDENTITY catalog (stats + upgrade tree)
- `data/projectiles.json` — IDENTITY catalog (speed / splash / slow)
- `data/<level>.json` — `buildSpots[]` (preferred slots, drag-editable)
- `assets/sprites/towers/<id>/sprite.png`, `assets/sprites/projectiles/<id>/clean.png`

## Pattern

### 1. Tower catalog (data/towers.json)

One entry per tower type. `range` is pixels, `fireRate` is shots/sec,
`targeting` defaults to `first`. `upgrades[]` is the per-level delta —
each level overrides the live stats and adds its `cost` to the tower's
`invested` total (which drives the 70 % sell refund in `economy.md`).

```json
[
  {
    "id": "archer_roost",
    "name": "Archer Roost",
    "sprite": "assets/sprites/towers/archer_roost/sprite.png",
    "cost": 70,
    "damage": 7, "range": 200, "fireRate": 1.4,
    "projectile": "arrow",
    "targeting": "first",
    "upgrades": [
      { "level": 2, "cost": 60,  "damage": 12, "range": 220, "fireRate": 1.6 },
      { "level": 3, "cost": 120, "damage": 20, "range": 250, "fireRate": 1.9 }
    ]
  },
  {
    "id": "mortar",
    "name": "Mortar",
    "sprite": "assets/sprites/towers/mortar/sprite.png",
    "cost": 110,
    "damage": 18, "range": 240, "fireRate": 0.6,
    "projectile": "shell",
    "targeting": "strongest",
    "upgrades": [
      { "level": 2, "cost": 90,  "damage": 30, "range": 250, "fireRate": 0.7 },
      { "level": 3, "cost": 170, "damage": 48, "range": 280, "fireRate": 0.8 }
    ]
  },
  {
    "id": "frost_totem",
    "name": "Frost Totem",
    "sprite": "assets/sprites/towers/frost_totem/sprite.png",
    "cost": 90,
    "damage": 2, "range": 170, "fireRate": 1.0,
    "projectile": "frost_bolt",
    "targeting": "first",
    "upgrades": [
      { "level": 2, "cost": 80, "damage": 3, "range": 185, "fireRate": 1.1 }
    ]
  }
]
```

### 2. buildSpots — the editable slot layer (data/<level>.json)

The grid (`grid.js`, `isBuildable`) says where towers *can* go.
`buildSpots[]` is the curated, drag-editable set of slots the player
actually taps — a `rect` with an `allowed` whitelist. Each needs an `id`
(common.md; the Scene editor addresses it by id).

```json
"buildSpots": [
  { "id": "pad_01", "x": 96,  "y": 32,  "w": 64, "h": 64, "allowed": ["archer_roost", "frost_totem"] },
  { "id": "pad_02", "x": 352, "y": 224, "w": 64, "h": 64, "allowed": ["mortar", "archer_roost"] },
  { "id": "pad_03", "x": 608, "y": 32,  "w": 64, "h": 64, "allowed": ["archer_roost", "mortar", "frost_totem"] }
]
```

A spot is placeable if it's empty AND the chosen tower id is in `allowed`
AND the underlying cell is `isBuildable`. (If you want free placement on
any buildable cell, skip `buildSpots[]` and snap clicks to the grid via
`worldToGrid` — but the curated-slot model reads better and the editor
supports dragging the pads.)

### 3. Place a tower

```js
// src/towers.js
function placeTower(typeId, spot) {
  const type = byId("towers", typeId);
  if (!type) return false;
  if (!spot.allowed.includes(typeId)) return false;
  if (state.towers.some((t) => t.spotId === spot.id)) return false; // occupied
  if (!canAfford(type.cost)) return false;                          // economy.js
  spendGold(type.cost);                                             // economy.js

  state.towers.push({
    id: `t_${state.towerSeq++}`,
    typeId,
    spotId: spot.id,
    x: spot.x + spot.w / 2,
    y: spot.y + spot.h / 2,
    level: 1,
    damage: type.damage,
    range: type.range,
    fireRate: type.fireRate,
    projectile: type.projectile,
    targeting: type.targeting ?? "first",
    cooldown: 0,
    invested: type.cost,   // grows with upgrades → drives sell refund
    target: null,          // cached BetweenAcquisitions (see step 4)
  });
  return true;
}
```

### 4. Targeting — cache the target, refresh on cooldown

When a tower's cooldown hits zero, pick a target among in-range enemies by
`targeting` mode, fire, reset cooldown. **Do not re-scan every enemy every
frame** — only when the cooldown fires or the cached target died/left
range. `first` = furthest along the path (highest `pathProgress`, the
enemy closest to your exit), which is the genre-standard default.

```js
function updateTowers(dt) {
  for (const t of state.towers) {
    t.cooldown -= dt;

    // keep the cached target if still valid; else clear it
    if (t.target && (t.target.dead || !inRange(t, t.target))) t.target = null;

    if (t.cooldown <= 0) {
      if (!t.target) t.target = acquireTarget(t);
      if (t.target) {
        fireTower(t, t.target);
        t.cooldown = 1 / t.fireRate;   // fireRate is shots/sec
      }
    }
  }
}

function inRange(t, e) {
  return Math.hypot(e.x - t.x, e.y - t.y) <= t.range;
}

function acquireTarget(t) {
  let best = null;
  for (const e of state.enemies) {
    if (e.dead || !inRange(t, e)) continue;
    if (!best) { best = e; continue; }
    switch (t.targeting) {
      case "first":     if (e.pathProgress > best.pathProgress) best = e; break;
      case "last":      if (e.pathProgress < best.pathProgress) best = e; break;
      case "strongest": if (e.hp > best.hp) best = e; break;
      case "closest":
        if (Math.hypot(e.x - t.x, e.y - t.y) < Math.hypot(best.x - t.x, best.y - t.y)) best = e;
        break;
    }
  }
  return best;
}
```

`pathProgress` is a getter on the enemy — add it in `enemies.js` as
`e.dist / state.path.totalLength` (0 at spawn, 1 at exit). `path-and-waves.md`
already tracks `e.dist`; expose it as a derived value or compute inline.

### 5. Projectiles — pooled, with lead / splash / slow (data/projectiles.json)

Projectiles spawn constantly → pool them (genre file + runtime-patterns
§5). `homing` tracks the target each frame; otherwise the shot leads the
target's current velocity at fire time. `splashRadius` damages all enemies
near the impact; `slowMul` + `slowDuration` apply a speed debuff
(`path-and-waves.md` reads `e.slowMul`/`e.slowTtl`).

```json
[
  { "id": "arrow",     "sprite": "assets/sprites/projectiles/arrow/clean.png",     "speed": 620, "homing": false },
  { "id": "shell",     "sprite": "assets/sprites/projectiles/shell/clean.png",     "speed": 360, "homing": false, "splashRadius": 70 },
  { "id": "frost_bolt","sprite": "assets/sprites/projectiles/frost_bolt/clean.png","speed": 500, "homing": true,  "slowMul": 0.5, "slowDuration": 1.6 }
]
```

```js
// src/projectiles.js  (pooled — runtime-patterns §5)
const pool = [];
function getProjectile() { return pool.pop() || {}; }
function freeProjectile(p) { p.dead = true; pool.push(p); }

function fireTower(t, target) {           // called from towers.js
  const def = byId("projectiles", t.projectile);
  if (!def) return;
  const p = getProjectile();
  p.x = t.x; p.y = t.y;
  p.damage = t.damage;
  p.target = target;                      // enemy reference
  p.homing = !!def.homing;
  p.splashRadius = def.splashRadius ?? 0;
  p.slowMul = def.slowMul ?? 1;
  p.slowDuration = def.slowDuration ?? 0;
  p.sprite = def.sprite;
  p.dead = false;

  // initial heading: lead the target a little for non-homing shots
  const dist = Math.hypot(target.x - t.x, target.y - t.y);
  const flight = def.speed > 0 ? dist / def.speed : 0;
  const aimX = p.homing ? target.x : target.x + (target.lastVx || 0) * flight * 0.5;
  const aimY = p.homing ? target.y : target.y + (target.lastVy || 0) * flight * 0.5;
  const a = Math.atan2(aimY - t.y, aimX - t.x);
  p.vx = Math.cos(a) * def.speed;
  p.vy = Math.sin(a) * def.speed;
  state.projectiles.push(p);
  // playFireSfx(t.typeId);  // economy/audio hook
}

function updateProjectiles(dt) {
  for (const p of state.projectiles) {
    if (p.dead) continue;
    if (p.homing && p.target && !p.target.dead) {       // re-home each frame
      const a = Math.atan2(p.target.y - p.y, p.target.x - p.x);
      const sp = Math.hypot(p.vx, p.vy);
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;

    // off-map → recycle
    if (p.x < -40 || p.y < -40 || p.x > state.map.w + 40 || p.y > state.map.h + 40) {
      freeProjectile(p); continue;
    }
    // hit: target reference still alive and within a small radius
    const tgt = p.target;
    if (tgt && !tgt.dead && Math.hypot(tgt.x - p.x, tgt.y - p.y) <= 16) {
      applyHit(p, tgt);
      freeProjectile(p);
    }
  }
  state.projectiles = state.projectiles.filter((p) => !p.dead);
}

function applyHit(p, primary) {
  if (p.splashRadius > 0) {
    for (const e of state.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) <= p.splashRadius) damageEnemy(e, p);
    }
  } else {
    damageEnemy(primary, p);
  }
}

function damageEnemy(e, p) {
  e.hp -= p.damage;
  if (p.slowDuration > 0) { e.slowMul = Math.min(e.slowMul, p.slowMul); e.slowTtl = p.slowDuration; }
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    earnGold(e.reward);        // economy.js — kill reward
    notifyEnemyRemoved();      // waves.js — decrement alive count
  }
}
```

`damageEnemy` is the single kill point that pays gold + tells the wave
manager. `path-and-waves.md`'s `updateEnemies` filters `e.dead` out; this
sets the flag.

### 6. Upgrades

Look up the next-level row in `upgrades[]`, charge its cost, overwrite the
live stats, bump `invested`. Return false at max level.

```js
function nextUpgrade(t) {
  const type = byId("towers", t.typeId);
  return (type.upgrades || []).find((u) => u.level === t.level + 1) || null;
}
function upgradeTower(t) {
  const up = nextUpgrade(t);
  if (!up) return false;            // max level
  if (!canAfford(up.cost)) return false;
  spendGold(up.cost);               // economy.js
  t.level = up.level;
  t.damage = up.damage;
  t.range = up.range;
  t.fireRate = up.fireRate;
  t.invested += up.cost;            // raises sell refund
  return true;
}
```

### 7. Build mode (src/build-mode.js)

State machine over the canvas: `idle` → (pick tower from HUD) → `placing`
→ click a valid spot → back to `idle`; or click an existing tower →
`selected` (show range ring + upgrade/sell buttons).

```js
// state.build = { mode: "idle"|"placing"|"selected", pendingType: null, selected: null }
function onCanvasClick(mx, my) {
  const b = state.build;
  if (b.mode === "placing") {
    const spot = buildSpotAt(mx, my);                 // hit-test buildSpots[]
    if (spot && placeTower(b.pendingType, spot)) { b.mode = "idle"; b.pendingType = null; }
    return;
  }
  const tower = towerAt(mx, my);                      // hit-test towers
  if (tower) { b.mode = "selected"; b.selected = tower; return; }
  b.mode = "idle"; b.selected = null;                  // clicked empty → deselect
}

function onCancel() {              // right-click / ESC
  state.build.mode = "idle";
  state.build.pendingType = null;
  state.build.selected = null;
}

// While placing, draw a ghost tower + range ring at the hovered spot, tinted
// green if placeable (allowed + empty + affordable) else red. While selected,
// draw the tower's range ring + an Upgrade(cost) / Sell(refund) button row.
```

Render the range ring as a translucent circle (`ctx.arc`, fill alpha
~0.15, stroke ~0.3) — only during `placing`/`selected`, never for every
tower every frame.

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `cost` | towers.json | Placement price (economy.js gates on it) |
| `damage` / `fireRate` | towers.json | DPS (damage × fireRate) |
| `range` | towers.json | Targeting + projectile reach (px) |
| `targeting` | towers.json | `first` / `last` / `closest` / `strongest` |
| `projectile` | towers.json | Which projectiles.json entry it fires |
| `upgrades[]` | towers.json | Per-level stat deltas + costs |
| `speed` | projectiles.json | Travel speed (low = dodgeable / lobbed) |
| `homing` | projectiles.json | Track target vs lead-and-forget |
| `splashRadius` | projectiles.json | AoE radius on impact (0 = single) |
| `slowMul` / `slowDuration` | projectiles.json | Speed debuff strength + time |
| `allowed` | level buildSpots[] | Which towers fit a given pad |

## Common mistakes

1. **Re-scanning all enemies for all towers every frame.** O(towers ×
   enemies) per frame melts at scale. Cache `t.target`; only call
   `acquireTarget` when the cooldown fires or the cached target died/left
   range. (Genre file calls this out explicitly.)

2. **`fireRate` used as an interval.** `fireRate` is shots per *second*;
   the cooldown is `1 / fireRate`. Using `fireRate` directly as the
   cooldown makes a 1.4-shots/sec tower fire every 1.4 *seconds* — way too
   slow.

3. **Per-projectile `{}` allocation.** Spawning a fresh object per shot
   GC-stutters. Pool them (`getProjectile`/`freeProjectile`) — runtime
   §5. Reset every field on reuse or stale `splashRadius`/`slow` leaks
   into the next shot.

4. **Slow effects stacking multiplicatively forever.** Two frost towers
   shouldn't drive an enemy to 25 % then 12 %. Take the *strongest* slow
   (`Math.min(e.slowMul, p.slowMul)`) and refresh the timer, don't
   multiply. (OpenGame refreshes-not-stacks by effect id.)

5. **Splash damaging the primary target twice.** If you call
   `damageEnemy(primary)` AND then loop the splash radius (which includes
   the primary), it takes double damage. Branch: splash loops *all* in
   radius (primary included once), non-splash hits only the primary.

6. **Placing on an occupied / disallowed spot.** Always check all three:
   spot empty, `typeId in allowed`, underlying cell `isBuildable`. Missing
   the occupied check lets two towers stack on one pad.

7. **Forgetting to pay gold / refund on sell.** Placement and upgrade must
   `spendGold`; selling must refund `invested * sellRefundRate`. Track
   `invested` (base + every upgrade) on the tower or the refund is wrong —
   see `economy.md`.

8. **Range ring drawn for every tower every frame.** Cheap-looking and
   noisy. Draw it only for the hovered ghost (placing) and the selected
   tower.

## Reference

OpenGame `modules/tower_defense/src/towers/BaseTower.ts` — `findTarget`
(the four modes), `fire` (lead-shot prediction + homing flag), `upgrade`,
`invested` tracking, hover range circle. `enemies/BaseTDEnemy.ts` —
`pathProgress` getter (drives `first`/`last`) and the slow status-effect
system (refresh-not-stack). `utils.ts` — `createProjectile` /
`launchProjectileAt` / `createRangeIndicator` / `PROJECTILE_SIZES`. Ported
to vanilla Canvas: Phaser physics groups → `state.towers` /
`state.projectiles` arrays, `setVelocity` → manual `vx/vy` integration,
the tween fire-pulse → optional scale tween in render, `setInteractive`
pointer events → canvas click hit-testing in build-mode.js.
