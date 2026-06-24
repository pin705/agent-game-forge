// towers.js — placement (click empty grid cell), targeting (cache + refresh on
// cooldown), firing. (recipes/towers-and-targeting.md). Shares global `state`.
function cellKey(col, row) { return `${col},${row}`; }

function towerTypeById(id) {
  return state.config.towers.find((t) => t.id === id) || null;
}
function towerTypeByIndex(i) {
  return state.config.towers[i] || state.config.towers[0];
}

// is this grid cell free to build on? (inside grid, not on path, not occupied)
function isCellBuildable(col, row) {
  const g = state.grid;
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return false;
  if (state.occupied[cellKey(col, row)]) return false;
  return !cellOnPath(col, row);
}

// a cell is "on path" if the path polyline passes near its centre
function cellOnPath(col, row) {
  const cs = state.grid.cellSize;
  const cx = col * cs + cs / 2;
  const cy = row * cs + cs / 2;
  const pts = state.path.points;
  const thresh = cs * 0.55;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(cx, cy, pts[i - 1], pts[i]) <= thresh) return true;
  }
  return false;
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + dx * t, cy = a.y + dy * t;
  return Math.hypot(px - cx, py - cy);
}

// Attempt to place the selected tower type at a grid cell. Returns true on
// success. Rejects (with a floater) if can't afford or cell unbuildable.
function tryPlaceTower(col, row) {
  const type = towerTypeByIndex(state.selectedTowerType);
  const cs = state.grid.cellSize;
  const cx = col * cs + cs / 2;
  const cy = row * cs + cs / 2;
  if (!isCellBuildable(col, row)) {
    floater("blocked", cx, cy - 10, { color: COLORS.bad, size: 14 });
    return false;
  }
  if (!canAfford(type.cost)) {
    floater("need gold", cx, cy - 10, { color: COLORS.bad, size: 14 });
    return false;
  }
  spendGold(type.cost);
  state.occupied[cellKey(col, row)] = true;
  const tower = {
    id: `t_${state.towerSeq++}`,
    typeId: type.id,
    col, row,
    x: cx, y: cy,
    range: type.range,
    damage: type.damage,
    fireRate: type.fireRate,
    color: type.color,
    cooldown: 0,
    target: null,
    angle: 0,
    recoil: 0,    // tweened on fire
    scale: 0.1    // tweened in on place
  };
  state.towers.push(tower);
  // JUICE: place → outBack pop-in + a small sparkle
  tween(tower, { scale: 1 }, 0.34, "outBack");
  burstParticles(cx, cy, 8, type.color);
  floater(`-${type.cost}`, cx, cy - 14, { color: COLORS.gold, size: 15 });
  return true;
}

function inRange(t, e) {
  return Math.hypot(e.x - t.x, e.y - t.y) <= t.range;
}

// default targeting: "first" — enemy furthest along the path (closest to exit)
function acquireTarget(t) {
  let best = null;
  let bestProg = -1;
  for (const e of state.enemies) {
    if (e.dead || !inRange(t, e)) continue;
    const prog = pathProgress(e);
    if (prog > bestProg) { best = e; bestProg = prog; }
  }
  return best;
}

function updateTowers(dt) {
  for (const t of state.towers) {
    t.cooldown -= dt;
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 6);

    if (t.target && (t.target.dead || !inRange(t, t.target))) t.target = null;
    if (!t.target) t.target = acquireTarget(t);
    if (t.target) t.angle = Math.atan2(t.target.y - t.y, t.target.x - t.x);

    if (t.cooldown <= 0 && t.target) {
      fireTower(t, t.target);
      t.cooldown = 1 / t.fireRate;
    }
  }
}
