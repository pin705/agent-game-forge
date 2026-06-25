// Object pools — shmup spawns/frees bullets + enemies every frame; `new` in the
// hot loop causes GC stutter (the #1 shmup perf bug, per genres/shmup.md).
// Each pool pre-allocates `cap` objects and hands out dead ones via acquire().
function makePool(cap, make) {
  const items = [];
  for (let i = 0; i < cap; i += 1) items.push(make());
  return {
    items,
    acquire() {
      for (const it of items) {
        if (!it.alive) return it;
      }
      return null; // pool exhausted → caller skips (no allocation spike)
    }
  };
}

function mkBullet() {
  return { alive: false, side: null, x: 0, y: 0, vx: 0, vy: 0, r: 5, dmg: 1, life: 0, color: "#fff" };
}

function mkEnemy() {
  return {
    alive: false, type: null, x: 0, y: 0, spawnX: 0, spawnY: 0,
    w: 44, h: 44, r: 22, hp: 1, maxHp: 1, score: 0, color: "#fff",
    t: 0, path: null, amp: 0, period: 1,
    shootScript: null, shootTimer: 0, hurt: 0
  };
}

let playerBulletPool, enemyBulletPool, enemyPool;

function initPools() {
  playerBulletPool = makePool(120, mkBullet);
  enemyBulletPool = makePool(400, mkBullet);
  enemyPool = makePool(80, mkEnemy);
}
