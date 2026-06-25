// undo.js — bounded stack of pre-move snapshots; Z restores the last one exactly.
// Vanilla port of OpenGame's BoardManager.pushState/popState. Snapshots the grid
// (deep) + entity positions + per-move counters (the undo-stack recipe's checklist;
// pure Sokoban has no HP/cooldowns/inventory, so positions + counters suffice).

function snapshotState() {
  return {
    grid: state.level.grid.map((row) => row.slice()),   // deep copy each row
    entities: state.entities.map((e) => ({
      id: e.id, type: e.type, gridX: e.gridX, gridY: e.gridY, alive: e.alive, facing: e.facing
    })),
    moveCount: state.moveCount,
    boxesOnGoal: state.boxesOnGoal
  };
}

function saveUndoState() {
  state.undoStack.push(snapshotState());
  if (state.undoStack.length > TUNE.maxUndoSteps) state.undoStack.shift();
}

// Drop the snapshot we optimistically pushed for a no-op move (wall bump).
function discardUndoState() {
  state.undoStack.pop();
}

// Re-attach immutable per-entity fields not stored in snapshots.
function findEntityDef(id) {
  const def = (state.level.entities || []).find((e) => e.id === id) || {};
  return {
    isWalkable: def.isWalkable,
    isPushable: def.isPushable,
    sizeFactor: def.sizeFactor
  };
}

function popUndo() {
  if (state.turnPhase !== "waiting") return false;  // never undo mid-pipeline
  const snap = state.undoStack.pop();
  if (!snap) return false;

  for (let y = 0; y < state.level.rows; y += 1) {
    for (let x = 0; x < state.level.cols; x += 1) {
      state.level.grid[y][x] = snap.grid[y][x];
    }
  }
  state.entities = snap.entities.map((s) => {
    const e = { ...findEntityDef(s.id), ...s };
    const w = gridToWorld(state.level, e.gridX, e.gridY);
    e.px = w.x; e.py = w.y;   // snap render position (cancel any in-flight slide)
    return e;
  });
  state.moveCount = snap.moveCount;
  state.boxesOnGoal = snap.boxesOnGoal;
  state.anim.length = 0;
  state.turnPhase = "waiting";
  floater("UNDO", VIEW.w / 2, 90, { color: COLORS.muted, size: 20, life: 0.7 });
  return true;
}

// R — reload the current level from its pristine def (full soft reset).
function resetLevel() {
  loadLevelById(state.levels[state.levelIndex]).catch((err) => {
    state.error = err;
    drawErrorOverlay(err, "Reset failed");
  });
}
