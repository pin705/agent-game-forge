# Recipe — XP, level-up, evolution stages

XP curve, per-partner progression tracking, level-up notifications, multi-stage evolution (Pokemon-style).

## When to use

- Captured monsters / partners gain XP from battle
- Stats scale with level (HP / atk / guard grow)
- Visual evolution at level thresholds (Pokemon, Digimon)
- Progression is per-partner, not party-wide (each captured monster has own level)

## When NOT to use

- Party-wide leveling (Final Fantasy XP shared) — simpler, just add `state.partyLevel`
- No leveling at all (roguelike with permadeath, action games) — drop progression.js entirely
- Only equipment-based growth (no XP, just gear) — write a separate `recipe-loot.md`

## Files this affects

- `src/progression.js` — XP curve + level-up + evolution + save (~287 LOC reference)
- `src/battle.js` — calls `awardExperience()` after victory/capture
- `src/menu.js` — displays level + XP-to-next on partner detail screen
- `data/progression-config.json` — TUNING: max level, XP curve coefficients, evolution levels, skill levels
- `data/starters.json` / `data/enemies.json` — IDENTITY: per-monster `forms[]` array for evolution stages

## Dependencies on foundation

```js
state.partnerProgress = {
  hibamaru: { xp: 42, level: 3 },
  mizunagi: { xp: 8, level: 1 },
  // ...
};
```

`MAX_LEVEL`, `EVOLUTION_LEVELS`, `SKILL_LEVELS` from `runtime.json::progression`.

## XP curve

```js
function nextLevelXp(level) {
  // Quadratic ramp: level 2 needs ~12 XP, level 30 needs ~300 XP
  if (level >= MAX_LEVEL) return Infinity;
  const base = PROGRESSION_CONFIG.xpBase ?? 12;
  const exp = PROGRESSION_CONFIG.xpExponent ?? 1.5;
  return Math.round(base * Math.pow(level, exp));
}
```

Tune via `data/progression-config.json`. Keep curve gentle for casual games (xpExponent 1.3), steeper for grinders (1.8).

## Stat scaling

Each stat grows linearly per level via `progression-config.json::statGrowth`:

```jsonc
{
  "statGrowth": {
    "maxHp":  { "base": 60, "perLevel": 8 },
    "atk":    { "base": 12, "perLevel": 1.5 },
    "guard":  { "base": 8,  "perLevel": 1.2 },
    "art":    { "base": 14, "perLevel": 1.8 }
  }
}
```

Apply on demand (when entering battle):

```js
function scaledMitama(template, level = 1) {
  return {
    ...template,
    maxHp: Math.round(template.maxHp + (level - 1) * statGrowth.maxHp.perLevel),
    atk:   Math.round(template.atk   + (level - 1) * statGrowth.atk.perLevel),
    // ...
  };
}
```

## Evolution stages

Each monster's catalog entry has `forms[]`:

```jsonc
{
  "id": "hibamaru",
  "name": "緋刃丸",
  "forms": [
    { "name": "緋刃丸",  "imageKey": "hibamaru" },          // stage 1 (default)
    { "name": "曉刃牙",  "imageKey": "hibamaruStage2" },    // stage 2 at level 10
    { "name": "焰兜神",  "imageKey": "hibamaruStage3" }     // stage 3 at level 22
  ]
}
```

`EVOLUTION_LEVELS = [1, 10, 22]` from runtime.json. Lookup current form:

```js
function formFor(template, level) {
  let formIdx = 0;
  EVOLUTION_LEVELS.forEach((threshold, i) => { if (level >= threshold) formIdx = i; });
  return template.forms?.[formIdx] || template.forms?.[0] || { name: template.name, imageKey: template.imageKey };
}
```

## Skill unlocks

Same pattern as forms but with `skills[]`:

```jsonc
"skills": ["火紋裂", "緋焰亂", "破魔火陣"]
```

`SKILL_LEVELS = [1, 8, 18]`. Active skill = highest unlocked.

## awardExperience() — main entry

```js
function awardExperience(kind, enemy = null) {
  if (!state.partnerId) return "";
  const progress = progressFor(state.partnerId);
  if (progress.level >= MAX_LEVEL) return "御印已達滿階。";

  const gained = battleXpReward(kind, enemy);   // from battleConfig.xpRewards
  progress.xp += gained;
  const messages = [`${partner.name} 得到 ${gained} 枚御印。`];

  // Level-up loop (could level multiple times in one battle if XP is huge)
  let leveled = false, evolved = false;
  while (progress.level < MAX_LEVEL && progress.xp >= nextLevelXp(progress.level)) {
    const previousForm = formFor(partner, progress.level).name;
    progress.xp -= nextLevelXp(progress.level);
    progress.level += 1;
    const nextForm = formFor(partner, progress.level).name;
    leveled = true;
    if (previousForm !== nextForm) {
      evolved = true;
      messages.push(`${previousForm} 進化為「${nextForm}」。`);
    } else {
      messages.push(`${partner.name} 升至 Lv.${progress.level}。`);
    }
  }
  if (evolved) playSound("evolve");
  else if (leveled) playSound("level");
  return messages.join(" ");
}
```

Returns a `growthText` string that gets interpolated into `battle-strings.json` victory dialogue.

## Adaptation knobs

| Knob | File | Effect |
|---|---|---|
| `progression.maxLevel` | runtime.json | Hard cap on level |
| `progression.evolutionLevels` | runtime.json | Array of thresholds for stage transitions |
| `progression.skillLevels` | runtime.json | Array of thresholds for skill upgrades |
| `xpBase` / `xpExponent` | progression-config.json | Curve shape |
| `statGrowth.X.perLevel` | progression-config.json | How much each stat grows per level |
| `xpRewards.<kind>` | battle-config.json | XP per battle kind |

## Common mistakes

- ❌ Computing scaled stats once and caching — caches go stale on level-up; recompute per battle
- ❌ Hardcoded XP curve in JS — put in config so designers can tune without code change
- ❌ Triggering evolution sound + level sound + fanfare all at once — pick one (vanilla picks evolve > level)
- ❌ Per-partner progress in state.player instead of state.partnerProgress[id] — breaks when player switches
- ❌ Not handling MAX_LEVEL cap — XP just keeps growing past max, integer overflow eventually
- ❌ Evolution thresholds in code instead of forms[] data — adding stage 4 requires code change

## Reference

`D:/Sengoku-Era-ogf/src/progression.js` lines 36-220.

Key functions:
- `progressFor(id)` — lazy-init `{xp, level: 1}` per partner (line ~50)
- `ensurePartnerHp(id)` — keeps state.partnerHp in sync with maxHp at current level
- `nextLevelXp(level)` — XP curve
- `formFor(template, level)` — current evolution stage lookup
- `skillFor(template, level)` — current skill lookup
- `awardExperience(kind, enemy)` — main entry from battle.js

`progression-config.json` is the tuning surface — duplicate it per project and adjust.

## Files NOT in this recipe

- Battle XP reward calc → `recipe-battle-turn-based.md` (`battleXpReward` lives there)
- Save serialization of progression → `recipe-save-load.md`
- Menu display of partner stats → `recipe-menu-stack.md`
