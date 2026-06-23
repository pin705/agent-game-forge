function canAffordTower(type) {
  var def = TOWER_TYPES[type];
  return def && state.gold >= def.cost;
}

function spotOccupied(spotId) {
  for (var i = 0; i < state.towers.length; i++) {
    if (state.towers[i].spotId === spotId) return true;
  }
  return false;
}

function placeTower(spotId, x, y) {
  var type = state.selectedTowerType || "archer";
  var def = TOWER_TYPES[type];
  if (!def || state.gold < def.cost) return;
  if (spotOccupied(spotId)) return;
  state.gold -= def.cost;
  state.towers.push({
    spotId: spotId,
    type: type,
    x: x, y: y,
    damage: def.damage,
    range: def.range,
    cooldown: def.cooldown,
    cooldownTimer: 0,
    color: def.color
  });
  floater("-$" + def.cost, x, y - 10, { color: COLORS.gold, size: 14 });
}

function updateTowers(dt) {
  for (var ti = 0; ti < state.towers.length; ti++) {
    var tower = state.towers[ti];
    tower.cooldownTimer = Math.max(0, tower.cooldownTimer - dt);
    if (tower.cooldownTimer > 0) continue;
    // Find first enemy (highest t) in range
    var best = null, bestT = -1;
    for (var ei = 0; ei < state.enemies.length; ei++) {
      var e = state.enemies[ei];
      if (!e.alive) continue;
      var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (Math.hypot(cx - tower.x, cy - tower.y) <= tower.range && e.t > bestT) {
        best = e; bestT = e.t;
      }
    }
    if (best) {
      tower.cooldownTimer = tower.cooldown;
      var tcx = best.x + best.w / 2, tcy = best.y + best.h / 2;
      state.projectiles.push({ alive: true, x: tower.x, y: tower.y, tx: tcx, ty: tcy, targetId: best.id, speed: 400, damage: tower.damage });
    }
  }
}

function updateProjectiles(dt) {
  for (var i = state.projectiles.length - 1; i >= 0; i--) {
    var p = state.projectiles[i];
    if (!p.alive) { state.projectiles.splice(i, 1); continue; }
    var dx = p.tx - p.x, dy = p.ty - p.y;
    var dist = Math.hypot(dx, dy);
    if (dist < 8) {
      // Hit
      var target = null;
      for (var j = 0; j < state.enemies.length; j++) {
        if (state.enemies[j].id === p.targetId && state.enemies[j].alive) { target = state.enemies[j]; break; }
      }
      if (target) {
        target.hp -= p.damage;
        floater("-" + p.damage, p.x, p.y, { color: "#ffd23f", size: 14 });
        hitstop(0.03);
        bumpCombo();
        if (target.hp <= 0) {
          target.alive = false;
          state.gold += target.reward;
          burstParticles(p.x, p.y, 5, target.color);
          floater("+$" + target.reward, p.x, p.y - 18, { color: COLORS.gold, size: 13 });
        }
      }
      state.projectiles.splice(i, 1);
    } else {
      var spd = Math.min(p.speed * dt, dist);
      p.x += (dx / dist) * spd;
      p.y += (dy / dist) * spd;
    }
  }
}
