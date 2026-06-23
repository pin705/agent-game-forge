function updatePlayerBullets(dt) {
  if (!_playerBullets) return;
  var bullets = _playerBullets.alive();
  for (var i = 0; i < bullets.length; i++) {
    var b = bullets[i];
    b.y += b.vy * dt;
    if (b.y < -20) { b.alive = false; continue; }
    // Hit enemies
    for (var j = 0; j < state.enemies.length; j++) {
      var e = state.enemies[j];
      if (!e.alive) continue;
      if (b.x < e.x + e.w && b.x + b.w > e.x && b.y < e.y + e.h && b.y + b.h > e.y) {
        e.hp -= b.dmg;
        b.alive = false;
        hitstop(0.04); bumpCombo();
        floater("-" + b.dmg, e.x + e.w/2, e.y, { color: "#ffd23f" });
        burstParticles(e.x + e.w/2, e.y + e.h/2, 4, COLORS.enemyColor);
        if (e.hp <= 0) {
          e.alive = false;
          state.score += 100;
          screenshake(3, 0.08);
        }
        break;
      }
    }
  }
  state.enemies = state.enemies.filter(function(e) { return e.alive; });
}

function updateEnemyBullets(dt) {
  if (!_enemyBullets) return;
  var bullets = _enemyBullets.alive();
  var p = state.player;
  for (var i = 0; i < bullets.length; i++) {
    var b = bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y > VIEW.h + 20 || b.x < PLAY_X - 20 || b.x > PLAY_X + PLAY_W + 20) { b.alive = false; continue; }
    if (!p) continue;
    if (b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y) {
      b.alive = false;
      damagePlayer(1);
    }
  }
}
