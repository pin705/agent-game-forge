function spawnEnemyRing() {
  if (!state.player || !state.level) return;
  var sc = CONFIG.spawn;
  var aliveCount = enemyPool ? enemyPool.alive().length : 0;
  if (aliveCount >= sc.maxAlive) return;          // hard cap (arena-survivor.md)
  var e = enemyPool.get();
  if (!e) return;
  // Ring just outside the viewport so the enemy walks in from off-screen.
  var theta = Math.random() * Math.PI * 2;
  var dist = Math.hypot(VIEW.w, VIEW.h) / 2 + sc.ringMargin;
  e.alive = true;
  e.x = state.player.x + Math.cos(theta) * dist;
  e.y = state.player.y + Math.sin(theta) * dist;
  e.hp = e.maxHp = 1 + Math.floor(state.runTime / 30) * sc.enemyHpPer30s;
  e.speed = sc.enemySpeedMin + Math.random() * sc.enemySpeedSpread;
  e.color = "#c44";
  e.kind = "bat";
}

function updateEnemies(dt) {
  if (!enemyPool || !state.player) return;
  var p = state.player;
  var alive = enemyPool.alive();
  for (var i = 0; i < alive.length; i++) {
    var e = alive[i];
    if (e.hurtTimer > 0) e.hurtTimer -= dt;
    var dx = p.x - e.x, dy = p.y - e.y;
    var len = Math.hypot(dx, dy);
    if (len > 0) { e.x += (dx / len) * e.speed * dt; e.y += (dy / len) * e.speed * dt; }
    // Contact damage — player hit juice (juice.md): shake + brief hitstop + flash.
    if (len < CONFIG.player.contactRange && p.invuln <= 0) {
      p.hp -= CONFIG.player.contactDamage;
      p.invuln = CONFIG.player.iFrames;
      screenshake(6, 0.12);
      hitstop(0.05);
      floater("-" + CONFIG.player.contactDamage, VIEW.w / 2, VIEW.h / 2, { color: "#d9362b" });
      playSfx("death");
      if (p.hp <= 0) { p.hp = 0; state.mode = "gameover"; }
    }
  }
}

function spawnXpOrb(x, y) {
  if (!xpPool) return;
  var o = xpPool.get();
  if (!o) return;
  o.alive = true; o.x = x; o.y = y; o.value = CONFIG.xp.orbValue;
}

var _waveSpawnTimer = 0;
function spawnWave(dt) {
  if (!state.level || !state.player) return;
  var sc = CONFIG.spawn;
  _waveSpawnTimer -= dt;
  if (_waveSpawnTimer > 0) return;
  // Difficulty ramp: interval shrinks toward minInterval over time.
  _waveSpawnTimer = Math.max(sc.minInterval, sc.baseInterval - state.runTime * sc.rampPerSecond);
  spawnEnemyRing();
}
