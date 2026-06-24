var _weaponTimer = 0;
var WEAPON_COOLDOWN = 1.2;   // overwritten from CONFIG.weapon.cooldown at run start

function findNearest() {
  if (!enemyPool) return null;
  var p = state.player;
  if (!p) return null;
  var w = CONFIG ? CONFIG.weapon : { range: Infinity };
  var best = null, bestDist = Infinity;
  var alive = enemyPool.alive();
  for (var i = 0; i < alive.length; i++) {
    var d = Math.hypot(alive[i].x - p.x, alive[i].y - p.y);
    if (d < bestDist && d <= w.range) { bestDist = d; best = alive[i]; }
  }
  return best;
}

function updateWeapons(dt) {
  if (!state.player || state.mode !== "playing") return;
  var w = CONFIG.weapon;
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
        proj.vx = (dx / len) * w.projectileSpeed; proj.vy = (dy / len) * w.projectileSpeed;
        proj.damage = w.damage; proj.ttl = w.projectileLife;
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
    var hitR = CONFIG.weapon.hitRadius;
    for (var j = 0; j < enemies.length; j++) {
      var e = enemies[j];
      if (Math.abs(proj.x - e.x) < hitR && Math.abs(proj.y - e.y) < hitR) {
        e.hp -= proj.damage;
        proj.alive = false;
        var sx = proj.x - state.camera.x + VIEW.w / 2;
        var sy = proj.y - state.camera.y + VIEW.h / 2;
        // Enemy-hit juice (juice.md per-event checklist).
        bumpCombo();
        screenshake(4 * comboMul(), 0.1);
        hitstop(0.04);
        floater("-" + proj.damage, sx, sy - 20, { color: "#ffd23f" });
        burstParticles(sx, sy, 8, COLORS.gold);
        e.hurtTimer = 0.18;
        playSfx("hit");
        if (e.hp <= 0) {
          // Enemy-killed juice — bigger than a hit.
          e.alive = false;
          state.killCount++;
          state.score += 10;
          spawnXpOrb(e.x, e.y);
          screenshake(7, 0.14);
          hitstop(0.08);
          burstParticles(sx, sy, 16, e.color);
          playSfx("death");
        }
        break;
      }
    }
  }
}
