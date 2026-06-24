// turn.js — the step-mode turn pipeline: player -> world -> check, with input
// LOCKED for the whole pass (reopens only when phase returns to "waiting").
// Vanilla port of the turn-loop recipe, collapsed for pure Sokoban (no enemy phase).

const PHASE = { WAITING: "waiting", PLAYER: "player", WORLD: "world", CHECK: "check", WON: "won" };

function acceptingInput() {
  return state.turnPhase === PHASE.WAITING && state.mode === "playing";
}

// whenAnimationsDone — vanilla stand-in for awaiting the AnimationQueue.
let _onAnimDone = null;
function whenAnimationsDone(cb) {
  if (animationsDone()) { cb(); return; }
  _onAnimDone = cb;
}
function pumpAnimCallback() {
  if (animationsDone() && _onAnimDone) {
    const cb = _onAnimDone;
    _onAnimDone = null;
    cb();
  }
}

// One input = one full pipeline pass (but only if the action consumed a turn).
function takePlayerTurn(playerAction) {
  if (!acceptingInput()) return;
  state.turnPhase = PHASE.PLAYER;
  saveUndoState();                         // snapshot BEFORE mutating
  const acted = playerAction();
  if (!acted) {                            // wall bump / blocked push -> roll back
    discardUndoState();
    state.turnPhase = PHASE.WAITING;
    return;
  }
  state.moveCount += 1;
  // small step-feel: a quick squash tween on the player
  const p = playerEntity();
  if (p) { p.step = 1; tween(p, { step: 0 }, 0.18, "outQuad"); }

  whenAnimationsDone(() => {
    state.turnPhase = PHASE.WORLD;
    recountBoxesOnGoal();
    state.turnPhase = PHASE.CHECK;
    if (checkWin()) { onWin(); return; }
    state.turnPhase = PHASE.WAITING;       // reopen input
  });
}

function checkWin() {
  const boxes = entitiesOfType("box");
  if (!boxes.length) return false;
  return boxes.every((b) => getCell(state.level, b.gridX, b.gridY) === GOAL);
}

function onWin() {
  state.turnPhase = PHASE.WON;
  state.flash = 1;
  screenshake(10, 0.4);
  const p = playerEntity();
  const w = p ? gridToWorld(state.level, p.gridX, p.gridY) : { x: VIEW.w / 2, y: VIEW.h / 2 };
  floater("SOLVED", VIEW.w / 2, VIEW.h / 2 - 40, { color: COLORS.jade, size: 48, life: 1.6, vy: -18 });
  burstParticles(w.x, w.y, 40, COLORS.gold);
  // Brief celebration, then advance to the next level (or "complete").
  state.winTimer = 1.4;
}

// Called from the frame loop while in the "won" hold; advances when the timer ends.
function updateWinHold(dt) {
  if (state.turnPhase !== PHASE.WON) return;
  state.winTimer -= dt;
  if (state.winTimer > 0) return;
  if (state.levelIndex + 1 < state.levels.length) {
    state.levelIndex += 1;
    loadLevelById(state.levels[state.levelIndex]).catch((err) => {
      state.error = err;
      drawErrorOverlay(err, "Level load failed");
    });
  } else {
    state.mode = "complete";
  }
}
