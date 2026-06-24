// movement.js — the move resolver + the move-lerp animation queue.
// Logic is INSTANT (gridX/gridY change immediately so entityAt + win-check see
// the truth); only the SPRITE slides over animationSpeed seconds. Vanilla port of
// the grid-and-movement recipe's tryMove/tryPush (single-box Sokoban push).

// Queue the visual slide for an entity whose logic coords just changed.
function animateMove(e, fromX, fromY) {
  const to = gridToWorld(state.level, e.gridX, e.gridY);
  e.px = fromX;
  e.py = fromY;
  state.anim.push({ e, fromX, fromY, toX: to.x, toY: to.y, t: 0, dur: TUNE.animationSpeed });
}

// Advance every queued slide; remove finished ones. Called each frame (gameplay dt).
function updateAnimations(dt) {
  for (const a of state.anim) {
    a.t = Math.min(1, a.t + dt / a.dur);
    const e = ease.outCubic(a.t);
    a.e.px = a.fromX + (a.toX - a.fromX) * e;
    a.e.py = a.fromY + (a.toY - a.fromY) * e;
  }
  state.anim = state.anim.filter((a) => a.t < 1);
}
function animationsDone() {
  return state.anim.length === 0;
}

// Move a box one cell if its destination is free floor/goal. Single-push only
// (a box behind a box is blocked — classic Sokoban). Returns true if it moved.
function tryPush(box, d) {
  const bx = box.gridX + d.dx, by = box.gridY + d.dy;
  const cell = getCell(state.level, bx, by);
  if (cell === WALL || cell === EMPTY) return false;   // box hits a wall / void
  const blocker = entityAt(bx, by);
  if (blocker && !blocker.isWalkable) return false;    // box hits another box
  const fromX = box.px, fromY = box.py;
  const wasOnGoal = getCell(state.level, box.gridX, box.gridY) === GOAL;
  box.gridX = bx; box.gridY = by;
  animateMove(box, fromX, fromY);
  // Fire juice when a box lands ON a goal it wasn't already on.
  if (!wasOnGoal && getCell(state.level, bx, by) === GOAL) onBoxOnGoal(box);
  return true;
}

// Resolve one discrete player step. Returns true if a real move happened.
function tryMove(dir) {
  const p = playerEntity();
  const d = DIRS[dir];
  if (!d || !p) return false;
  p.facing = dir;

  const nx = p.gridX + d.dx, ny = p.gridY + d.dy;
  const cell = getCell(state.level, nx, ny);
  if (cell === WALL || cell === EMPTY) return false;   // wall / OOB -> no turn

  const target = entityAt(nx, ny);
  if (target) {
    if (target.isPushable) {
      if (!tryPush(target, d)) return false;           // push blocked -> no move
    } else if (!target.isWalkable) {
      return false;                                    // solid non-pushable
    }
  }

  const fromX = p.px, fromY = p.py;
  p.gridX = nx; p.gridY = ny;
  animateMove(p, fromX, fromY);
  return true;
}

// Juice: box settled on a goal -> sparkle + pop + label.
function onBoxOnGoal(box) {
  const w = gridToWorld(state.level, box.gridX, box.gridY);
  burstParticles(w.x, w.y, 14, COLORS.boxDone);
  floater("+1", w.x, w.y - 10, { color: COLORS.boxDoneTop, size: 22 });
  bumpCombo();
  box.pop = 1; // render reads this for a squash-pop
}
