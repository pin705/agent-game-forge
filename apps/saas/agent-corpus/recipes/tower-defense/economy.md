# Recipe — Economy (gold, lives, win / loss)

The single source of truth for the TD meta loop: **gold** (earned from
kills + wave-clear bonuses, spent on placing/upgrading towers, refunded at
70 % on sell), **lives** (lost when an enemy leaks to the EXIT), and the
**outcomes** (win = survive all waves, lose = lives reach 0).

This recipe gives you `src/economy.js` plus the win/loss hooks. It's the
counterpart to `path-and-waves.md` (which calls `loseLives` on leak +
`earnGold` on wave clear) and `towers-and-targeting.md` (which calls
`spendGold` on place/upgrade, `earnGold` on kill, and refunds on sell).
Keep all balance numbers in `data/economy-config.json`.

## When to use

- Standard single-currency TD: gold in, gold out, lives countdown
- Win on surviving the authored wave list; lose at 0 lives
- 70 %-style sell refund on the tower's total invested gold

## When NOT to use

- **Multi-currency** (gold + gems + research points) — fork: `state.gold`
  becomes `state.wallet = { gold, gems }` and every `spend`/`earn` takes a
  currency key. The single-balance helpers below assume one pool.
- **Lives-as-score / endless mode** (no fixed wave list, you survive for a
  high score) — fork the win condition: there's no `winGame()`; rank by
  waves survived. Loss still fires at 0 lives.
- **No economy** (sandbox / puzzle TD where towers are free and placement
  is the only constraint) — skip this recipe; gate placement on
  buildSpots alone.
- **Regenerating lives / shields** — fork `loseLives` to clamp against a
  regenerating max; this recipe treats lives as a one-way countdown.
- **Lump-sum interest / per-wave passive income** — add an `interest`
  field and grant it in `onWaveCleared`; the wave-clear bonus hook is
  already there (see step 4).

## Files this affects

- `src/economy.js` — gold/lives state + spend/earn/sell + win/loss (~120 LOC)
- `data/economy-config.json` — TUNING: starting gold/lives, refund rate,
  between-wave time
- `src/hud.js` — reads `state.gold` / `state.lives` / wave counter (render
  only; no logic)
- Called from `towers.js` (`spendGold`, `earnGold`, `sellTower`),
  `projectiles.js` (`earnGold` on kill), `waves.js` (`earnGold` wave
  bonus, `winGame`), `enemies.js` (`loseLives` on leak)

## Pattern

### 1. Config (data/economy-config.json)

TUNING file (common.md config-vs-identity split) — the player/designer
tweaks these without touching code. Shared with `path-and-waves.md`.

```json
{
  "startingGold": 100,
  "startingLives": 20,
  "sellRefundRate": 0.7,
  "timeBetweenWaves": 5
}
```

### 2. Init

```js
// src/economy.js
function initEconomy(cfg) {
  state.gold  = cfg.startingGold;
  state.lives = cfg.startingLives;
  state.sellRefundRate = cfg.sellRefundRate ?? 0.7;
  state.outcome = null;   // null = playing, "win" | "lose" when over
}
```

### 3. Gold — spend / earn / afford

The whole API is three functions. `spendGold` is the gate — it returns
`false` and changes nothing if you can't afford it, so callers branch on
it. `earnGold`/`spendGold` ignore non-positive amounts (defensive).

```js
function canAfford(cost) { return state.gold >= cost; }

function spendGold(amount) {
  if (amount <= 0) return true;
  if (state.gold < amount) return false;   // caller must respect this
  state.gold -= amount;
  return true;
}

function earnGold(amount) {
  if (amount <= 0) return;
  state.gold += amount;
}
```

Callers:
- `towers.js placeTower` → `if (!canAfford(cost)) return false; spendGold(cost);`
- `towers.js upgradeTower` → same, with the upgrade `cost`
- `projectiles.js damageEnemy` (on kill) → `earnGold(e.reward)`
- `waves.js onWaveCleared` → `earnGold(def.reward)` (the wave bonus)

> Income has two sources, matching the genre rules: **kill rewards**
> (per-enemy `reward` in `enemies.json`) and **wave-clear bonuses**
> (per-wave `reward` in the level `waves[]`). Don't bake a flat
> per-second drip unless your design calls for interest (see "When NOT").

### 4. Sell — 70 % of total invested

The refund is a fraction of everything sunk into the tower: base cost +
every upgrade. `towers.js` tracks `t.invested` (it grows in
`upgradeTower`), so the refund is correct regardless of upgrade level.

```js
function sellValue(tower) {
  return Math.floor(tower.invested * state.sellRefundRate);
}

function sellTower(tower) {
  const refund = sellValue(tower);
  earnGold(refund);
  state.towers = state.towers.filter((t) => t.id !== tower.id);
  // free the buildSpot implicitly: placeTower checks t.spotId occupancy,
  // so removing the tower re-opens its pad.
  if (state.build.selected === tower) { state.build.mode = "idle"; state.build.selected = null; }
  return refund;
}
```

`Math.floor` keeps gold integral (a 70 % refund of 70 = 49, of 75 = 52).
The HUD's Sell button shows `sellValue(tower)` so the player sees the
refund before committing.

### 5. Lives — leak countdown + loss

Lives drop by the enemy's `leakDamage` when it reaches the EXIT
(`path-and-waves.md` sets `e.leaked` and calls `loseLives`). At ≤ 0 the
game is lost. Guard with `state.outcome` so the loss fires exactly once.

```js
function loseLives(n) {
  if (state.outcome) return;          // already over
  state.lives -= n;
  if (state.lives <= 0) {
    state.lives = 0;
    loseGame();
  }
}

function loseGame() {
  if (state.outcome) return;
  state.outcome = "lose";
  state.paused = true;                // stop spawning / firing
  // showGameOverOverlay();  // hud.js / render.js
}
```

### 6. Win — survived all waves

`waves.js onWaveCleared` calls `winGame()` once the last wave is cleared
**and** the field is empty (that gate lives in the wave manager). Win only
counts if you're not already lost.

```js
function winGame() {
  if (state.outcome) return;          // a leak on the final enemy could lose first
  state.outcome = "win";
  state.paused = true;
  // showVictoryOverlay();  // hud.js / render.js
}
```

> Order matters on the final enemy: if the last enemy *leaks*, that's a
> loss, not a win. `path-and-waves.md` charges the leak (which may call
> `loseGame`) before the wave manager checks for clear, and both
> `winGame`/`loseGame` early-return if `state.outcome` is already set — so
> the first outcome to fire wins the race. Keep that ordering.

### 7. HUD reads, never writes

`src/hud.js` is pure render: it draws `state.gold`, `state.lives`, the
wave counter (`state.wave.index + 1` / `state.wave.defs.length`), the
tower-pick buttons, and (when `state.wave.waiting`) the "send next wave"
button. It calls economy functions on click but holds no economy state.

```js
function drawHud(ctx) {
  ctx.fillStyle = "#FFD54A"; ctx.font = "bold 20px sans-serif";
  ctx.fillText(`Gold ${state.gold}`, 16, 28);
  ctx.fillStyle = "#FF6B6B";
  ctx.fillText(`Lives ${state.lives}`, 16, 54);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`Wave ${state.wave.index + 1}/${state.wave.defs.length}`, 16, 80);
  if (state.outcome === "win")  drawCenterBanner(ctx, "Victory");
  if (state.outcome === "lose") drawCenterBanner(ctx, "Defeated");
}
```

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `startingGold` | economy-config.json | Opening budget (how many towers turn 1) |
| `startingLives` | economy-config.json | Leak tolerance before loss |
| `sellRefundRate` | economy-config.json | Fraction of `invested` returned on sell |
| `stats.reward` | enemies.json | Gold per kill (per enemy type) |
| `stats.leakDamage` | enemies.json | Lives lost per leak (per enemy type) |
| `waves[].reward` | level JSON | Wave-clear gold bonus |
| `timeBetweenWaves` | economy-config.json | Rest length (also used by waves.js) |

## Common mistakes

1. **Spending without checking `canAfford` first.** `spendGold` returns
   `false` on insufficient funds and leaves gold untouched — but if the
   caller ignores the return and places the tower anyway, gold goes
   negative or the tower is free. Always `if (!canAfford(c)) return; spendGold(c);`.

2. **Sell refund off the base cost, not total invested.** A tower upgraded
   twice has sunk `base + up2 + up3` gold; refunding only `base * 0.7`
   robs the player. Track `invested` (grows on every upgrade) and refund
   `invested * rate`.

3. **Non-integer gold.** Percentages produce fractions (`70 * 0.7 = 49`,
   but `75 * 0.7 = 52.5`). `Math.floor` the sell value (and any computed
   reward) so the HUD never shows `52.5 gold`.

4. **Win/loss firing twice (or both).** Without the `state.outcome` guard,
   multiple leaks each call `loseGame`, or a final-wave clear races a final
   leak and you get both overlays. Guard every transition on
   `if (state.outcome) return;` and set it first.

5. **Forgetting to pause on game-over.** If `state.paused` isn't set,
   waves keep spawning and towers keep firing under the victory/defeat
   banner. Set `state.paused = true` in both `winGame` and `loseGame`, and
   have the main loop skip updates while paused.

6. **HUD mutating economy state.** Drawing the gold counter is fine;
   incrementing gold inside `drawHud` (e.g. passive income in the render
   pass) couples display to logic and double-counts on re-render. Income
   happens in `earnGold` callers (kills, wave clears), never in render.

7. **Wave bonus paid before the field is clear.** Pay `waves[].reward` in
   `onWaveCleared` (queue drained AND `alive <= 0`), not when the last
   enemy *spawns*. Paying early lets the player bank the bonus then lose
   the wave.

## Reference

OpenGame `modules/tower_defense/src/systems/EconomyManager.ts` —
`canAfford` / `spend` / `earn` / `getSellValue` (`floor(invested *
refundRate)`) / `sellTower`. Lives + win/loss come from `BaseTDScene`'s
`enemyReachedEnd` (decrement lives by the enemy's exit damage, game-over
at 0) and `allWavesComplete` (victory) events, and the `towerDefenseConfig`
block in `gameConfig.json` (`startingGold` 100, `startingLives` 20,
`sellRefundRate` 0.7). Ported to vanilla: the Phaser EventEmitter
(`goldChanged` / `enemyReachedEnd` / `allWavesComplete`) becomes direct
calls into `state` + render flags, and ms timings become seconds.
