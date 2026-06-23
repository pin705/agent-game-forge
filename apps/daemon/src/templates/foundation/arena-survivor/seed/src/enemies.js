function spawnEnemyRing() {
  if (!state.player || !state.level) return;
  var aliveCount = enemyPool ? enemyPool.alive().length : 0;
  if (aliveCount >= 200) return;
  var e = enemyPool.get();
  if (!e) return;
  var theta = Math.random() * Math.PI * 2;
  var dist = Math.hypot(VIEW.w, VIEW.h) / 2 + 80;
  e.alive = true;
  e.x = state.player.x + Math.cos(theta) * dist;
  e.y = state.player.y + Math.sin(theta) * dist;
  e.hp = e.maxHp = 1 + Math.floor(state.runTime / 30);
  e.speed = 70 + Math.random() * 40;
  e.color = "#c44";
  e.kind = "bat";
}

function updateEnemies(dt) {
  if (!enemyPool || !state.player) return;
  var p = state.player;
  var alive = enemyPool.alive();
  for (var i = 0; i < alive.length; i++) {
    var e = alive[i];
    var dx = p.x - e.x, dy = p.y - e.y;
    var len = Math.hypot(dx, dy);
    if (len > 0) { e.x += (dx / len) * e.speed * dt; e.y += (dy / len) * e.speed * dt; }
    // Contact damage
    if (len < 24 && p.invuln <= 0) {
      p.hp -= 1; p.invuln = 1.0;
      screenshake(5, 0.12);
      floater("-1", p.x + VIEW.w/2 - state.camera.x, VIEW.h/2, { color: "#d9362b" });
      if (p.hp <= 0) { state.mode = "gameover"; }
    }
  }
}

function spawnXpOrb(x, y) {
  if (!xpPool) return;
  var o = xpPool.get();
  if (!o) return;
  o.alive = true; o.x = x; o.y = y; o.value = 1;
}

var _waveSpawnTimer = 0;
function spawnWave(dt) {
  if (!state.level || !state.player) return;
  _waveSpawnTimer -= dt;
  if (_waveSpawnTimer > 0) return;
  _waveSpawnTimer = 1.5 - Math.min(1.2, state.runTime * 0.01);
  spawnEnemyRing();
}
