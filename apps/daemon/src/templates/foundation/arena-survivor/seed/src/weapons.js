var _weaponTimer = 0;
var WEAPON_COOLDOWN = 1.2;

function findNearest() {
  if (!enemyPool) return null;
  var p = state.player;
  if (!p) return null;
  var best = null, bestDist = Infinity;
  var alive = enemyPool.alive();
  for (var i = 0; i < alive.length; i++) {
    var d = Math.hypot(alive[i].x - p.x, alive[i].y - p.y);
    if (d < bestDist) { bestDist = d; best = alive[i]; }
  }
  return best;
}

function updateWeapons(dt) {
  if (!state.player || state.mode !== "playing") return;
  _weaponTimer -= dt;
  if (_weaponTimer <= 0) {
    _weaponTimer = WEAPON_COOLDOWN;
    var target = findNearest();
    if (target && projectilePool) {
      var proj = projectilePool.get();
      if (proj) {
        proj.alive = true;
        proj.x = state.player.x; proj.y = state.player.y;
        var dx = target.x - proj.x, dy = target.y - proj.y;
        var len = Math.hypot(dx, dy) || 1;
        proj.vx = (dx / len) * 420; proj.vy = (dy / len) * 420;
        proj.damage = 5; proj.ttl = 2;
      }
    }
  }
}

function updateProjectiles(dt) {
  if (!projectilePool || !enemyPool) return;
  var projs = projectilePool.alive();
  var enemies = enemyPool.alive();
  for (var i = 0; i < projs.length; i++) {
    var proj = projs[i];
    proj.x += proj.vx * dt; proj.y += proj.vy * dt;
    proj.ttl -= dt;
    if (proj.ttl <= 0) { proj.alive = false; continue; }
    for (var j = 0; j < enemies.length; j++) {
      var e = enemies[j];
      if (Math.abs(proj.x - e.x) < 20 && Math.abs(proj.y - e.y) < 20) {
        e.hp -= proj.damage;
        proj.alive = false;
        hitstop(0.04);
        bumpCombo();
        var sx = proj.x - state.camera.x + VIEW.w/2;
        var sy = proj.y - state.camera.y + VIEW.h/2;
        floater("-" + proj.damage, sx, sy, { color: "#ffd23f" });
        burstParticles(sx, sy, 4, e.color);
        if (e.hp <= 0) {
          e.alive = false;
          state.killCount++;
          state.score += 10;
          spawnXpOrb(e.x, e.y);
          screenshake(3, 0.08);
        }
        break;
      }
    }
  }
}
