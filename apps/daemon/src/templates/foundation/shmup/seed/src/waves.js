function spawnEnemy(kind, x) {
  var hp = kind === "gunner" ? 4 : 2;
  state.enemies.push({
    alive: true, kind: kind,
    x: x, y: -50, w: 36, h: 36,
    hp: hp, maxHp: hp, speed: kind === "gunner" ? 60 : 90,
    shootTimer: 1.5 + Math.random(), shootCooldown: 2.0,
    moveDir: Math.random() > 0.5 ? 1 : -1
  });
}

function updateEnemies(dt) {
  for (var i = 0; i < state.enemies.length; i++) {
    var e = state.enemies[i];
    if (!e.alive) continue;
    e.y += e.speed * dt;
    e.x += e.moveDir * 40 * dt;
    // Bounce off play area walls
    if (e.x < PLAY_X) { e.x = PLAY_X; e.moveDir = 1; }
    if (e.x + e.w > PLAY_X + PLAY_W) { e.x = PLAY_X + PLAY_W - e.w; e.moveDir = -1; }
    if (e.y > VIEW.h + 60) { e.alive = false; continue; }
    // Shoot
    e.shootTimer -= dt;
    if (e.shootTimer <= 0) {
      e.shootTimer = e.shootCooldown;
      if (_enemyBullets) {
        var b = _enemyBullets.get();
        if (b) {
          b.alive = true;
          b.x = e.x + e.w/2 - 4; b.y = e.y + e.h;
          b.vx = (Math.random() - 0.5) * 80; b.vy = 220 + Math.random() * 80;
        }
      }
    }
    // Ram player
    var p = state.player;
    if (p && e.x < p.x + p.w && e.x + e.w > p.x && e.y < p.y + p.h && e.y + e.h > p.y) {
      e.alive = false; damagePlayer(1);
    }
  }
  state.enemies = state.enemies.filter(function(e) { return e.alive; });
}

var _spawnAccum = 0;
function updateWaves(dt) {
  if (!state.level || state.mode !== "playing") return;
  state.waveTime += dt;
  _spawnAccum += dt;
  var spawnInterval = Math.max(0.4, 2.0 - state.waveTime * 0.02);
  if (_spawnAccum >= spawnInterval) {
    _spawnAccum -= spawnInterval;
    var kind = state.waveTime > 20 ? "gunner" : "scout";
    var x = PLAY_X + 20 + Math.random() * (PLAY_W - 60);
    spawnEnemy(kind, x);
  }
}
