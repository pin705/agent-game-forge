# Recipe — Elemental FX layer (fire/water/earth/shadow)

Spawn one-shot animated FX overlays on hit positions. Each element has a 4-frame sheet that plays once and clears.

## When to use

- Battle has type-tagged attacks (fire/water/earth/shadow or whatever set)
- Visual feedback is needed for hits beyond just HP bar drop
- FX assets are pre-generated as 4-frame sprite sheets via `generate2dsprite` skill

## When NOT to use

- Particle systems (cloud of small sprites) — that's a different recipe; this is single sheet bursts
- Persistent visual effects (flames burning across multiple turns) — use `state.battle.effects[]` array directly
- Non-typed combat (everything is "damage", no element) — drop FX layer entirely

## Files this affects

- `src/battle.js` (rendering segment) — `spawnFx()` + per-frame draw of `battle.effects[]`
- `src/transition.js` — decay the effect.t timer per frame
- `data/battle-config.json::effects` — TUNING: x/y/size/duration per action type
- `data/assets.json::animations` — FX sheet paths per element key
- `assets/fx/<element>/sheet-transparent.png` — 4-frame magenta-cleaned sheet (256×256, cells 128px)

## Dependencies on foundation

```js
state.battle.effects = [
  { kind: "fire", x: 1136, y: 386, size: 160, t: 0, duration: 0.32 },
  // ...
];
```

`BATTLE_CONFIG.effects.{attack,skill,bind,enemyTurn}` config table.

## Pattern — spawn + draw + decay

```js
function spawnFx(kind, x, y, size, duration) {
  const battle = state.battle;
  if (!battle) return;
  battle.effects.push({ kind, x, y, size, t: 0, duration });
}

// Per-frame draw (in battle render):
for (const fx of battle.effects) {
  const sheet = images[`fx${capitalize(fx.kind)}`]; // images.fxFire etc.
  if (!sheet) continue;
  const progress = clamp(fx.t / fx.duration, 0, 1);
  const frame = Math.min(3, Math.floor(progress * 4));
  drawFullSheetFrame(sheet, 2, 2, frame, fx.x, fx.y, fx.size);
}

// Per-frame decay (in transition.js updateBattleAnimations):
battle.effects.forEach((fx) => fx.t += dt);
battle.effects = battle.effects.filter((fx) => fx.t < fx.duration);
```

## Calling from battle actions

```js
function performAttack() {
  // ...damage calc...
  const eff = BATTLE_CONFIG.effects.attack;
  spawnFx(eff.kind ?? "shadow", eff.x, eff.y, eff.size, eff.duration);
}

function performSkill() {
  // ...damage calc...
  const eff = BATTLE_CONFIG.effects.skill;
  // skill uses ALLY's element type, not a fixed kind
  spawnFx(state.battle.ally.type ?? "shadow", eff.x, eff.y, eff.size, eff.duration);
}

function enemyTurn() {
  // ...damage calc...
  const eff = BATTLE_CONFIG.effects.enemyTurn;
  // enemy uses its skillFx (or falls back to type)
  const fxKind = state.battle.enemy.skillFx ?? state.battle.enemy.type ?? "shadow";
  const heavy = Math.random() < BATTLE_CONFIG.actions.enemyTurn.heavyChance;
  spawnFx(fxKind, eff.x, eff.y, heavy ? eff.heavySize : eff.normalSize, eff.duration);
}
```

## FX sheet generation (via OGF generate2dsprite skill)

Each element needs one sheet generated with consistent visual identity:

```
generate2dsprite asset_type='fx' action='single' sheet='2x2' frames=4
  prompt: "[STYLE...] elemental burst: bright {element} energy radiating
           outward, transparent magenta background, 4-frame sequence
           showing growth then dissipation, no character, pure FX."
```

After generation, add to `data/assets.json::animations`:

```jsonc
{
  "animations": {
    "fxFire":   "assets/fx/fire/sheet-transparent.png",
    "fxWater":  "assets/fx/water/sheet-transparent.png",
    "fxEarth":  "assets/fx/earth/sheet-transparent.png",
    "fxShadow": "assets/fx/shadow/sheet-transparent.png"
  }
}
```

The image preloader picks them up via `imagePaths` lookup. `assets.js::loadAssets` handles the rest.

## Adaptation knobs (battle-config.json::effects)

```jsonc
{
  "effects": {
    "attack": {
      "kind": "shadow",          // FX element for basic attack (not type-driven)
      "x": 1136, "y": 390,       // hit position on enemy
      "size": 160,
      "duration": 0.32
    },
    "skill": {
      "x": 1136, "y": 392,
      "size": 245,
      "duration": 0.48
      // kind comes from ally.type, not config
    },
    "bind": {
      "kind": "earth",            // capture has its own visual
      "x": 1136, "y": 394,
      "size": 180,
      "duration": 0.4
    },
    "enemyTurn": {
      "x": 548, "y": 626,         // hit position on ally
      "heavySize": 240,
      "normalSize": 188,
      "duration": 0.44
    }
  }
}
```

## Type system

`data/battle-config.json::typeAdvantage` defines which types beat which:

```jsonc
{
  "typeAdvantage": {
    "fire":   "earth",    // fire > earth
    "water":  "fire",     // water > fire
    "earth":  "shadow",   // earth > shadow
    "shadow": "water"     // shadow > water
  }
}
```

You can have any number of elements (Pokemon has 18). Each element needs a corresponding FX sheet. To add a new element:
1. Generate `assets/fx/<element>/sheet-transparent.png` via skill
2. Add path to `data/assets.json::animations.fx<Capitalized>`
3. Add the type to your monster catalog entries' `type` field
4. Add `typeAdvantage` entries (rock-paper-scissors style, no diamond)

## Common mistakes

- ❌ Spawning FX in update loop instead of action handler — fires every frame, FX layer floods
- ❌ Not filtering decayed effects — `battle.effects[]` grows unbounded, perf degrades
- ❌ Hardcoded element list `if (kind === "fire") ... else if ...` — table-drive via `images[fx${capitalize(kind)}]` lookup
- ❌ Forgetting `playSound()` alongside FX — visuals without audio feel wrong
- ❌ FX position based on viewport not world coords — battle is in screen space, this is fine; overworld FX should be world coords
- ❌ Tying FX duration to frame count instead of seconds — frame count is engine-coupled, seconds is portable

## Reference

Working impl in `D:/Sengoku-Era-ogf/src/battle.js`:
- `spawnFx()` (line 75-79)
- `effects` array in `state.battle` shape (line 39 in `beginBattle()`)
- Per-frame draw integrated into battle render (search `battle.effects` in `render.js`)

Decay loop in `D:/Sengoku-Era-ogf/src/transition.js::updateBattleAnimations` (lines 8-11).

Sheet pipeline in `D:/Sengoku-Era-ogf/assets/fx/{fire,water,earth,shadow}/` — each has `sheet-transparent.png` + `animation.gif` + `pipeline-meta.json`.

## Files NOT in this recipe

- Audio cue alongside FX → `recipe-audio-tones.md` (when written) or vanilla `src/audio.js`
- Battle damage formula → `recipe-battle-turn-based.md`
- FX in overworld (e.g. footstep dust) → not covered here, would be a separate `recipe-overworld-particles.md`
