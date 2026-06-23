function loadGrid(levelData) {
  state.grid = levelData.grid.map(function(row) { return row.slice(); });
}

function cellAt(col, row) {
  if (row < 0 || row >= state.grid.length) return CELL_TYPES.WALL;
  if (col < 0 || col >= state.grid[row].length) return CELL_TYPES.WALL;
  return state.grid[row][col];
}

function isWalkable(col, row) {
  var cell = cellAt(col, row);
  if (cell === CELL_TYPES.WALL || cell === CELL_TYPES.EMPTY) return false;
  for (var i = 0; i < state.entities.length; i++) {
    var e = state.entities[i];
    if (e.alive && !e.walkable && e.gridX === col && e.gridY === row) return false;
  }
  return true;
}

function gridOffsetX() {
  if (!state.level) return 0;
  return Math.floor((VIEW.w - state.level.cols * CELL_SIZE) / 2);
}

function gridOffsetY() {
  if (!state.level) return 0;
  return Math.floor((VIEW.h - state.level.rows * CELL_SIZE) / 2);
}

function gridToPixel(col, row) {
  return { x: gridOffsetX() + col * CELL_SIZE, y: gridOffsetY() + row * CELL_SIZE };
}
