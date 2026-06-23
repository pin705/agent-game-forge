# Recipe — Three-phase turn loop + win/lose (grid-logic)

The heartbeat of every grid-logic game: a pipeline that runs ONCE per player action — **player phase → world phase → enemy phase → win/lose check** — with input locked for the whole pass. This is the chassis-correct vanilla-JS port of OpenGame's `TurnManager` (`WAITING → PROCESSING → ANIMATING → CHECKING`). It is one `state` object + plain functions, NOT a Phaser `EventEmitter`.

## When to use

- Any grid-logic game (`genres/grid-logic.md`) — puzzle, tactics, roguelike, arcade.
- You need a deterministic, legible order of resolution (player acts, THEN the world reacts, THEN enemies react, THEN you check if the game ended).
- The level declares `win`/`lose` as data in `data/<level>.json` (per the genre file's schema).

## When NOT to use

- **Match-3 (`grid_subtype: match`)** — there is no enemy phase. The loop is swap → resolve matches → gravity → refill → **re-check for new matches** (cascade) until stable. Use the cascade variant at the bottom of this recipe, not the 3-phase pipeline.
- **Real-time non-grid action** (arena-survivor, shmup, platformer) — those run every-frame physics, not discrete turns. Wrong genre; see `genres/arena-survivor.md` / `shmup.md`.
- **A game with no world reaction and no enemies** (a pure sliding-tile puzzle where the only actor is the player) — you can still use this loop; the world phase just runs the goal check and the enemy phase is a no-op. Don't fork — collapsing it adds risk for no gain.

## Files this affects

- `src/turn.js` — the pipeline + phase state + counters (~120–220 LOC; the bulk of this recipe)
- `src/win.js` — `checkWin(state)` / `checkLose(state)` evaluating the level's `win`/`lose` data (~40–100 LOC)
- `src/input.js` — input handlers guard on the phase lock (one `if` at the top of each)
- `src/movement.js` — `tryMove()` resolves the player action, returns whether a turn was actually taken (see `grid-and-movement.md`)
- `src/ai.js` — `stepEnemies()` runs each enemy's `onStep` in the enemy phase (roguelike/tactics; see `genres/grid-logic.md` §module split)
- `data/<level>.json` — `win` / `lose` blocks; `data/grid-config.json` — `actionsPerTurn`, `stepIntervalMs`

## Dependencies on foundation

```js
// src/state.js — turn state lives on the shared global `state`
state.turnPhase   = "waiting";  // "waiting" | "player" | "world" | "enemy" | "check" | "won" | "lost"
state.turnNumber  = 1;
state.moveCount   = 0;          // total player moves (for moves_exceeded lose + undo)
state.actionsThisTurn = 0;      // tactics only
state.anim        = [];         // animation queue (see anim.js); pipeline waits on it
```

## Pattern

### 1. Phase constants + the input gate

```js
// src/turn.js
const PHASE = { WAITING:"waiting", PLAYER:"player", WORLD:"world", ENEMY:"enemy", CHECK:"check", WON:"won", LOST:"lost" };

// The single guard every input handler calls FIRST. Input is accepted ONLY while waiting.
function acceptingInput() {
  return state.turnPhase === PHASE.WAITING;
}
```

```js
// src/input.js — every handler short-circuits when not waiting
function onDirection(dir) {
  if (!acceptingInput()) return;          // locked during the whole pipeline
  takePlayerTurn(() => tryMove(dir));     // tryMove returns true if a real move happened
}
```

### 2. The pipeline (step / turn / realtime sub-types)

`takePlayerTurn` wraps the player's chosen action, then drives the phases. It only advances if the action actually consumed a turn (e.g. walking into a wall is a no-op — don't burn a turn or step the enemies).

```js
// src/turn.js
function takePlayerTurn(playerAction) {
  if (!acceptingInput()) return;

  // --- PLAYER PHASE: resolve the player's action, queue its animations ---
  state.turnPhase = PHASE.PLAYER;
  saveUndoState();                          // snapshot BEFORE mutating (see undo-stack.md)
  const acted = playerAction();             // tryMove(dir) / doAttack() / etc. -> bool
  if (!acted) {                             // no-op (wall bump, illegal): roll back, reopen input
    discardUndoState();
    state.turnPhase = PHASE.WAITING;
    return;
  }
  state.moveCount++;

  // tactics: let the player keep acting until actionsPerTurn is spent or they end the turn
  if (state.level.grid_subtype === "tactics") {
    state.actionsThisTurn++;
    if (state.actionsThisTurn < cfg().actionsPerTurn && !state.endTurnRequested) {
      state.turnPhase = PHASE.WAITING;      // same turn, accept another action
      return;
    }
  }

  resolveRestOfTurn();                       // world -> enemy -> check (after anims drain)
}

// World + enemy phases run AFTER the player's animations finish, so resolution is legible.
function resolveRestOfTurn() {
  whenAnimationsDone(() => {
    // --- WORLD PHASE: traps fire, tiles transform, items collected, ice/portals already resolved in move ---
    state.turnPhase = PHASE.WORLD;
    runWorldPhase();

    whenAnimationsDone(() => {
      // --- ENEMY PHASE: each enemy takes one AI step (skip for pure puzzle / match) ---
      state.turnPhase = PHASE.ENEMY;
      if (hasEnemies()) stepEnemies();       // src/ai.js: runs each enemy onStep

      whenAnimationsDone(() => {
        // --- CHECK: win? lose? else next turn ---
        state.turnPhase = PHASE.CHECK;
        if (checkWin(state))  { state.turnPhase = PHASE.WON;  onWin();  return; }
        if (checkLose(state)) { state.turnPhase = PHASE.LOST; onLose(); return; }
        state.turnNumber++;
        state.actionsThisTurn = 0;
        state.endTurnRequested = false;
        state.turnPhase = PHASE.WAITING;     // reopen input
      });
    });
  });
}
```

`whenAnimationsDone(cb)` is the vanilla stand-in for awaiting the AnimationQueue: it calls `cb` immediately if the queue is empty, otherwise stores `cb` and the update loop fires it when `state.anim` drains. Keeping the input lock until animations finish is what prevents the next move starting mid-slide (the desync bug).

```js
// src/anim.js (sketch — full queue in genres/grid-logic.md §"Movement animation")
let _onAnimDone = null;
function whenAnimationsDone(cb) {
  if (state.anim.length === 0) { cb(); return; }
  _onAnimDone = cb;
}
function updateAnimations(dt) {
  // ... advance each anim's t; remove finished ...
  if (state.anim.length === 0 && _onAnimDone) { const cb = _onAnimDone; _onAnimDone = null; cb(); }
}
```

### 3. World phase + enemy phase hooks

```js
function runWorldPhase() {
  // Traps on HAZARD cells, doors opening, periodic emitters, item pickup resolution.
  // ICE slide + PORTAL teleport are resolved inside the move itself (grid-and-movement.md),
  // but mid-slide cell effects (a trap on an ice path) fire here as the entity passes.
  for (const e of state.entities) {
    const cell = getCell(state.level, e.gridX, e.gridY);
    if (cell === HAZARD && e.maxHp) damageEntity(e, hazardDamage(state.level, e.gridX, e.gridY));
  }
}

function hasEnemies() {
  return state.entities.some(e => e.type === "enemy" && e.alive !== false);
}
```

### 4. End-turn (tactics) + realtime tick (arcade)

```js
// tactics: Space / "End Turn" button voluntarily ends the turn early
function onAction() {
  if (!acceptingInput()) return;
  if (state.level.grid_subtype === "tactics") { state.endTurnRequested = true; resolveRestOfTurn(); return; }
  takePlayerTurn(() => doAbility());   // roguelike: Space = ability/ranged attack
}

// arcade: a timer auto-steps the board; the buffered direction is the "player action"
function updateRealtime(dt) {
  if (state.level.grid_subtype !== "arcade") return;
  if (!acceptingInput()) return;
  state.stepTimer = (state.stepTimer || 0) + dt * 1000;
  if (state.stepTimer >= cfg().stepIntervalMs) {
    state.stepTimer -= cfg().stepIntervalMs;
    takePlayerTurn(() => tryMove(state.bufferedDir));   // Snake/Tetris: move on the tick
  }
}
```

### 5. Win/lose evaluation (src/win.js) — data-driven

```js
// src/win.js — reads the level's win/lose blocks (genres/grid-logic.md §"Win / lose")
function checkWin(state) {
  const w = state.level.win || {};
  switch (w.kind) {
    case "boxes_on_goals":
      return state.entities.filter(e => e.type === "box")
        .every(b => getCell(state.level, b.gridX, b.gridY) === GOAL);
    case "reach_goal": {
      const p = playerEntity();
      return getCell(state.level, p.gridX, p.gridY) === GOAL;
    }
    case "all_enemies_defeated":
      return !state.entities.some(e => e.type === "enemy" && e.alive !== false);
    case "collect_all":
      return !state.entities.some(e => e.type === "key" || e.type === "item");
    case "score_target":
      return state.score >= (w.target || 0);
    default: return false;
  }
}

function checkLose(state) {
  const l = state.level.lose || {};
  switch (l.kind) {
    case "moves_exceeded": return state.moveCount > (l.maxMoves ?? Infinity);
    case "player_dead":    return (playerEntity()?.hp ?? 1) <= 0;
    case "timer_expired":  return (state.timeLeft ?? 1) <= 0;
    case "out_of_board":   return state.snakeCrashed === true;   // arcade sets this in tryMove
    default: return false;
  }
}
```

`onWin()` / `onLose()` set the render mode to a title-overlay screen (per `common.md` — HUD/screens are direct `ctx.fillText`, no DOM). Win → "Level complete, press Enter" → advance `data/levels.json`. Lose → "Press Enter to retry" → reload the level (or `popUndo` to the start for a soft reset).

### Match-3 cascade variant (freeform — NO enemy phase)

```js
// match games replace the 3-phase pipeline with a cascade loop
function onCellClicked(gx, gy) {
  if (!acceptingInput()) return;
  if (!trySwap(gx, gy)) return;            // adjacent swap; reject if no match results
  state.turnPhase = PHASE.PLAYER;
  resolveCascade();
}
function resolveCascade() {
  whenAnimationsDone(() => {
    const cleared = clearMatches();        // find + remove 3+ runs, add score
    if (cleared > 0) {
      applyGravity();                       // drop survivors
      refillBoard();                        // spawn new pieces at the top
      resolveCascade();                     // RE-CHECK — chains keep going until stable
    } else {
      if (checkWin(state)) { state.turnPhase = PHASE.WON; onWin(); return; }
      state.turnPhase = PHASE.WAITING;      // board stable, accept next swap
    }
  });
}
```

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `grid_subtype` | `data/<level>.json` | step (puzzle/roguelike) vs turn (tactics) vs realtime (arcade) vs freeform/cascade (match) |
| `actionsPerTurn` | `data/grid-config.json` | tactics: how many actions before the turn auto-ends |
| `stepIntervalMs` | `data/grid-config.json` | arcade: ms between auto-steps (speed ramp = shrink this over time) |
| `win.kind` / `lose.kind` | `data/<level>.json` | which boolean the check phase evaluates |
| `animationSpeed` | `data/grid-config.json` | move-lerp duration; the pipeline waits on it |

## Common mistakes

1. **Burning a turn on a no-op.** Walking into a wall must NOT step the enemies or increment `moveCount`. Have the player action return a bool; if `false`, roll back the undo snapshot and reopen input WITHOUT running the world/enemy phases. (Skipping this lets enemies close in while the player is stuck against a wall — feels broken.)

2. **Not locking input during the pipeline.** If `onDirection` doesn't guard on `acceptingInput()`, a fast player queues a second move while the first is still animating → positions desync, two enemy phases run for one visible move. One `if (!acceptingInput()) return;` at the top of every handler.

3. **Running world/enemy phases synchronously, ignoring animations.** If you resolve all phases in one synchronous call, the player sees boxes, traps, and enemies all teleport at once — illegible. Drain the animation queue between phases (`whenAnimationsDone`).

4. **Checking win BEFORE the world phase resolves.** A box pushed onto the last goal must be ON the goal (world/move resolved) before `checkWin` runs. Order is fixed: player → world → enemy → check. Don't check mid-phase.

5. **Match-3 with an enemy phase / undo.** Match games have neither. Forcing the 3-phase pipeline onto a match game leaves a dead enemy phase and tempts you to add undo (which breaks the random refill). Use the cascade variant.

6. **Forgetting the cascade re-check (match).** Clearing matches drops pieces that may form NEW matches. If you clear once and stop, chains never happen. Loop `resolveCascade` until a pass clears zero.

7. **Tactics: ending the turn after one action.** Tactics lets the player act multiple times (or move + attack) before the enemy turn. If you call `resolveRestOfTurn` after every action, it plays like step-mode. Gate on `actionsThisTurn < actionsPerTurn` and an explicit end-turn.

## Reference

OpenGame `grid_logic/src/systems/TurnManager.ts` (the `WAITING/PROCESSING/ANIMATING/CHECKING` phase machine, `recordAction`, `endTurn`, `finishChecking`) + the `grid_logic` Section-2 "Core Loop (Three-Phase Pipeline)" in `generate-gdd.ts`. Both are Phaser/TS — this recipe is the vanilla-canvas translation.
