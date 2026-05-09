# Recipe — Turn-based 1v1 battle (Pokemon-style)

Implements a deterministic turn-based combat loop: player picks an action → animation → damage resolution → enemy turn → win/loss check.

## When to use

- Pokemon-clone, Shin Megami Tensei-style, classic JRPG monster-tamer
- Player has 1 active partner at a time; enemy is single combatant
- Capture mechanic (降伏符 / pokeball / seal) is part of the loop
- Battle is a separate scene from overworld (mode change, not real-time)

## When NOT to use

- **ATB / real-time battle** → use `recipe-battle-atb.md` (when it exists) or write from scratch
- **Action / hack-n-slash** (Zelda-like) → use `recipe-battle-action.md`; this turn FSM doesn't apply
- **Tactical grid combat** (Fire Emblem) → write from scratch; the battle.js shape here is wrong
- **No combat at all** (sandbox / VN / pure exploration) → DELETE battle.js and battle-config.json entirely

## Files this affects

- `src/battle.js` — main FSM (~480 LOC reference; can shrink to ~250 LOC for simpler games)
- `src/dialogue.js` — uses `showDialogue()` from here
- `src/transition.js` — battle entry/exit fade tween
- `data/battle-config.json` — TUNING: damage formula coeffs, action powers, capture curve
- `data/battle-strings.json` — IDENTITY: per-boss-kind dialogue
- `data/enemies.json` — IDENTITY: enemy stats + types

## Dependencies on foundation

This recipe assumes the foundation seed is in place. It reads/writes:

- `state.battle` — set when active, null otherwise. Shape:
  ```js
  state.battle = {
    kind: "gate" | "boss" | "grass" | ...,
    ally: { ...partnerTemplate, hp, level },
    enemy: { ...enemyTemplate, hp, level },
    locked: false,    // input lock during animations
    menu: "main" | "moves",
    switching: false,
    log: "...",       // last battle log line
    allyHop: 0,       // 0..1 hop tween value, decays
    enemyHop: 0,
    effects: [],      // per-frame FX overlays
  };
  ```
- `state.flags[bossKindId]` — set to `true` after victory/capture for boss kinds
- `state.partnerProgress[partnerId]` — `{ xp, level }` updated on victory
- `state.inventory.sealCharm` — consumed by bind action

- `BATTLE_CONFIG` from `data/battle-config.json` — formula coefficients
- `battleString(path, vars)` from `config.js` — for localized log/dialogue lookups

## Pattern — high level FSM

```
overworld
   ↓ encounter triggered
startBattle(kind)
   ↓ (transition fade)
beginBattle(kind)
   → state.battle = {...}; state.mode = "battle"
   ↓
[input loop]
   handleAction("attack" | "skill" | "bind" | "switch" | "run")
      → performAttack / performSkill / performBind / openBattleSwitch / runBattle
      → battle.locked = true; animate; resolve damage; spawn FX
      → if enemy.hp <= 0: finishBattle("victory")
      → else: enemyTurn() after BATTLE_CONFIG.actions.<kind>.enemyDelay ms
                → animate; resolve damage; if ally.hp <= 0: finishBattle("loss")
                → else: battle.locked = false (back to input loop)
   ↓
finishBattle(result: "victory" | "loss" | "capture" | "run")
   → setPartnerHp() preserves HP into state.partnerHp
   → state.battle = null; state.mode = "overworld"
   → award XP + items + set boss flag
   → showDialogue(resolveVictoryMessage / resolveRunMessage / ...)
   → saveGame()
```

## Damage formula (BATTLE_CONFIG.damage)

```js
function damage(attacker, defender, power, varianceOverride = null) {
  const dmg = BATTLE_CONFIG.damage || {};
  const base = power
    + (attacker.atk || 0) * (dmg.atkScale ?? 0.62)
    - (defender.guard || 0) * (dmg.guardScale ?? 0.52);
  const noise = (Math.random() - 0.5) * (varianceOverride ?? dmg.defaultVariance ?? 5);
  const bonus = typeBonus(attacker, defender);  // strong/weak/neutral per typeAdvantage
  return Math.max(dmg.minimum ?? 4, Math.round((base + noise) * bonus));
}
```

## Capture formula (BATTLE_CONFIG.actions.bind)

```js
function tryCapture(enemy) {
  const cfg = BATTLE_CONFIG.actions.bind;
  const hpRatio = enemy.hp / enemy.maxHp;
  const isLow = hpRatio <= (cfg.lowHpThreshold ?? 0.42);
  const base = isLow ? cfg.lowHpBase : cfg.base;
  const missingScale = isLow ? cfg.lowHpMissingScale : cfg.missingScale;
  const chance = Math.min(0.95, base + (1 - hpRatio) * missingScale);
  return Math.random() < chance;
}
```

## Adaptation knobs (don't touch JS, just `data/battle-config.json`)

| Knob | Effect | Default |
|---|---|---|
| `damage.atkScale` | How much attacker's atk stat matters | 0.62 |
| `damage.guardScale` | How much defender's guard stat matters | 0.52 |
| `damage.defaultVariance` | Random damage spread (±) | 5 |
| `damage.minimum` | Floor damage (so weak attacks still tickle) | 4 |
| `actions.attack.power` | Base power of basic attack | 8 |
| `actions.attack.enemyDelay` | ms between player turn end and enemy turn | 680 |
| `actions.skill.basePower` | Base power of skill (御術) | 13 |
| `actions.skill.levelPower` | Bonus power per level | 2 |
| `actions.bind.lowHpThreshold` | HP ratio under which "weakened" capture triggers | 0.42 |
| `actions.bind.lowHpBase` | Capture % at lowHp threshold | 0.38 |
| `actions.bind.base` | Capture % at full HP (rare success) | 0.12 |
| `typeAdvantage` | Element matchup table (fire>earth, water>fire, etc.) | — |
| `typeBonus.strong` / `.weak` | Multiplier for advantage / disadvantage | 1.22 / 0.88 |
| `xpRewards.<kind>` | `{base, levelScale}` per battle kind | — |
| `itemRewards.<kind>` | `[{item, amount}]` rewards | — |

## How to add a new boss kind

5 steps, ZERO JS changes (see Sengoku-Era-ogf's "5-minute boss" recipe in its README):

1. Add enemy entry to `data/enemies.json` (`{ id, name, type, maxHp, atk, ..., imageKey }`)
2. Add boss/trainer entry in the level's `*-collision-map.json` with `flagKey: "myBoss"` and `battleKind: "myBoss"`
3. Add `"myBoss"` to `BOSS_KIND_FLAGS` set in battle.js (one line)
4. Add `runDialogue.myBoss` + `victoryDialogue.myBoss` to `data/battle-strings.json`
5. Generate sprite via `generate2dsprite` skill, add `imageKey: "myBoss"` mapping to `data/assets.json`

Done. The `flagKey` mechanism + string lookups + table-driven `BATTLE_END_CONTEXT` make adding bosses **pure data work**.

## Common mistakes

- ❌ Hardcoding boss-defeated booleans into `state.js` (e.g. `state.defeatedNobunaga = false`). Use `state.flags = {}` keyed by id.
- ❌ Stringly-typed `if (kind === "X" || kind === "Y")` cascades for boss kinds. Use a `Set` (BOSS_KIND_FLAGS) and look up by key.
- ❌ Inline dialogue strings in JS. Always go through `data/battle-strings.json` for localizability.
- ❌ Hardcoded animation tick rates (`Math.floor(now/220)%4`). Use `animFrame(now, "battle")` and put the rate in `runtime.json`.
- ❌ Calling enemyTurn synchronously after player attack. Always wrap in `setTimeout(enemyTurn, BATTLE_CONFIG.actions.X.enemyDelay)` so the player sees the result.
- ❌ Forgetting `battle.locked = true` during animation — player can spam click and break state.
- ❌ Forgetting `setPartnerHp()` in `finishBattle` — partner HP gets reset on next encounter.

## Reference

Working implementation: `D:/Sengoku-Era-ogf/src/battle.js` (481 LOC, 30+ functions, MIT-style permissive).

Read in order:
1. `BOSS_KIND_FLAGS` + `TEMPLE_BATTLE_KINDS` constants (lines 7-16)
2. `resolveXpKind` / `resolveRunMessage` / `resolveVictoryMessage` / `resolveCaptureMessage` / `resolveLossMessage` (lines 22-60)
3. `startBattle` → `beginBattle` (lines 67-105)
4. `performAttack` / `performSkill` / `performBind` / `enemyTurn` (lines 200-310)
5. `finishBattle` (lines 365-405) — see how all 4 result branches use the resolver helpers

## Files NOT in this recipe (separate concerns)

- Switch partner UI → `recipe-menu-stack.md`
- Dialogue display → `recipe-dialogue-box.md`
- XP curve / level-up logic → `recipe-progression.md`
- Save state → `recipe-save-load.md`
- Elemental FX rendering → `recipe-fx-layer.md`
