// Wave director + formations + flight paths (enemy-waves recipe). A time-keyed
// script (data/waves.json) spawns formations of enemies that fly shared paths
// and fire bullet patterns. Movement (path) is decoupled from shooting
// (shootScript). When the script runs out, it loops with a difficulty ramp.
let waveScript = [];
let waveCursor = 0;     // index of the next wave to start
let waveTimer = 0;      // seconds until the next wave fires
let loopCount = 0;      // how many times we've cycled the script (ramps difficulty)

function initWaves() {
  waveScript = (cfg("waves").waves || []).map((w) => ({ ...w }));
  waveCursor = 0;
  loopCount = 0;
  waveTimer = cfg("waves").firstWaveDelay ?? 1.2;
}

// --- Formations: member index → offset from the group anchor -----------------
function formationOffset(name, i, count, spacing) {
  switch (name) {
    case "column":
      return { x: 0, y: i * spacing };
    case "v_shape": {
      const half = (count - 1) / 2;
      const d = i - half;
      return { x: d * spacing, y: Math.abs(d) * spacing * 0.6 };
    }
    case "line":
    default:
      return { x: (i - (count - 1) / 2) * spacing, y: 0 };
  }
}

// --- Paths: local time t → offset from spawn origin --------------------------
const paths = {
  straight: (t, e) => ({ x: 0, y: e.amp * 0 + 110 * t }),
  sine: (t, e) => ({ x: Math.sin(t * (Math.PI * 2 / e.period)) * e.amp, y: 95 * t }),
  swoop: (t, e) => ({ x: Math.sin(t * 1.6) * e.amp, y: 80 * t + 40 * Math.sin(t) }),
  dive: (t) => ({ x: 0, y: 200 * t })
};

function updateWaves(dt) {
  // start the next wave when its timer elapses
  waveTimer -= dt;
  if (waveTimer <= 0 && waveScript.length) {
    spawnWave(waveScript[waveCursor]);
    waveCursor += 1;
    state.wave += 1;
    if (waveCursor >= waveScript.length) {
      waveCursor = 0;
      loopCount += 1; // looped the script → harder next cycle
    }
    waveTimer = (waveScript[waveCursor].gap ?? 4);
  }
  updateEnemies(dt);
  updateEnemyShooting(dt);
}

function spawnWave(wave) {
  const count = wave.count ?? 5;
  const spacing = wave.spacing ?? 70;
  const anchorX = VIEW.w / 2 + (wave.anchorX ?? 0);
  const anchorY = -60;
  const ramp = 1 + loopCount * 0.18; // hp/aggression scale per loop
  for (let i = 0; i < count; i += 1) {
    const off = formationOffset(wave.formation || "line", i, count, spacing);
    const e = enemyPool.acquire();
    if (!e) break;
    const type = cfg("enemies")[wave.enemyType] || {};
    e.alive = true;
    e.type = wave.enemyType;
    e.spawnX = anchorX + off.x;
    e.spawnY = anchorY + off.y - i * (wave.trickle ?? 0);
    e.x = e.spawnX;
    e.y = e.spawnY;
    e.w = type.size ?? 44;
    e.h = type.size ?? 44;
    e.r = (type.size ?? 44) / 2;
    e.maxHp = Math.ceil((type.hp ?? 2) * ramp);
    e.hp = e.maxHp;
    e.score = type.score ?? 100;
    e.color = type.color || COLORS.enemy;
    e.t = 0;
    e.path = wave.path || "straight";
    e.amp = wave.amp ?? 160;
    e.period = wave.period ?? 2.4;
    e.shootScript = type.shootScript || null;
    e.shootTimer = (bulletDef(e.shootScript).interval ?? 1.4) * (0.5 + Math.random() * 0.5);
    e.hurt = 0;
    state.enemies.push(e);
  }
}

function updateEnemies(dt) {
  const p = state.player;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.t += dt;
    if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
    const fn = paths[e.path] || paths.straight;
    const off = fn(e.t, e);
    e.x = e.spawnX + off.x;
    e.y = e.spawnY + off.y;
    // body collision: enemy touches the ship → player loses a life
    if (p && p.invuln <= 0) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const rr = e.r + p.hitboxR;
      if (dx * dx + dy * dy <= rr * rr) {
        e.alive = false;
        burstParticles(e.x, e.y, 18, e.color);
        damagePlayer();
      }
    }
    // cull when fully past the bottom edge
    if (e.y > VIEW.h + 80) e.alive = false;
  }
  // compact dead enemies
  for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
    if (!state.enemies[i].alive) state.enemies.splice(i, 1);
  }
}

function updateEnemyShooting(dt) {
  for (const e of state.enemies) {
    if (!e.alive || !e.shootScript) continue;
    e.shootTimer -= dt;
    if (e.shootTimer <= 0) {
      const def = bulletDef(e.shootScript);
      e.shootTimer = def.interval ?? 1.4;
      // aim straight down, or toward the player if the def asks
      let aim = { x: 0, y: 1 };
      if (def.aimPlayer && state.player) {
        const dx = state.player.x - e.x;
        const dy = state.player.y - e.y;
        const len = Math.hypot(dx, dy) || 1;
        aim = { x: dx / len, y: dy / len };
      }
      emit("enemy", def, e.x, e.y + e.h / 2, aim);
    }
  }
}

function damageEnemy(e, dmg) {
  e.hp -= dmg;
  e.hurt = 0.12;
  if (e.hp > 0) {
    // small chip feedback on a non-lethal hit
    burstParticles(e.x, e.y, 4, COLORS.gold);
    return;
  }
  e.alive = false;
  bumpCombo();
  state.score += e.score;
  // juice: kill → shake + burst + score floater (conventions/juice.md enemy-hit)
  screenshake(6, 0.18);
  hitstop(0.05);
  burstParticles(e.x, e.y, 20, e.color);
  burstParticles(e.x, e.y, 8, COLORS.gold);
  floater("+" + e.score, e.x, e.y - 18, { color: COLORS.gold });
}
