// projectiles.js — pooled projectiles: spawn from a tower, travel toward the
// target, hit (single or splash), apply slow, deal damage + pay gold on kill.
// (recipes/towers-and-targeting.md). Shares global `state`.
const projPool = [];
function getProjectile() { return projPool.pop() || {}; }
function freeProjectile(p) { p.dead = true; projPool.push(p); }

function fireTower(t, target) {
  const type = towerTypeById(t.typeId);
  if (!type) return;
  const p = getProjectile();
  const speed = type.projSpeed || 500;
  const a = Math.atan2(target.y - t.y, target.x - t.x);
  p.x = t.x;
  p.y = t.y;
  p.vx = Math.cos(a) * speed;
  p.vy = Math.sin(a) * speed;
  p.damage = t.damage;
  p.target = target;
  p.color = type.projColor || "#ffffff";
  p.splashRadius = type.splashRadius || 0;
  p.slowMul = type.slowMul || 1;
  p.slowDuration = type.slowDuration || 0;
  p.dead = false;
  state.projectiles.push(p);

  // JUICE: muzzle spark + tower recoil kick
  t.recoil = 1;
  burstParticles(t.x + Math.cos(a) * 14, t.y + Math.sin(a) * 14, 4, p.color);
}

function updateProjectiles(dt) {
  for (const p of state.projectiles) {
    if (p.dead) continue;
    // light homing so shots connect on the curvy path
    if (p.target && !p.target.dead) {
      const a = Math.atan2(p.target.y - p.y, p.target.x - p.x);
      const sp = Math.hypot(p.vx, p.vy);
      const ca = Math.atan2(p.vy, p.vx);
      const na = ca + Math.max(-0.18, Math.min(0.18, angleDiff(a, ca)));
      p.vx = Math.cos(na) * sp;
      p.vy = Math.sin(na) * sp;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < -40 || p.y < -40 || p.x > VIEW.w + 40 || p.y > VIEW.h + 40) {
      freeProjectile(p);
      continue;
    }
    const tgt = p.target;
    if (tgt && !tgt.dead && Math.hypot(tgt.x - p.x, tgt.y - p.y) <= tgt.radius + 6) {
      applyHit(p, tgt);
      freeProjectile(p);
    }
  }
  state.projectiles = state.projectiles.filter((p) => !p.dead);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function applyHit(p, primary) {
  if (p.splashRadius > 0) {
    burstParticles(p.x, p.y, 12, p.color);
    screenshake(3, 0.08);
    for (const e of state.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) <= p.splashRadius) damageEnemy(e, p);
    }
  } else {
    damageEnemy(primary, p);
  }
}

function damageEnemy(e, p) {
  if (e.dead) return;
  e.hp -= p.damage;
  e.hurtTimer = 0.18;
  if (p.slowDuration > 0) { e.slowMul = Math.min(e.slowMul, p.slowMul); e.slowTtl = p.slowDuration; }

  // JUICE: hit feedback — floater + tiny shake + combo
  bumpCombo();
  floater(Math.round(p.damage), e.x, e.y - e.radius - 6, { color: "#ffd23f", size: 16 });
  screenshake(2 * comboMul(), 0.06);
  burstParticles(e.x, e.y, 5, p.color);

  if (e.hp <= 0) {
    e.dead = true;
    // JUICE: death — bigger burst + hitstop + reward floater
    burstParticles(e.x, e.y, 16, e.color);
    screenshake(5, 0.12);
    hitstop(0.06);
    floater(`+${e.reward}`, e.x, e.y - 8, { color: "#7CFC00", size: 18 });
    earnGold(e.reward);
    notifyEnemyRemoved();
  }
}
