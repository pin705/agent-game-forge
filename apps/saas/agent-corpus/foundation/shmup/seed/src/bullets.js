// Bullet update + off-screen cull + hit resolution (bullet-patterns recipe).
function offScreen(b) {
  const m = 48; // margin so bullets aren't culled at the very edge
  return b.x < -m || b.x > VIEW.w + m || b.y < -m || b.y > VIEW.h + m;
}

function updateBulletList(list, dt) {
  for (const b of list) {
    if (!b.alive) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || offScreen(b)) b.alive = false;
  }
  // compact: drop dead bullets so render/iter stay cheap (objects return to pool)
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!list[i].alive) list.splice(i, 1);
  }
}

function updateBullets(dt) {
  updateBulletList(state.playerBullets, dt);
  updateBulletList(state.enemyBullets, dt);
}

function circleHit(b, ex, ey, er) {
  const r = b.r + er;
  const dx = b.x - ex;
  const dy = b.y - ey;
  return dx * dx + dy * dy <= r * r;
}

function resolveBulletHits() {
  // player shots → enemies
  for (const b of state.playerBullets) {
    if (!b.alive) continue;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (circleHit(b, e.x, e.y, e.r)) {
        damageEnemy(e, b.dmg);
        b.alive = false;
        break;
      }
    }
  }
  // enemy shots → player (only when not invulnerable; tiny center hitbox = grazing feel)
  const p = state.player;
  if (p && p.invuln <= 0) {
    for (const b of state.enemyBullets) {
      if (!b.alive) continue;
      if (circleHit(b, p.x, p.y, p.hitboxR)) {
        b.alive = false;
        damagePlayer();
        break;
      }
    }
  }
}
