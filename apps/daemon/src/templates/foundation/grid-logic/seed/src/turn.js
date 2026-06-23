var _inputCooldown = 0;
var INPUT_COOLDOWN = 0.14;

function tryMovePlayer(dx, dy) {
  if (!state.player || state.mode !== "playing") return;
  var nx = state.player.gridX + dx;
  var ny = state.player.gridY + dy;

  // Check for enemy at target cell — attack
  var enemy = null;
  for (var i = 0; i < state.entities.length; i++) {
    var e = state.entities[i];
    if (e.alive && e.type === "enemy" && e.gridX === nx && e.gridY === ny) { enemy = e; break; }
  }
  if (enemy) {
    pushHistory();
    var dmg = 2;
    enemy.hp -= dmg;
    hitstop(0.05);
    bumpCombo();
    var px = gridToPixel(nx, ny);
    floater("-" + dmg, px.x + CELL_SIZE / 2, px.y, { color: "#ffd23f" });
    burstParticles(px.x + CELL_SIZE / 2, px.y + CELL_SIZE / 2, 4, COLORS.enemy);
    screenshake(3, 0.08);
    if (enemy.hp <= 0) {
      enemy.alive = false;
      state.score += 10;
      floater("+10", px.x + CELL_SIZE / 2, px.y - 16, { color: COLORS.gold });
    }
    endTurn();
    return;
  }

  if (!isWalkable(nx, ny)) return;

  pushHistory();
  state.player.gridX = nx;
  state.player.gridY = ny;
  state.player.facing = dx >= 0 ? 1 : -1;

  // Collect item
  for (var j = 0; j < state.entities.length; j++) {
    var item = state.entities[j];
    if (item.alive && item.type === "item" && item.gridX === nx && item.gridY === ny) {
      item.alive = false;
      var ipx = gridToPixel(nx, ny);
      floater("+50", ipx.x + CELL_SIZE / 2, ipx.y, { color: COLORS.item, size: 20 });
      state.score += 50;
    }
  }

  // Check goal
  if (cellAt(nx, ny) === CELL_TYPES.GOAL) {
    state.mode = "win";
    return;
  }

  state.moves++;
  endTurn();
}

function endTurn() {
  state.turn++;
  syncDisplayPositions();
  // Enemy AI: step toward player
  for (var i = 0; i < state.entities.length; i++) {
    var e = state.entities[i];
    if (!e.alive || e.type !== "enemy") continue;
    var p = state.player;
    if (!p || !p.alive) continue;
    var ddx = Math.sign(p.gridX - e.gridX);
    var ddy = Math.sign(p.gridY - e.gridY);
    // Try to step toward player — horizontal first, then vertical
    var tries = [];
    if (ddx !== 0) tries.push([ddx, 0]);
    if (ddy !== 0) tries.push([0, ddy]);
    if (ddx !== 0 && ddy !== 0) tries.push([ddx, ddy]);
    var moved = false;
    for (var t = 0; t < tries.length; t++) {
      var nx2 = e.gridX + tries[t][0], ny2 = e.gridY + tries[t][1];
      if (nx2 === p.gridX && ny2 === p.gridY) {
        // Attack player
        p.hp -= 1;
        screenshake(4, 0.1);
        var pp = gridToPixel(p.gridX, p.gridY);
        floater("-1", pp.x + CELL_SIZE / 2, pp.y, { color: COLORS.hp });
        if (p.hp <= 0) state.mode = "gameover";
        moved = true;
        break;
      }
      if (isWalkable(nx2, ny2)) {
        e.gridX = nx2; e.gridY = ny2;
        e.facing = tries[t][0] >= 0 ? 1 : -1;
        moved = true;
        break;
      }
    }
  }
  syncDisplayPositions();
}

function updateTurn(dt) {
  _inputCooldown = Math.max(0, _inputCooldown - dt);
  if (_inputCooldown > 0 || state.mode !== "playing") return;
  var dx = 0, dy = 0;
  if (isHeld("right")) dx = 1;
  else if (isHeld("left")) dx = -1;
  if (isHeld("down")) dy = 1;
  else if (isHeld("up")) dy = -1;
  if (dx !== 0 || dy !== 0) {
    tryMovePlayer(dx, dy);
    _inputCooldown = INPUT_COOLDOWN;
  }
}
