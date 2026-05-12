# Genre — Tower defense

Kingdom Rush, Bloons-style. Path-based enemy waves, grid tower placement, single-screen camera (or limited scroll).

**Canonical reference**: [Phaser official Tower Defense tutorial](https://gamedevacademy.org/how-to-make-tower-defense-game-with-phaser-3/) — covers grid + polyline path + wave + targeting in one file. Read it for the PATTERN. For pathfinding theory if path becomes dynamic: [Red Blob Games](https://www.redblobgames.com/pathfinding/tower-defense/).

> ⚠️ **OGF projects do NOT use Phaser** — vanilla Canvas 2D only. References are pattern inspiration. See `runtime-patterns.md` for the Phaser → vanilla translation table. The code samples below are already vanilla canvas; copy those, not Phaser snippets from the linked tutorials.

This file assumes you've read `runtime-patterns.md` (delta time, AABB, FSM, **object pooling** for projectiles).

## Generation procedure — view_image + skill call as paired tool_uses

EVERY `generate2dmap` / `generate2dsprite` call MUST be preceded by `view_image` of the closest existing reference, in the SAME message. See `common.md` "Visual consistency" for the canonical pattern + reasoning.

```
Phase 2 (map background — single image with path painted in):
  tool_use 1: view_image .ogf/style-anchor.png
  tool_use 2: generate2dmap reference: 'generated_image'
              prompt: "[STYLE...] [VIEW: top-down 3/4...] tower-
                       defense map background with the enemy path
                       visibly drawn (cobblestone road / dirt
                       trail) following these waypoints: ..."

Phase 3+ (towers, enemies — reference anchor for first; reference prior tower for tower family):
  tool_use 1: view_image .ogf/style-anchor.png    ← first tower
              (or assets/sprites/towers/archer/sprite.png ← later towers, same family)
  tool_use 2: generate2dsprite reference: 'generated_image'
```

Skipping view_image → blind generation → degenerate output, towers don't share a visual family, enemies clash with map palette.

### Process strategy for tower / enemy / boss action sheets

When you run `scripts/generate2dsprite.py process` on tower / enemy / boss sheets, use **`--scale-strategy preserve --align feet`** for ALL their actions. Same tower / enemy = same strategy across every sheet. `fit` is for: projectiles (arrows, cannon balls, magic bolts), hit-spark / impact FX, UI sprites. See `common.md` and `generate2dsprite/SKILL.md` for the full rule.

## Level data — hybrid: grid + polyline path

TD doesn't fit Tiled/LDtk well — the path is a graph, not tiles. Use custom JSON:

```json
{
  "id": "guandu_pass",
  "mapSize":  { "width": 1280, "height": 720 },
  "viewport": { "width": 1280, "height": 720 },
  "background": "assets/maps/guandu_pass/background.png",
  "camera":  { "mode": "locked", "x": 0, "y": 0, "w": 1280, "h": 720 },

  "grid":    { "cellSize": 64, "cols": 20, "rows": 11 },

  "paths": [
    {
      "id": "main_road",
      "points": [
        { "x": -40,  "y": 342 },   // off-screen spawn
        { "x": 290,  "y": 410 },
        { "x": 605,  "y": 505 },
        { "x": 895,  "y": 265 },
        { "x": 1320, "y": 280 }    // off-screen goal
      ]
    }
  ],

  "buildSpots": [
    { "id": "pad_archer_01", "x": 134, "y": 154, "w": 72, "h": 72,
      "allowed": ["archer_roost", "strategist_drum"] },
    { "id": "pad_fire_01",   "x": 327, "y": 267, "w": 76, "h": 76,
      "allowed": ["fire_pot_tower", "archer_roost"] }
  ],

  "waves": [
    { "delay": 1.0, "groups": [{ "type": "scout", "count": 8,  "interval": 0.75 }] },
    { "delay": 4.0, "groups": [{ "type": "scout", "count": 12, "interval": 0.58 }] },
    { "delay": 5.0, "groups": [
      { "type": "scout",      "count": 8, "interval": 0.6 },
      { "type": "saboteur",   "count": 4, "interval": 1.1 }
    ]}
  ],

  "heroSpawn": { "x": 610, "y": 580 }
}
```

`paths[]` is plural array (not singular object). Each path is a polyline (line segments). **Don't use bezier** — Kingdom Rush's smoothness comes from rendering curved tiles ON TOP of straight segments, not from bezier path math.

`buildSpots` is rect (`x, y, w, h`), not radius. Player taps a spot to open the tower picker.

## Camera — static

TD levels typically fit one screen. `camera.mode = locked`, `mapSize === viewport`. If the level is wider, optional drag-to-pan with bounds — no follow.

## Enemy movement — path follower

Each enemy has a parameter `t ∈ [0, 1]` representing progress along the path. Each frame:

```js
function updateEnemy(e, path, dt) {
  e.t += (e.speed * dt) / path.totalLength;
  if (e.t >= 1) {
    // reached goal — leak life or despawn
    return 'goal';
  }
  const point = pointAlongPath(path, e.t);
  e.x = point.x;
  e.y = point.y;
  e.facing = pathTangent(path, e.t); // direction of next segment
}

// pointAlongPath: walk path segments, return interpolated point
function pointAlongPath(path, t) {
  const target = t * path.totalLength;
  let acc = 0;
  for (let i = 1; i < path.points.length; i++) {
    const segLen = dist(path.points[i-1], path.points[i]);
    if (acc + segLen >= target) {
      const local = (target - acc) / segLen;
      return lerpPoint(path.points[i-1], path.points[i], local);
    }
    acc += segLen;
  }
  return path.points[path.points.length - 1];
}
```

Cache `path.totalLength` once on level load. Don't recompute every frame.

## Tower targeting — first by default

When a tower's cooldown expires, pick a target. Default policy: **first** (enemy with highest `t` along path — closest to goal). Other policies: nearest (least distance), strongest (highest HP), weakest (lowest HP). Make the policy a tower stat:

```json
{ "id": "archer_roost", "range": 220, "cooldown": 1.0,
  "damage": 1, "targeting": "first", "projectile": "arrow" }
```

**Anti-pattern**: recompute target every frame for every tower for every enemy → O(towers × enemies × cooldown_frames). Cache target per tower; refresh only on cooldown trigger or when target dies.

For very large enemy counts, use spatial hashing (grid bucket of enemies). Premature for V1.

## Projectiles — object pool

Bullets/arrows spawn frequently → use a pool (see `runtime-patterns.md` §5).

```json
{ "id": "arrow", "speed": 800, "damage": 1, "homing": false }
```

Homing: arrow tracks its target each frame. Ballistic: arrow fires toward the target's predicted position at fire time, no further tracking.

## Wave timeline

`waves[]` plays sequentially. Each wave has `delay` (seconds before THIS wave starts after the previous wave's last spawn). Each wave has `groups[]` — concurrent spawn batches.

Skip / fast-forward UI: standard TD QoL. Convention spec records "wave timing is editable in OGF Scene tab Timeline view (when shipped)" — for V1, hand-edit the JSON.

## Catalog patterns

```
data/
  enemies.json       ← scout, saboteur, boss
  towers.json        ← archer_roost, fire_pot_tower, strategist_drum
  projectiles.json   ← arrow, fire_pot, drum_wave
  pickups.json       ← rare; some TDs have power-ups
  waves.json         ← optional; usually inline in level
  levels.json        ← registry
  guandu_pass.json   ← per-level (path + buildSpots + waves)
```

## Common pitfalls

1. **Bezier paths** — oversold. Polyline + curved-tile render is the standard.
2. **Storing path as grid waypoints with cardinal-only segments** — looks blocky. Use direct polyline with diagonals; render curved tiles on top if needed.
3. **Recomputing tower target every frame** — quadratic. Cache + invalidate.
4. **Tower placement allowing overlap** — always check `buildSpots[].allowed` AND that the spot is unoccupied.
5. **Background image dim ≠ mapSize** — coordinate misalignment between Scene tab and Play tab.
6. **Per-bullet `new Bullet()`** — GC stutter. Pool projectiles.

## Recommended module split (tower defense)

Per `common.md` "Module architecture (universal)", every project gets the universal modules. Tower defense adds these on top:

| Module | Responsibility | Approx LOC |
|---|---|---|
| `src/path.js` | Polyline path interpolation, position-along-path, distance lookups | 100-200 |
| `src/towers.js` | Tower placement / removal, target selection, fire timer per tower | 300-500 |
| `src/projectiles.js` | Projectile spawn, travel, hit, AOE — pooled | 200-400 |
| `src/enemies.js` | Enemy update along path, HP, contact damage at end, death payouts | 200-400 |
| `src/waves.js` | Wave script: timed enemy spawns, between-wave pause, win at last wave clear | 150-300 |
| `src/economy.js` | Gold, lives, build cost, sell value, between-wave income | 100-200 |
| `src/build-mode.js` | Cursor follow, valid-tile highlighting, place/sell/upgrade UI | 200-400 |
| `src/hud.js` | Gold / lives / wave counter / next-wave button | 150-250 |

Total per-project: ~14-19 src files, 2,000-3,500 LOC.

Genre-specific config files:

| File | Holds |
|---|---|
| `data/tower-stats.json` | Per-tower: cost, damage, range, fire-rate, AOE radius, upgrade tree |
| `data/enemy-stats.json` | Per-enemy: HP, speed, gold-on-death, end-damage |
| `data/wave-script.json` | Per-wave: spawn list, intervals, boss flag |
| `data/economy-config.json` | Starting gold/lives, between-wave bonus, sell-back % |
| `data/audio-config.json` | sfx tones |

Identity files:

| File | Holds |
|---|---|
| `data/levels.json` | Map registry |
| `data/<level_id>.json` | Background, path waypoints, build slots, spawn point, end point |
| `data/towers.json` | Tower catalog (id, name, sprite, base type) |
| `data/enemies.json` | Enemy catalog (id, sprite, animations) |

## Reference implementation

OGF does not yet have a strong tower-defense reference project. **For Phase planning + module shape, use `D:/Sengoku-Era-ogf` as the architectural baseline** (state.js + config split + thin game.js + per-subsystem modules). Translate to TD:

| Sengoku-Era-ogf module | TD equivalent |
|---|---|
| `src/battle.js` | `src/towers.js` + `src/projectiles.js` (continuous, real-time) |
| `src/menu.js` | `src/build-mode.js` + `src/hud.js` |
| `src/progression.js` | usually not needed (or `src/upgrades.js` for tower-tree upgrades) |
| `src/overworld.js` | `src/path.js` + `src/enemies.js` (enemies follow path, no free movement) |
| `data/battle-config.json` | `data/tower-stats.json` + `data/wave-script.json` + `data/economy-config.json` |

## Reference repos

- [Phaser official TD tutorial](https://gamedevacademy.org/how-to-make-tower-defense-game-with-phaser-3/)
- [SerhiiChoGames/tower-defense](https://github.com/SerhiiChoGames/tower-defense) — fuller project
- [rexrainbow PathFollower notes](https://rexrainbow.github.io/phaser3-rex-notes/docs/site/pathfollower/)
- [Red Blob — Pathfinding for Tower Defense](https://www.redblobgames.com/pathfinding/tower-defense/) — only if path needs to be dynamic
