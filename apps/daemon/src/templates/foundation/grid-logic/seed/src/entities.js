var _entityId = 0;

function createEntity(type, col, row, opts) {
  opts = opts || {};
  var e = {
    id: "ent" + (++_entityId),
    type: type,
    gridX: col, gridY: row,
    displayX: 0, displayY: 0,
    alive: true,
    walkable: type === "item" || type === "goal",
    hp: opts.hp || 1, maxHp: opts.hp || 1,
    color: opts.color || COLORS.floor,
    facing: 1
  };
  state.entities.push(e);
  return e;
}

function loadEntities(levelData) {
  _entityId = 0;
  for (var i = 0; i < (levelData.entities || []).length; i++) {
    var def = levelData.entities[i];
    var color = def.type === "player" ? COLORS.player : def.type === "enemy" ? COLORS.enemy : COLORS.item;
    var hp = def.hp || (def.type === "player" ? 5 : def.type === "enemy" ? 3 : 1);
    var e = createEntity(def.type, def.gridX, def.gridY, { hp: hp, color: color });
    if (def.type === "player") state.player = e;
  }
  syncDisplayPositions();
}

function syncDisplayPositions() {
  for (var i = 0; i < state.entities.length; i++) {
    var e = state.entities[i];
    if (!e.alive) continue;
    var px = gridToPixel(e.gridX, e.gridY);
    e.displayX = px.x;
    e.displayY = px.y;
  }
}
