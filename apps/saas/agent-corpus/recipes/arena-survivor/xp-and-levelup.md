# Recipe — XP orbs + level-up upgrade cards (arena survivor)

Implements the VS meta-loop: enemies drop **XP orbs**, orbs fly to the player
within a magnet radius, accumulated XP crosses a rising curve → the game
**pauses and shows 3 upgrade cards** → the player picks one → effect applies →
play resumes. This is the build-expression engine that makes runs feel
different.

## When to use

- Arena-survivor genre — Vampire Survivors / Brotato progression
- Kills drop XP; XP fills a bar; level-up pauses for a 3-of-N upgrade pick
- Upgrades = stat boosts, new weapons, or weapon evolutions
- Upgrade pool lives in `data/upgrades.json`; XP curve in `data/level-curve.json`

## When NOT to use

- **Per-monster leveling (Pokemon-style)** — each captured creature levels
  separately. Use `recipes/top-down-rpg/progression.md` instead.
- **No meta-progression** (pure score-attack arena) — drop this recipe; just
  count score and kills in the HUD.
- **Shop-between-waves (Brotato strict)** — if upgrades are bought with currency
  at a between-wave shop rather than picked free on level-up, fork: keep the XP
  orb + currency code, replace the level-up card screen with a shop screen.

## Files this affects

- `src/xp.js` — XP orb spawn/magnet/collect + level threshold check (~100-200 LOC)
- `src/levelup.js` — pause + 3-card pick screen + apply effect (~200-400 LOC)
- `src/pool.js` — XP-orb pool (orbs are numerous; pool them)
- `data/upgrades.json` — IDENTITY: upgrade card catalog
- `data/level-curve.json` — TUNING: XP-per-level curve, magnet radius, card count
- `src/enemies.js` — calls `dropXp(e.x, e.y, def.xp)` on enemy death
- `src/weapons.js` — `ownWeapon(id)` + `state.player.weaponLevel` (from auto-attack recipe)

## Dependencies on foundation

```js
// state.js
state.mode = "playing";              // "playing" | "levelup"  (pauses the sim)
state.player = {
  x, y, hp, maxHp, speed, magnetRadius: 90,
  xp: 0, level: 1, weapons: ["magic_wand"], weaponLevel: {}
};
state.xpOrbs = [];                   // live pooled orbs
state.levelup = null;                // { choices: [...] } when mode === "levelup"
```

XP-orb pool (per `runtime-patterns.md` §pooling):

```js
const orbPool = makePool(500, () => ({ alive: false, x: 0, y: 0, value: 1 }));
```

## Tuning + catalog

`data/level-curve.json` (TUNING — plain JSON, no `{value:}` wrapper):

```json
{
  "xpBase": 5,
  "xpExponent": 1.35,
  "magnetRadius": 90,
  "magnetSpeed": 600,
  "collectRadius": 20,
  "cardsPerLevel": 3
}
```

`data/upgrades.json` (IDENTITY — every entry has an `id`; `weight` skews the
random draw; `kind` dispatches the effect):

```json
[
  { "id": "up_maxhp",    "name": "+20 Max HP",      "kind": "stat",    "stat": "maxHp",  "amount": 20, "weight": 10 },
  { "id": "up_speed",    "name": "+10% Move Speed", "kind": "stat",    "stat": "speed",  "mult": 1.10, "weight": 8 },
  { "id": "up_magnet",   "name": "+40 Pickup Range","kind": "stat",    "stat": "magnetRadius", "amount": 40, "weight": 6 },
  { "id": "up_axe",      "name": "New Weapon: Axe", "kind": "weapon",  "weapon": "axe",  "weight": 5 },
  { "id": "up_wand_lvl", "name": "Magic Wand +1",   "kind": "weaponLevel", "weapon": "magic_wand", "weight": 7 },
  { "id": "up_heal",     "name": "Heal 40 HP",      "kind": "heal",    "amount": 40, "weight": 4, "repeatable": true }
]
```

## Pattern

### 1. Drop an XP orb on enemy death (called from enemies.js)

```js
// src/xp.js
function dropXp(x, y, value) {
  const o = orbPool.acquire();
  if (!o) return;                 // pool full → silently skip (rare)
  o.alive = true; o.x = x; o.y = y; o.value = value;
  state.xpOrbs.push(o);
}
```

`enemies.js` `damageEnemy` → on death calls `dropXp(e.x, e.y, def.xp ?? 1)`.
Put `xp` per enemy in the catalog (`data/enemies.json`), so a tank is worth more
than a bat.

### 2. Magnet + collect (orbs accelerate toward the player inside the radius)

```js
function updateXpOrbs(dt) {
  const p = state.player;
  const mr2 = p.magnetRadius * p.magnetRadius;
  const cr2 = LEVEL_CURVE.collectRadius * LEVEL_CURVE.collectRadius;
  for (const o of state.xpOrbs) {
    if (!o.alive) continue;
    const dx = p.x - o.x, dy = p.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < mr2) {
      const d = Math.sqrt(d2) || 1;
      o.x += (dx / d) * LEVEL_CURVE.magnetSpeed * dt;
      o.y += (dy / d) * LEVEL_CURVE.magnetSpeed * dt;
    }
    if (d2 < cr2) {
      o.alive = false;            // compaction returns it to the pool
      gainXp(o.value);
    }
  }
}
```

### 3. XP curve + level-up trigger

```js
function xpForLevel(level) {
  // rising curve: lvl 2 ≈ 5, lvl 10 ≈ 110, lvl 30 ≈ 560
  const base = LEVEL_CURVE.xpBase, exp = LEVEL_CURVE.xpExponent;
  return Math.round(base * Math.pow(level, exp));
}

function gainXp(amount) {
  const p = state.player;
  p.xp += amount;
  // could cross multiple levels from one big orb dump → loop
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level += 1;
    triggerLevelUp();             // opens the card screen (queues if already open)
  }
}
```

> **Pause is a mode flip, not a timer freeze.** Setting `state.mode = "levelup"`
> makes the game loop skip the sim update. Don't try to stop `requestAnimationFrame`
> — keep rendering (you draw the cards over a dimmed frozen scene), just gate the
> sim. See step 6.

### 4. Open the level-up screen — draw 3 weighted-random cards

```js
// src/levelup.js
let pendingLevelUps = 0;          // queue: multiple level-ups in one frame

function triggerLevelUp() {
  pendingLevelUps++;
  if (state.mode !== "levelup") openLevelUp();
}

function openLevelUp() {
  state.mode = "levelup";
  const n = LEVEL_CURVE.cardsPerLevel;
  state.levelup = { choices: drawChoices(n), index: 0 };
  playSound("level");
}

function drawChoices(n) {
  // eligible = not-yet-maxed, weighted; sample without replacement
  const pool = CATALOG.upgrades.filter(isEligible);
  const picks = [];
  const bag = pool.slice();
  for (let k = 0; k < n && bag.length; k++) {
    const total = bag.reduce((s, u) => s + (u.weight ?? 1), 0);
    let r = Math.random() * total, i = 0;
    while (r > 0 && i < bag.length) { r -= bag[i].weight ?? 1; if (r > 0) i++; }
    picks.push(bag[i]);
    bag.splice(i, 1);             // without replacement → no dup cards
  }
  return picks;
}

function isEligible(u) {
  if (u.kind === "weapon") return !state.player.weapons.includes(u.weapon);   // hide owned weapons
  if (u.kind === "weaponLevel") {
    const lvl = state.player.weaponLevel[u.weapon] ?? 0;
    const max = WEAPON_STATS[u.weapon]?.level?.length ?? 0;
    return state.player.weapons.includes(u.weapon) && lvl < max;              // owned + not maxed
  }
  return true;                    // stat/heal always eligible
}
```

### 5. Apply the chosen upgrade

```js
function chooseUpgrade(idx) {
  const u = state.levelup.choices[idx];
  applyUpgrade(u);
  closeLevelUp();
}

function applyUpgrade(u) {
  const p = state.player;
  switch (u.kind) {
    case "stat":
      if (u.amount != null) p[u.stat] = (p[u.stat] ?? 0) + u.amount;
      if (u.mult   != null) p[u.stat] = (p[u.stat] ?? 0) * u.mult;
      if (u.stat === "maxHp") p.hp += u.amount ?? 0;     // grant the new HP too
      break;
    case "heal":
      p.hp = Math.min(p.maxHp, p.hp + u.amount);
      break;
    case "weapon":
      ownWeapon(u.weapon);                               // weapons.js
      break;
    case "weaponLevel":
      p.weaponLevel[u.weapon] = (p.weaponLevel[u.weapon] ?? 0) + 1;
      break;
  }
}

function closeLevelUp() {
  pendingLevelUps--;
  if (pendingLevelUps > 0) openLevelUp();   // chain remaining queued level-ups
  else { state.levelup = null; state.mode = "playing"; }
}
```

### 6. Wiring — gate the sim, route input, draw the cards

```js
// src/game.js main loop:
function update(dt) {
  if (state.mode === "levelup") return;   // freeze the sim; cards are modal
  updateSpawner(dt); updateEnemies(dt); updateWeapons(dt);
  updateXpOrbs(dt);  updatePlayer(dt);    // etc.
}

// input.js — when mode === "levelup", arrows move selection, Enter/click picks:
function onLevelUpKey(key) {
  const lu = state.levelup;
  if (key === "ArrowLeft")  lu.index = (lu.index + lu.choices.length - 1) % lu.choices.length;
  if (key === "ArrowRight") lu.index = (lu.index + 1) % lu.choices.length;
  if (key === "Enter" || key === " ") chooseUpgrade(lu.index);
}

// render.js — HUD is direct canvas (per common.md: the canvas IS the UI):
function drawLevelUp(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);                // dim the frozen scene
  const lu = state.levelup;
  const cardW = 220, gap = 24;
  const totalW = lu.choices.length * cardW + (lu.choices.length - 1) * gap;
  let x = (VIEW.w - totalW) / 2, y = VIEW.h / 2 - 140;
  lu.choices.forEach((u, i) => {
    ctx.fillStyle = (i === lu.index) ? "#ffd54a" : "#2b2b3a";
    ctx.fillRect(x, y, cardW, 280);
    ctx.fillStyle = (i === lu.index) ? "#1b1b1b" : "#fff";
    ctx.font = "20px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(u.name, x + cardW / 2, y + 150);
    x += cardW + gap;
  });
}
```

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `xpBase` / `xpExponent` | level-curve.json | Curve shape (gentle 1.3 casual, steep 1.8 grind) |
| `magnetRadius` (player) | level-curve.json + state | Pickup range (also upgradable via a card) |
| `magnetSpeed` | level-curve.json | How fast orbs fly in |
| `cardsPerLevel` | level-curve.json | 3 typical; 4 = more choice; 2 = harsher |
| `weight` per upgrade | upgrades.json | Draw frequency (rarer evolutions get low weight) |
| `repeatable` | upgrades.json | Whether a maxed-feeling card can re-appear |
| enemy `xp` | enemies.json | Per-enemy orb value (tank worth more than fodder) |

## Common mistakes

1. **Freezing the loop with `cancelAnimationFrame`** — then input + render stop
   too, so the cards never draw and you can't pick. Gate the *sim* with a mode
   flag; keep rendering.
2. **Drawing cards WITH replacement** — same upgrade appears twice in one pick.
   Sample without replacement (`bag.splice`).
3. **Showing owned weapons / maxed upgrades** — dead picks that waste a card
   slot. Filter via `isEligible` before drawing.
4. **Single level-up when XP overflows two levels** — one giant orb dump levels
   you 2×, but you only get one card. Loop the threshold in `gainXp`, queue the
   extra level-ups (`pendingLevelUps`), chain them in `closeLevelUp`.
5. **`new` per XP orb** — orbs are dropped by the hundred. Pool them.
6. **Magnet uses `Math.sqrt` for every orb every frame** — compare squared
   distances; only take the sqrt for orbs actually inside the magnet radius.
7. **`maxHp` upgrade doesn't grant current HP** — player's max goes up but they
   stay at old HP, so the upgrade feels worthless mid-fight. Add the delta to
   `hp` too.
8. **Upgrade effects hardcoded as `if (id === "up_axe")`** — brittle. Dispatch on
   `kind` + read `stat`/`amount`/`weapon` from the catalog so new cards are pure
   data (add a row in `upgrades.json`, no code change).

## Reference

- `genres/arena-survivor.md` §"Pickups — magnet radius", §"Catalog patterns"
  (`upgrades.json`, `level-curve.json`).
- `recipes/top-down-rpg/progression.md` — the XP-curve + stat-growth shape this
  recipe mirrors (that one is per-partner; this one is the single-run player).
- `runtime-patterns.md` §pooling.

## Files NOT in this recipe

- Weapon stats + the `level[]` curve a `weaponLevel` upgrade steps through →
  `recipes/arena-survivor/auto-attack.md` (`scaledWeapon`, `ownWeapon`)
- Enemy death that calls `dropXp` → `src/enemies.js`
- Enemy spawning → `recipes/arena-survivor/wave-spawner.md`
