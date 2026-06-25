# Recipe — Card battler (deck / hand / energy / turn resolution)

Implements a Slay-the-Spire-style battle: a deck shuffles into a hand, you
spend energy to play cards (attack / block / heal) against an enemy, end your
turn, the enemy acts, and the loop repeats until someone hits 0 HP. All cards
and enemy stats are catalogs in `data/*.json`. This is the vanilla-JS port of
OpenGame's `CardManager` + `BaseBattleScene` + `TurnManager` + `ComboManager`.

## When to use

- Deck-building / card battler (Slay the Spire, Inscryption, Reigns)
- Turn-based duel where the player picks actions from a hand each turn
- **Quiz battle** — same loop with the hand replaced by a question + 4 options
  (see "Quiz variant" at the end)

## When NOT to use

- **Real-time / action card game** (Hearthstone-style board with timers, or a
  card-driven shooter) — the turn FSM here is strictly turn-locked; fork.
- **No-deck combat** (fixed move list, RPG turn menu) — that's a top-down-rpg
  `battle.js` with a command menu, not a draw/discard deck. Use the
  `top-down-rpg` battle recipe.
- **Deckless roguelike / autobattler** (units fight automatically) — no hand,
  no energy; this pattern doesn't apply.
- **Multiplayer netcode** — out of scope; this is single-player vs scripted AI.

## Files this affects

- `src/deck.js` — deck/hand/discard lifecycle (~100-180 LOC; OpenGame `CardManager`)
- `src/battle.js` — turn FSM + energy + play-card resolution + enemy AI (~300-500 LOC)
- `src/combo.js` — streak → multiplier (optional crit feel; OpenGame `ComboManager`)
- `data/cards.json` — IDENTITY: card definitions (id, type, cost, value, text)
- `data/enemies.json` — IDENTITY: enemy stats (id, name, maxHp, damageRange, actions)
- `data/run-config.json` — IDENTITY: starting deck = list of card ids (with dupes)
- `data/battle-config.json` — TUNING: startingEnergy, handSize, playerMaxHp, comboTiers
- Sits inside the `battle` screen from `recipes/ui-heavy/screen-stack.md`

## Pattern

### 1. Catalogs

`data/cards.json` (definitions — see `genres/ui-heavy.md` for the full schema):
```json
[
  { "id": "strike", "name": "Strike", "type": "attack", "cost": 1, "value": 6, "text": "Deal 6 damage." },
  { "id": "defend", "name": "Defend", "type": "block",  "cost": 1, "value": 5, "text": "Gain 5 block." },
  { "id": "bash",   "name": "Bash",   "type": "attack", "cost": 2, "value": 8, "text": "Deal 8. Apply 2 Vulnerable.", "status": { "vulnerable": 2 } }
]
```

`data/run-config.json` (deck *composition* — ids with duplicates, kept separate
from definitions so one `strike` def backs 5 copies):
```json
{ "startingDeck": ["strike","strike","strike","strike","strike","defend","defend","defend","defend","bash"] }
```

`data/enemies.json` (OpenGame `EnemyBattleConfig`):
```json
[
  { "id": "gate_guard", "name": "Gate Guard", "maxHp": 45, "portrait": "assets/enemies/guard.png",
    "damageRange": [8, 12], "actions": ["attack", "attack", "defend"] }
]
```

`data/battle-config.json` (TUNING, flat plain JSON — no `{value:}` wrapper):
```json
{
  "startingEnergy": 3, "handSize": 5, "playerMaxHp": 70,
  "comboTiers": [
    { "minStreak": 0, "multiplier": 1.0, "label": "" },
    { "minStreak": 3, "multiplier": 1.25, "label": "GREAT" },
    { "minStreak": 5, "multiplier": 1.5,  "label": "PERFECT" }
  ]
}
```

### 2. Deck lifecycle (`src/deck.js`)

Port of OpenGame `CardManager` — four piles as id-arrays on `state.battle`:
`drawPile`, `hand`, `discardPile`, `playedThisTurn`.

```js
function initDeck() {
  // Expand starting deck ids into card instances (each gets a unique uid so
  // duplicate "strike" copies are individually addressable in the hand).
  state.battle.drawPile = catalogs.runConfig.startingDeck.map((id, i) => ({
    uid: `${id}_${i}`, ...cardById(id),
  }));
  state.battle.hand = [];
  state.battle.discardPile = [];
  shuffle(state.battle.drawPile);
}

function shuffle(arr) {                 // Fisher-Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function drawToHand(count) {
  const b = state.battle;
  for (let i = 0; i < count && b.hand.length < CONFIG.handSizeCap ?? 10; i++) {
    if (b.drawPile.length === 0) {       // reshuffle discard ONLY when empty
      if (b.discardPile.length === 0) break;   // truly out of cards
      b.drawPile = b.discardPile; b.discardPile = [];
      shuffle(b.drawPile);
    }
    b.hand.push(b.drawPile.pop());
  }
}

function discardHand() {                 // end of turn
  state.battle.discardPile.push(...state.battle.hand);
  state.battle.hand = [];
}

function removeFromHand(uid) {           // when a card is played
  const b = state.battle;
  const i = b.hand.findIndex(c => c.uid === uid);
  if (i === -1) return null;
  return b.hand.splice(i, 1)[0];
}
```

Reshuffle the discard back **only when the draw pile is empty** (OpenGame's
`reshuffleDiscard`) — never mid-draw with cards still in draw.

### 3. Turn FSM (`src/battle.js`)

Port of OpenGame `TurnManager` phases (`PLAYER_TURN → ACTION → ENEMY_TURN →
CHECK_END`) into a `state.battle.phase` string the `battle` screen's `update`
dispatches on:

```js
function startBattle(enemyId) {
  const cfg = CONFIG;                    // from battle-config.json
  state.battle = {
    phase: "PLAYER_TURN", turn: 1,
    energy: cfg.startingEnergy, maxEnergy: cfg.startingEnergy,
    playerHp: state.stats.hp ?? cfg.playerMaxHp, playerMaxHp: cfg.playerMaxHp,
    playerBlock: 0,
    enemy: { ...enemyById(enemyId), hp: enemyById(enemyId).maxHp, block: 0, vulnerable: 0, intentIdx: 0 },
    drawPile: [], hand: [], discardPile: [], floaters: [],
  };
  initDeck();
  startPlayerTurn();
}

function startPlayerTurn() {
  const b = state.battle;
  b.phase = "PLAYER_TURN";
  b.energy = b.maxEnergy;
  b.playerBlock = 0;                     // block expires each turn (StS rule)
  drawToHand(CONFIG.handSize);
}

// Called by the battle screen's onClick when a card in hand is clicked.
function tryPlayCard(uid) {
  const b = state.battle;
  if (b.phase !== "PLAYER_TURN") return;
  const card = b.hand.find(c => c.uid === uid);
  if (!card) return;
  if (card.cost > b.energy) { playSfx("wrong"); floater("Not enough energy"); return; }
  b.energy -= card.cost;
  removeFromHand(uid);
  b.discardPile.push(card);
  resolveCard(card);                     // apply effect
  checkEnd();
}

function resolveCard(card) {             // OpenGame resolveCardAction
  const b = state.battle, e = b.enemy;
  switch (card.type) {
    case "attack": {
      let dmg = card.value;
      if (e.vulnerable > 0) dmg = Math.floor(dmg * 1.5);   // status modifier
      if (combo) dmg = Math.floor(dmg * combo.multiplier()); // optional combo
      const dealt = Math.max(0, dmg - e.block); e.block = Math.max(0, e.block - dmg);
      e.hp -= dealt; floater(`-${dealt}`, "enemy"); screenshake(4, 0.1);
      if (card.status?.vulnerable) e.vulnerable += card.status.vulnerable;
      break;
    }
    case "block": b.playerBlock += card.value; floater(`+${card.value} block`, "player"); break;
    case "heal":  b.playerHp = Math.min(b.playerMaxHp, b.playerHp + card.value); floater(`+${card.value}`, "player"); break;
    case "special": applySpecial(card); break;     // draw N, gain energy, etc.
  }
  if (card.draw) drawToHand(card.draw);
}

function endPlayerTurn() {               // "End Turn" button / Enter
  const b = state.battle;
  if (b.phase !== "PLAYER_TURN") return;
  discardHand();
  b.phase = "ENEMY_TURN";
  enemyAct();
}

function enemyAct() {                     // OpenGame onEnemyAction / executeEnemyTurn
  const b = state.battle, e = b.enemy;
  const action = e.actions[e.intentIdx % e.actions.length];   // scripted intent
  e.intentIdx++;
  if (action === "attack") {
    const [lo, hi] = e.damageRange;
    let dmg = lo + ((Math.random() * (hi - lo + 1)) | 0);
    const dealt = Math.max(0, dmg - b.playerBlock);
    b.playerBlock = Math.max(0, b.playerBlock - dmg);
    b.playerHp -= dealt; floater(`-${dealt}`, "player"); screenshake(6, 0.12);
  } else if (action === "defend") {
    e.block += 6; floater("+6 block", "enemy");
  }
  if (e.vulnerable > 0) e.vulnerable--;            // decay status at end of round
  b.turn++;
  if (!checkEnd()) startPlayerTurn();              // back to player
}

function checkEnd() {
  const b = state.battle;
  if (b.enemy.hp <= 0) { state.stats.hp = b.playerHp; replaceScreen("result"); state.result = "victory"; return true; }
  if (b.playerHp <= 0) { replaceScreen("result"); state.result = "defeat"; return true; }
  return false;
}
```

### 4. Render the hand (inside the `battle` screen's `render`)

Fan the hand across the bottom; store each card's rect so `onClick` can
hit-test it (OpenGame's `Card` prefab → a `drawCard(ctx, card, rect, hover)`
call in `src/ui.js`):

```js
function layoutHand() {                  // recompute rects each frame (hand size changes)
  const b = state.battle, n = b.hand.length, cw = 120, gap = 12;
  const totalW = n * cw + (n - 1) * gap, startX = (VIEW.w - totalW) / 2;
  b.hand.forEach((c, i) => { c.rect = { x: startX + i * (cw + gap), y: VIEW.h - 180, w: cw, h: 168 }; });
}
// render: for each c in hand → drawCard(ctx, c, c.rect, hoverUid === c.uid && c.cost <= b.energy)
// dim/grey cards whose cost > current energy so the player sees what's unplayable.
// onClick: const c = b.hand.find(c => pointInRect({x,y}, c.rect)); if (c) tryPlayCard(c.uid);
// also draw an "End Turn" button → endPlayerTurn(); keyboard: 1-9 play N-th card, Enter = end turn.
```

### 5. Combo (optional, `src/combo.js`)

Port of OpenGame `ComboManager` — a streak of successful hits raises a damage
multiplier read in `resolveCard`. `comboHit()` on landing an attack (or a
correct quiz answer), `comboMiss()` on taking damage (or a wrong answer); tiers
from `battle-config.json`.

## Adaptation knobs

| Knob | Where | Default | Effect |
|---|---|---|---|
| `startingEnergy` | battle-config.json | 3 | Cards playable per turn |
| `handSize` | battle-config.json | 5 | Cards drawn each turn |
| `playerMaxHp` | battle-config.json | 70 | Player survivability |
| `damageRange` | enemies.json | [8,12] | Enemy hit variance |
| `actions[]` | enemies.json | — | Enemy intent script (cycled) |
| Block expiry | battle.js `startPlayerTurn` | resets each turn | Set carry-over for a "defensive" archetype |
| Vulnerable multiplier | battle.js `resolveCard` | 1.5× | Status strength |
| comboTiers | battle-config.json | — | Crit-feel curve |

## Common mistakes

1. **Reshuffling discard while draw pile still has cards** — you must only fold
   discard back when `drawPile.length === 0`, else you lose the no-repeat-until-
   exhausted property and cards re-appear too soon.
2. **No `uid` on card instances** — duplicate `strike` copies become
   indistinguishable; removing "the strike you clicked" removes the wrong one.
   Give each drawn instance a unique `uid` (the catalog `id` is shared).
3. **Spending energy before the playability check** — validate `cost <= energy`
   *first*, then deduct. Otherwise energy can go negative on a misclick.
4. **Block not expiring** — Slay-the-Spire block resets at the start of your
   turn. Forgetting to zero `playerBlock` in `startPlayerTurn` makes block
   accumulate forever and trivializes the game.
5. **Status not decaying** — `vulnerable`/`weak` counters must tick down once
   per round, or a single application lasts the whole battle.
6. **Enemy intent purely random with no telegraph** — even a simple scripted
   `actions[]` cycle (the OpenGame pattern) reads better than pure RNG; if you
   do go random, show the upcoming intent so the player can plan blocks.
7. **Resolving cards during ENEMY_TURN** — gate `tryPlayCard` on
   `phase === "PLAYER_TURN"`. Clicks during enemy animations must be ignored.
8. **HP not carried between battles** — if the game has multiple battles, write
   `state.stats.hp = b.playerHp` on victory (done in `checkEnd`) so damage
   persists; reading it back in `startBattle`.

## Quiz variant

Swap the hand for a question bank. PLAYER_TURN shows a question + 4 option
buttons from `data/questions.json` (pick with the no-repeat selector — track
used `id`s in `state`, reset when exhausted; OpenGame `QuizManager`). On click:
validate `selectedIndex === question.correctIndex` →
- **correct**: deal damage to the enemy (or `+score`), `comboHit()`, flash
  "Correct!" + the `explanation`.
- **wrong**: take damage (or lose a life), `comboMiss()`, show the right answer.

Then `endPlayerTurn` → enemy acts → next question. The deck functions
(`initDeck`/`drawToHand`) are unused in the quiz variant; everything else
(turn FSM, energy or lives, combo, win/loss, RESULT screen) is identical.
For PVP buzzer mode, add `dualPlayer` fields to `battle-config.json`
(`scoreToWin`, `buzzerTimeLimit`, sequential vs simultaneous) and let two input
sources race to answer — OpenGame's `_TemplateDualBattle` shape.

## Reference

OpenGame `src/systems/CardManager.ts` (deck lifecycle), `src/scenes/BaseBattleScene.ts`
(turn phases + resolveCardAction + enemy turn hooks), `src/systems/TurnManager.ts`
(phase FSM), `src/systems/ComboManager.ts` (streak multiplier),
`src/systems/QuizManager.ts` (no-repeat question selection + answer validation).
All ported here to vanilla Canvas 2D + `data/*.json` catalogs.
