# Recipe — Undo stack (snapshot board + entities before each move)

A bounded stack of board snapshots taken BEFORE every player move; Z pops the last one and restores it exactly. Chassis-correct vanilla-JS port of OpenGame's `BoardManager.pushState()/popState()`. The grid array + entity positions are auto-snapshotted; the catch — and the focus of this recipe — is enumerating the **custom per-move state** (HP, cooldowns, inventory, patrol directions, turn/move counters) that ALSO must be captured, or undo silently desyncs.

## When to use

- **Puzzle (`grid_subtype: puzzle`)** — undo is expected (Sokoban, sliding puzzles). Players experiment; undo is the core comfort.
- **Tactics (`grid_subtype: tactics`)** — undo a misclicked move within a turn (before committing / ending the turn), or full multi-step undo if the design allows.
- **Roguelike** — OPTIONALLY, if the design is puzzle-leaning (deterministic, no hidden info). Most roguelikes deliberately have NO undo (permadeath); only add it if asked.

## When NOT to use

- **Match-3 (`grid_subtype: match`)** — the refill spawns NEW random pieces; undoing across a refill is non-deterministic and players don't expect it. Match games use limited-moves/score, not undo. Skip this recipe.
- **Arcade (`grid_subtype: arcade`)** — Snake/Tetris are real-time reflex games; undo defeats the genre. The lose condition is the point. Skip.
- **Permadeath roguelike** — if the design pitch is "every move is final", do NOT add undo. It changes the genre's tension. Confirm with the spec before building it.

## Files this affects

- `src/undo.js` — the stack, `saveUndoState` / `popUndo` / `discardUndoState`, the Z handler (~60–120 LOC)
- `src/turn.js` — `takePlayerTurn` calls `saveUndoState()` before the player action, `discardUndoState()` on a no-op (see `turn-loop.md`)
- `src/input.js` — Z key → `popUndo()`
- `src/hud.js` — optional "undo available" indicator + move counter
- `data/grid-config.json` — `maxUndoSteps`

## Dependencies on foundation

```js
// src/state.js
state.undoStack = [];          // array of snapshots, most-recent last
state.moveCount = 0;           // restored by undo
state.turnNumber = 1;          // restored by undo
state.score = 0;               // restored by undo (if the game scores)
// ...plus whatever custom per-move state the game tracks (enumerated below)
```

## Pattern

### 1. What a snapshot must contain

OpenGame's `BoardManager` snapshots exactly two things — `cells` (deep-copied) and `entities` (id + type + gridX + gridY). That covers a pure Sokoban. **The trap**: any game state that changes during a move but ISN'T the grid or an entity's position will NOT be restored unless you add it. The genre's GDD calls this out explicitly: *"The board grid and entity positions are auto-saved; only list game-specific state above."*

A snapshot is a **deep, plain-data clone** (no references into live objects — a shallow copy would let the restore alias the current board):

```js
// src/undo.js
function snapshotState() {
  return {
    // (1) the grid — deep copy each row (cells mutate: holes fill, doors open)
    grid: state.level.grid.map(row => row.slice()),

    // (2) entities — capture id + position + per-move mutable fields
    entities: state.entities.map(e => ({
      id: e.id, type: e.type,
      gridX: e.gridX, gridY: e.gridY,
      alive: e.alive,                 // boxes consumed by hole-fill, defeated enemies
      // --- CUSTOM per-entity state (add exactly what your game mutates) ---
      hp: e.hp,                       // combat (roguelike/tactics)
      facing: e.facing,               // directional sprites / attacks
      patrolDir: e.patrolDir,         // patrol enemies reverse on walls -> must restore
      cooldown: e.cooldown,           // ability cooldown counted in turns
      justTeleported: e.justTeleported,
    })),

    // (3) global per-move counters + game-specific flags
    moveCount: state.moveCount,
    turnNumber: state.turnNumber,
    score: state.score,
    // --- CUSTOM global state ---
    inventory: { ...state.inventory },     // keys collected, items held
    timeLeft: state.timeLeft,              // if a timer/turn-budget exists
    flags: { ...state.flags },             // doors opened, switches toggled (if not encoded in grid)
  };
}
```

### 2. Save before each move; discard on a no-op

```js
function saveUndoState() {
  state.undoStack.push(snapshotState());
  const cap = cfg().maxUndoSteps ?? 100;
  if (state.undoStack.length > cap) state.undoStack.shift();   // bound memory (FIFO drop oldest)
}

// Called when the player action turned out to be a no-op (wall bump): drop the snapshot we
// optimistically pushed, so undo doesn't accumulate empty steps. (turn-loop.md §takePlayerTurn)
function discardUndoState() {
  state.undoStack.pop();
}
```

`takePlayerTurn` (in `turn-loop.md`) pushes the snapshot BEFORE running the player action, then `discardUndoState()` if the action returned `false`. This keeps "one undo = one real move" — the most common correctness expectation.

### 3. Restore (pop)

Restore is the mirror of snapshot. **Restore in place** — re-assign fields on the existing objects rather than replacing arrays wholesale where other modules hold references, but rebuilding `state.entities` from the snapshot is cleanest as long as render/AI re-read `state.entities` each frame (they do).

```js
function popUndo() {
  const snap = state.undoStack.pop();
  if (!snap) return false;                                   // nothing to undo

  // (1) grid — overwrite cells in place
  for (let y = 0; y < state.level.rows; y++)
    for (let x = 0; x < state.level.cols; x++)
      state.level.grid[y][x] = snap.grid[y][x];

  // (2) entities — rebuild from the snapshot (positions + custom fields)
  state.entities = snap.entities.map(s => ({ ...findEntityDef(s.id), ...s }));
  // findEntityDef re-attaches non-snapshotted static data (sprite path, flags, sizeFactor)
  // from the level def so we don't have to snapshot immutable fields every move.

  // (3) globals
  state.moveCount  = snap.moveCount;
  state.turnNumber = snap.turnNumber;
  state.score      = snap.score;
  state.inventory  = { ...snap.inventory };
  state.timeLeft   = snap.timeLeft;
  state.flags      = { ...snap.flags };

  state.anim.length = 0;                                     // cancel any in-flight slide animation
  state.turnPhase = "waiting";                               // reopen input
  playSfx("undo");
  return true;
}
```

```js
// re-attach immutable per-entity fields (sprite, flags) not stored in snapshots
function findEntityDef(id) {
  const def = state.level.entities.find(e => e.id === id) || {};
  return { sprite: def.sprite, animations: def.animations,
           isWalkable: def.isWalkable, isPushable: def.isPushable,
           isDestructible: def.isDestructible, sizeFactor: def.sizeFactor,
           portalPairId: def.portalPairId };
}
```

### 4. Z key wiring + lock

```js
// src/input.js
function onKeyDown(key) {
  if (key === "z" || key === "Z") {
    if (state.turnPhase !== "waiting") return;   // don't undo mid-pipeline
    popUndo();
    return;
  }
  // ... direction / action handlers ...
}
```

Undo only while `turnPhase === "waiting"` — undoing mid-animation or mid-enemy-phase would restore over a half-resolved board.

## The custom-state checklist (the part everyone forgets)

Walk this list for YOUR game and add every "yes" to `snapshotState()` + `popUndo()`. The grid + entity positions are free; everything else is on you (this list is lifted from the genre's GDD "Undo System" note):

| Custom state | Snapshot it if... | Where it lives |
|---|---|---|
| Entity HP | combat is on (`maxHp > 0`) | `e.hp` |
| Ability cooldowns | abilities have turn-counted cooldowns | `e.cooldown` / `state.cooldowns` |
| Patrol direction | patrol enemies reverse on walls | `e.patrolDir` |
| Turret fire counter | turrets fire every N turns | `e.fireCounter` / via `turnNumber` |
| Inventory / keys | items get collected | `state.inventory` |
| Door/switch flags | toggled state NOT encoded in the grid | `state.flags` |
| Score | the game scores per move | `state.score` |
| Timer / move budget | a countdown exists | `state.timeLeft` |
| `alive` flags | boxes sink (hole-fill), enemies die | `e.alive` |
| `justTeleported` | portals are present | `e.justTeleported` |
| RNG seed | any per-move randomness | `state.rngState` |

**If it changes during `tryMove` / the world phase / the enemy phase and it's not the grid or a `gridX/gridY`, it must be in the snapshot.** A quick audit: after implementing undo, do a move that touches each system (push a box, take damage, collect a key, trigger a patrol turn), undo, and assert the state byte-for-byte matches the pre-move state.

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `maxUndoSteps` | `data/grid-config.json` | stack depth (memory cap); `-1`/large = unlimited |
| Snapshot fields | `snapshotState` | which custom state survives undo (the checklist above) |
| No-op discard | `takePlayerTurn` | whether wall-bumps create undo steps (they should NOT) |
| Undo scope (tactics) | when `saveUndoState` is called | per-action vs per-turn undo |

## Common mistakes

1. **Shallow copy of the grid.** `state.undoStack.push({ grid: state.level.grid })` stores a REFERENCE — the snapshot mutates along with the live board, so undo restores the current state (no-op). Deep-copy every row: `grid.map(r => r.slice())`.

2. **Forgetting custom state.** Snapshotting only grid + positions (like the raw `BoardManager`) loses HP / cooldowns / inventory / patrol direction. Player undoes a move, but the enemy that was at 1 HP is back at full, or the collected key is still gone. Walk the checklist above.

3. **Not restoring the move counter.** If `moveCount`/`turnNumber` aren't in the snapshot, undo rewinds the board but the "moves used" HUD keeps climbing — and a `moves_exceeded` lose can fire on a board that's actually back at move 3. Snapshot the counters.

4. **Pushing the snapshot AFTER the move.** Snapshot must be the state BEFORE the move, taken before mutating. Push at the very top of `takePlayerTurn`; if you snapshot after, undo restores the post-move state and does nothing useful.

5. **Accumulating no-op undos.** Every wall-bump pushing a snapshot means the player taps Z and "nothing happens" (it undoes a non-move). Discard the snapshot when the action returns `false`.

6. **Undoing mid-pipeline.** Allowing Z during ANIMATING/ENEMY phases restores over a partially-resolved turn → corrupt board. Gate undo on `turnPhase === "waiting"` and clear `state.anim` on restore.

7. **Unbounded stack.** A long puzzle session with no cap grows the stack until it's a memory problem (each snapshot deep-copies the whole board). Cap at `maxUndoSteps` and FIFO-drop the oldest.

8. **Re-snapshotting immutable fields every move.** Storing sprite paths + flags in every snapshot bloats memory and risks them going stale. Snapshot only mutable state; re-attach static fields from the level def on restore (`findEntityDef`).

## Reference

OpenGame `grid_logic/src/systems/BoardManager.ts` (`pushState`/`popState`, the `BoardSnapshot` shape, `_maxUndoSteps` FIFO, `clearHistory`) + the GDD "Undo System" note in `generate-gdd.ts` ("Call `saveUndoState()` BEFORE each move… List ALL custom state that changes per move and must be restored: HP, cooldowns, inventory flags, patrol directions, turret counters"). The `TurnManager.undoAction()` decrement of move/turn counters is folded into `popUndo` here.
