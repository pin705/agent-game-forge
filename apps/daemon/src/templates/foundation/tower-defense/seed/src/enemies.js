// enemies.js — spawn + waypoint follow + leak. Combat death (hp<=0) is in
// projectiles.js. Distance-along-path model. (recipes/path-and-waves.md)
function spawnEnemy(group) {
  const def = ENEMY_DEFS[group.type] || ENEMY_DEFS.scout;
  const start = state.path.points[0];
  state.enemies.push({
    id: `e_${state.enemySeq++}`,
    type: group.type,
    x: start.x,
    y: start.y,
    dist: 0,
    hp: group.hp,
    maxHp: group.hp,
    speed: group.speed,
    reward: def.reward,
    leakDamage: def.leak,
    radius: def.radius,
    color: def.color,
    slowMul: 1,
    slowTtl: 0,
    facing: 1,
    hurtTimer: 0,
    dead: false,
    leaked: false
  });
}

// derived 0..1 progress along the path (drives "first" targeting)
function pathProgress(e) {
  return state.path.totalLength > 0 ? e.dist / state.path.totalLength : 0;
}

function updateEnemies(dt) {
  const path = state.path;
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (e.hurtTimer > 0) e.hurtTimer = Math.max(0, e.hurtTimer - dt);
    if (e.slowTtl > 0) { e.slowTtl -= dt; if (e.slowTtl <= 0) e.slowMul = 1; }

    const prevX = e.x;
    e.dist += e.speed * e.slowMul * dt;

    if (e.dist >= path.totalLength) {
      e.leaked = true;
      e.dead = true;
      continue;
    }
    const p = pointAtDistance(path, e.dist);
    e.facing = p.x >= prevX ? 1 : -1;
    e.x = p.x;
    e.y = p.y;
  }
  // charge leaks BEFORE filtering so economy reacts this frame. Combat deaths
  // (hp<=0) already called notifyEnemyRemoved() in damageEnemy; leaks notify here.
  for (const e of state.enemies) {
    if (e.leaked) { loseLives(e.leakDamage); notifyEnemyRemoved(); }
  }
  state.enemies = state.enemies.filter((e) => !e.dead);
}
