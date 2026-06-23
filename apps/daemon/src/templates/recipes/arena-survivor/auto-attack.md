# Recipe — Auto-attack weapons (arena survivor)

Implements VS-style **auto-firing weapons**: the player never aims or presses
attack. Each weapon runs its own cooldown timer and fires automatically using a
per-kind targeting pattern (forward / ring / orbit / area / homing). Projectiles
are object-pooled and collision-checked against pooled enemies.

## When to use

- Arena-survivor genre — Vampire Survivors / Brotato auto-combat
- Player carries 1-6 weapons that all fire on their own cadence
- No manual aim, no click-to-shoot — targeting is automatic per weapon
- Weapon list lives in `data/weapons.json` (catalog) + `state.player.weapons` (owned)

## When NOT to use

- **Manual-aim twin-stick** — player aims with mouse; that's a different control
  scheme (not arena-survivor's signature). Write a click/aim path instead.
- **Shmup fixed-direction shooting** — player ship fires forward only; use
  `recipes/shmup/bullet-patterns.md` (the shooter, not the weapon, owns the
  pattern there).
- **Turn-based / melee-FSM combat** — use the top-down-rpg battle recipe.

## Files this affects

- `src/weapons.js` — weapon timers + targeting + fire (~300-500 LOC)
- `src/pool.js` — projectile pool (MANDATORY)
- `data/weapons.json` — IDENTITY: weapon catalog (id, kind, sprite)
- `data/weapon-stats.json` — TUNING: per-weapon cooldown, damage, speed, level curve
- `src/enemies.js` — provides `state.enemies`; weapons read positions, deal damage

## Dependencies on foundation

```js
// state.js
state.player = { x, y, facing: { x: 1, y: 0 }, weapons: ["magic_wand"], ... };
state.projectiles = [];       // live pooled projectiles
state.enemies = [];           // from spawner/enemies.js
```

Projectile pool (per `runtime-patterns.md` §pooling — never `new` in the fire loop):

```js
const projPool = makePool(300, () => ({
  alive: false, weaponId: null, x: 0, y: 0, vx: 0, vy: 0,
  damage: 0, radius: 6, life: 0, pierce: 0, target: null,
  // orbit-only:
  orbitAngle: 0, orbitDist: 0
}));
```

## Catalog + tuning

`data/weapons.json` (IDENTITY — what a weapon IS, by name):

```json
[
  { "id": "magic_wand", "name": "Magic Wand", "kind": "forward",
    "sprite": "assets/sprites/weapons/magic_wand/sheet.png" },
  { "id": "garlic",     "name": "Garlic",     "kind": "area",
    "sprite": "assets/sprites/weapons/garlic/sheet.png" },
  { "id": "knives",     "name": "Throwing Knives", "kind": "ring",
    "sprite": "assets/sprites/weapons/knives/sheet.png" },
  { "id": "axe",        "name": "Axe",        "kind": "homing",
    "sprite": "assets/sprites/weapons/axe/sheet.png" },
  { "id": "bible",      "name": "Orbit Tome", "kind": "orbit",
    "sprite": "assets/sprites/weapons/bible/sheet.png" }
]
```

`data/weapon-stats.json` (TUNING — plain JSON, no `{value:}` wrapper). One entry
per weapon id; `level[]` is the per-level upgrade curve (used by the level-up
recipe):

```json
{
  "magic_wand": { "cooldown": 1.2, "damage": 5,  "speed": 420, "projectiles": 1, "pierce": 0,
                  "level": [ { "damage": 7 }, { "projectiles": 2 }, { "cooldown": 0.9 } ] },
  "garlic":     { "cooldown": 0.0, "damage": 1,  "radius": 96, "tickEvery": 0.5,
                  "level": [ { "radius": 120 }, { "damage": 2 }, { "tickEvery": 0.35 } ] },
  "knives":     { "cooldown": 1.6, "damage": 4,  "speed": 500, "count": 6,
                  "level": [ { "count": 8 }, { "damage": 6 }, { "cooldown": 1.2 } ] },
  "axe":        { "cooldown": 2.5, "damage": 12, "speed": 300, "projectiles": 3, "turnRate": 5,
                  "level": [ { "projectiles": 4 }, { "damage": 18 }, { "turnRate": 8 } ] },
  "bible":      { "cooldown": 0.0, "damage": 3,  "orbitDist": 90, "orbitSpeed": 3, "count": 2,
                  "level": [ { "count": 3 }, { "orbitDist": 120 }, { "damage": 5 } ] }
}
```

## Pattern

### 1. Per-weapon runtime timers

`state.player.weapons` holds owned weapon ids. Keep a parallel timer map keyed
by id (don't store the timer on the catalog — catalog is shared/immutable).

```js
// src/weapons.js
const weaponTimers = {};   // { magic_wand: 0.3, axe: 1.1, ... }

function initWeapons() {
  for (const id of state.player.weapons) weaponTimers[id] = 0;
}

function ownWeapon(id) {                 // called by level-up
  if (!state.player.weapons.includes(id)) {
    state.player.weapons.push(id);
    weaponTimers[id] = 0;
  }
}
```

### 2. Cached target acquisition (don't scan 300 enemies every frame, per weapon)

`closestEnemy` is O(n). With 200+ enemies and several weapons, refresh the
cached target only every ~0.2s, not every frame (per `genres/arena-survivor.md`).

```js
let cachedTarget = null, targetTimer = 0;

function nearestEnemy() {
  let best = null, bestD = Infinity;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const d = (e.x - state.player.x) ** 2 + (e.y - state.player.y) ** 2;  // squared, no sqrt
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function refreshTarget(dt) {
  targetTimer -= dt;
  if (targetTimer <= 0 || !cachedTarget || !cachedTarget.alive) {
    cachedTarget = nearestEnemy();
    targetTimer = 0.2;
  }
}
```

### 3. Main update — tick each weapon, fire when ready

```js
function updateWeapons(dt) {
  refreshTarget(dt);
  for (const id of state.player.weapons) {
    const def = byId("weapons", id);
    const st = scaledWeapon(id);          // tuning + level merged (see step 6)
    weaponTimers[id] -= dt;

    if (def.kind === "orbit") {
      ensureOrbiters(id, st);             // orbiters persist; no cooldown fire
      continue;
    }
    if (def.kind === "area") {
      tickArea(id, st, dt);               // continuous aura, ticks on tickEvery
      continue;
    }
    if (weaponTimers[id] <= 0) {
      fireWeapon(def, st);
      weaponTimers[id] = st.cooldown;
    }
  }
  updateProjectiles(dt);
}
```

### 4. Fire — one dispatch per kind

```js
function fireWeapon(def, st) {
  const p = state.player;
  switch (def.kind) {
    case "forward": {
      // toward nearest enemy if any, else player facing
      const dir = cachedTarget ? norm(cachedTarget.x - p.x, cachedTarget.y - p.y)
                               : { x: p.facing.x, y: p.facing.y };
      const n = st.projectiles ?? 1;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.12;       // fan if >1
        const d = rotate(dir, spread);
        spawnProjectile(def.id, p.x, p.y, d.x * st.speed, d.y * st.speed, st);
      }
      break;
    }
    case "ring": {
      const n = st.count ?? 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        spawnProjectile(def.id, p.x, p.y, Math.cos(a) * st.speed, Math.sin(a) * st.speed, st);
      }
      break;
    }
    case "homing": {
      const n = st.projectiles ?? 1;
      for (let i = 0; i < n; i++) {
        const pr = spawnProjectile(def.id, p.x, p.y, 0, 0, st);
        if (pr) pr.target = nthEnemy(i);   // each missile gets a distinct target
      }
      break;
    }
  }
}

function spawnProjectile(weaponId, x, y, vx, vy, st) {
  const pr = projPool.acquire();
  if (!pr) return null;
  pr.alive = true; pr.weaponId = weaponId;
  pr.x = x; pr.y = y; pr.vx = vx; pr.vy = vy;
  pr.damage = st.damage; pr.radius = st.radius ?? 6;
  pr.life = st.life ?? 2.5; pr.pierce = st.pierce ?? 0;
  pr.turnRate = st.turnRate ?? 0; pr.target = null;
  state.projectiles.push(pr);
  return pr;
}
```

### 5. Update projectiles — move, home, collide, expire

```js
function updateProjectiles(dt) {
  for (const pr of state.projectiles) {
    if (!pr.alive) continue;

    // homing: steer velocity toward target
    if (pr.turnRate > 0 && pr.target && pr.target.alive) {
      const want = norm(pr.target.x - pr.x, pr.target.y - pr.y);
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      pr.vx += (want.x * sp - pr.vx) * Math.min(1, dt * pr.turnRate);
      pr.vy += (want.y * sp - pr.vy) * Math.min(1, dt * pr.turnRate);
    }

    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    pr.life -= dt;
    if (pr.life <= 0) { pr.alive = false; continue; }

    // collide vs enemies (circle vs circle)
    for (const e of state.enemies) {
      if (!e.alive) continue;
      const rr = (pr.radius + (e.size?.w ?? 40) / 2);
      if ((e.x - pr.x) ** 2 + (e.y - pr.y) ** 2 <= rr * rr) {
        damageEnemy(e, pr.damage);          // enemies.js: hp -= dmg, hurtTimer, death→XP
        if (pr.pierce > 0) { pr.pierce--; }  // pierce passes through
        else { pr.alive = false; break; }
      }
    }
  }
}
```

### 6. Orbit + area weapons (no cooldown — persistent)

```js
// ORBIT: N projectiles circle the player forever; recreate when count changes
function ensureOrbiters(id, st) {
  const live = state.projectiles.filter(p => p.alive && p.weaponId === id);
  while (live.length < st.count) {
    const pr = spawnProjectile(id, state.player.x, state.player.y, 0, 0, st);
    if (!pr) break;
    pr.life = Infinity; pr.orbitDist = st.orbitDist;
    pr.orbitAngle = (live.length / st.count) * Math.PI * 2;
    live.push(pr);
  }
  // position update each frame:
  let i = 0;
  for (const pr of live) {
    pr.orbitAngle += st.orbitSpeed * (1 / 60);
    pr.x = state.player.x + Math.cos(pr.orbitAngle) * pr.orbitDist;
    pr.y = state.player.y + Math.sin(pr.orbitAngle) * pr.orbitDist;
    i++;
  }
}

// AREA (garlic): damage all enemies within radius on a tick timer
function tickArea(id, st, dt) {
  weaponTimers[id] -= dt;
  if (weaponTimers[id] > 0) return;
  weaponTimers[id] = st.tickEvery;
  const r2 = st.radius * st.radius;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    if ((e.x - state.player.x) ** 2 + (e.y - state.player.y) ** 2 <= r2) {
      damageEnemy(e, st.damage);
    }
  }
}
```

### 7. Level-merged stats (`scaledWeapon`)

The level-up recipe increments `state.player.weaponLevel[id]`. Merge the base
tuning with each applied level patch so upgrades stack:

```js
function scaledWeapon(id) {
  const base = WEAPON_STATS[id];
  const lvl = state.player.weaponLevel?.[id] ?? 0;
  let merged = { ...base };
  for (let i = 0; i < lvl && i < (base.level?.length ?? 0); i++) {
    merged = { ...merged, ...base.level[i] };   // each level patch overrides
  }
  return merged;
}
```

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `kind` | weapons.json | forward / ring / orbit / area / homing |
| `cooldown` | weapon-stats.json | Seconds between fires (0 = persistent kinds) |
| `damage` | weapon-stats.json | Per-hit damage |
| `projectiles` / `count` | weapon-stats.json | Shots per fire / orbiters / ring size |
| `pierce` | weapon-stats.json | How many enemies a shot passes through |
| `turnRate` | weapon-stats.json | Homing steer strength (0 = straight) |
| `level[]` | weapon-stats.json | Per-level upgrade patches (level-up recipe applies) |
| target refresh `0.2` | weapons.js | Lower = more responsive aim, more CPU |

## Common mistakes

1. **`closestEnemy()` every frame for every projectile** — quadratic with 200+
   enemies. Cache the target per ~0.2s; use squared distance (no `Math.sqrt`).
2. **`new` projectile per shot** — GC stutter at high fire rate. Pool, always.
3. **Storing the cooldown timer on the catalog object** — the catalog is shared;
   mutating it corrupts all instances. Keep timers in a separate `weaponTimers`
   map keyed by id.
4. **Orbit/area weapons given a cooldown fire path** — they're persistent, not
   one-shot. Orbit projectiles live forever (`life: Infinity`) and only their
   *position* updates; area weapons tick on `tickEvery`, not `cooldown`.
5. **Homing missiles all targeting the single nearest enemy** — they overlap and
   waste damage. Give each the i-th nearest (`nthEnemy(i)`).
6. **Forgetting `pierce` decrement** — a piercing shot either kills one and dies
   (pierce ignored) or never dies (passes through everything). Decrement pierce
   on each hit; kill the projectile when pierce hits 0.
7. **Spread fan math centered wrong** — `(i - (n-1)/2) * spread` centers an odd
   or even fan on the aim direction. `i * spread` skews the whole fan to one side.
8. **Weapon stats hardcoded in weapons.js** — cooldown/damage belong in
   `weapon-stats.json` so balance + level curves are data, not code.

## Reference

- `genres/arena-survivor.md` §"Player attacks — auto-target, weapon timers" —
  the weapon-kind table + caching guidance this recipe implements.
- `runtime-patterns.md` §pooling, §AABB/circle collision.
- `recipes/arena-survivor/xp-and-levelup.md` — supplies `state.player.weaponLevel`
  and calls `ownWeapon(id)` when the player picks a new weapon.

## Files NOT in this recipe

- Damage application + enemy death → `src/enemies.js` (`damageEnemy`)
- XP drop on kill + level-up card screen → `recipes/arena-survivor/xp-and-levelup.md`
- Enemy spawning → `recipes/arena-survivor/wave-spawner.md`
