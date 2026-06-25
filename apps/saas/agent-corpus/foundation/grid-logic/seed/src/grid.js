// grid.js — the board: grid accessors, row-major coordinate conversion, the
// entity index, and level loading. Vanilla port of OpenGame's BoardManager.
// The grid is the SINGLE SOURCE OF TRUTH (grid[y][x]) and is mutated in place.

function getCell(level, gx, gy) {
  if (!inBounds(level, gx, gy)) return WALL;   // OOB reads as wall (blocks everything)
  return level.grid[gy][gx];                   // ROW-MAJOR: [y][x]
}
function setCell(level, gx, gy, value) {
  if (inBounds(level, gx, gy)) level.grid[gy][gx] = value;
}
function inBounds(level, gx, gy) {
  return gx >= 0 && gx < level.cols && gy >= 0 && gy < level.rows;
}

// Board is centered in the viewport via an offset.
function gridOffset(level) {
  return {
    x: Math.floor((VIEW.w - level.cols * level.cellSize) / 2),
    y: Math.floor((VIEW.h - level.rows * level.cellSize) / 2)
  };
}
function gridToWorld(level, gx, gy) {          // cell -> pixel center
  const o = gridOffset(level);
  return {
    x: o.x + gx * level.cellSize + level.cellSize / 2,
    y: o.y + gy * level.cellSize + level.cellSize / 2
  };
}

// --- Entity index — linear scan is fine for small boards ---------------------
function entityAt(gx, gy) {
  return state.entities.find((e) => e.alive !== false && e.gridX === gx && e.gridY === gy) || null;
}
function entitiesOfType(type) {
  return state.entities.filter((e) => e.type === type && e.alive !== false);
}
function playerEntity() {
  return state.entities.find((e) => e.type === "player");
}

// Count total goal cells + how many boxes currently sit on a goal (for HUD + win).
function countGoals() {
  const lvl = state.level;
  let goals = 0;
  for (let y = 0; y < lvl.rows; y += 1) {
    for (let x = 0; x < lvl.cols; x += 1) {
      if (lvl.grid[y][x] === GOAL) goals += 1;
    }
  }
  state.totalGoals = goals;
}
function recountBoxesOnGoal() {
  const boxes = entitiesOfType("box");
  state.boxesOnGoal = boxes.filter((b) => getCell(state.level, b.gridX, b.gridY) === GOAL).length;
}

// --- Level loading -----------------------------------------------------------
// Fetch the level JSON, normalize, copy entities into the live state.entities.
async function loadLevelById(id) {
  const res = await fetch(`data/${id}.json`);
  if (!res.ok) throw new Error(`level "${id}" failed to load (${res.status})`);
  const def = await res.json();
  def.cols = def.grid[0].length;
  def.rows = def.grid.length;
  def.cellSize = def.cellSize || TUNE.cellSize;
  state.level = def;

  resetLevelState();
  // Deep-copy entities so the pristine def survives reset/undo.
  state.entities = (def.entities || []).map((e) => ({ ...e, alive: true }));
  // Seed render positions for the move-lerp.
  for (const e of state.entities) {
    const w = gridToWorld(def, e.gridX, e.gridY);
    e.px = w.x;
    e.py = w.y;
  }
  countGoals();
  recountBoxesOnGoal();
}
