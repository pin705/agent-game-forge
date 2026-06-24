// Bullet emitters (bullet-patterns recipe). Each pattern is a pure function:
// origin + aim + def → spawns pooled bullets. Pattern defs live in
// data/shmup-config.json `bulletPatterns`. Player aim is FIXED upward.
function bulletDef(id) {
  return (cfg("bulletPatterns") || {})[id] || {};
}

function spawnBullet(side, def, x, y, vx, vy) {
  const pool = side === "player" ? playerBulletPool : enemyBulletPool;
  const b = pool.acquire();
  if (!b) return null; // pool exhausted → skip
  b.alive = true;
  b.side = side;
  b.x = x; b.y = y; b.vx = vx; b.vy = vy;
  b.r = def.radius ?? (side === "player" ? 5 : 6);
  b.dmg = def.dmg ?? 1;
  b.life = def.life ?? 5;
  b.color = side === "player" ? COLORS.playerBullet : COLORS.enemyBullet;
  (side === "player" ? state.playerBullets : state.enemyBullets).push(b);
  return b;
}

// emit(side, def, x, y, aim) — aim is a unit vector. type selects the emitter.
function emit(side, def, x, y, aim) {
  switch (def.type) {
    case "spread": return emitSpread(side, def, x, y, aim);
    case "ring": return emitRing(side, def, x, y);
    case "stream":
    default: return emitStream(side, def, x, y, aim);
  }
}

function emitStream(side, def, x, y, aim) {
  spawnBullet(side, def, x, y, aim.x * def.speed, aim.y * def.speed);
}

function emitSpread(side, def, x, y, aim) {
  const n = def.count ?? 5;
  const arc = (def.arc ?? 40) * Math.PI / 180;
  const base = Math.atan2(aim.y, aim.x);
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : (i / (n - 1)) - 0.5; // centered on aim
    const a = base + t * arc;
    spawnBullet(side, def, x, y, Math.cos(a) * def.speed, Math.sin(a) * def.speed);
  }
}

function emitRing(side, def, x, y) {
  const n = def.count ?? 12;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    spawnBullet(side, def, x, y, Math.cos(a) * def.speed, Math.sin(a) * def.speed);
  }
}
