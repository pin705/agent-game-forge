// particles.js — asset-free spark bursts + screenshake. Self-contained (no config
// file): mirrors side-scroll seed's burstParticles/screenshake API so juice.md
// wiring is identical. Particles live in world/screen pixels (same space as render).

function spawnParticle(x, y, opts) {
  const o = opts || {};
  state.particles.push({
    x,
    y,
    vx: o.vx !== undefined ? o.vx : (Math.random() * 2 - 1) * 90,
    vy: o.vy !== undefined ? o.vy : -Math.random() * 90,
    life: o.life !== undefined ? o.life : 0.4,
    maxLife: o.life !== undefined ? o.life : 0.4,
    size: o.size !== undefined ? o.size : 4,
    color: o.color !== undefined ? o.color : COLORS.gold
  });
}

function burstParticles(x, y, count, color) {
  for (let i = 0; i < count; i += 1) {
    spawnParticle(x, y, { color, vx: (Math.random() * 2 - 1) * 150, vy: -40 - Math.random() * 160 });
  }
}

function updateParticles(dt) {
  for (const p of state.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 320 * dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  if (state.camera.shakeT > 0) {
    state.camera.shakeT -= dt;
    if (state.camera.shakeT <= 0) state.camera.shake = 0;
  }
}

function drawParticles(ctx) {
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function screenshake(amount, seconds) {
  state.camera.shake = Math.max(state.camera.shake, amount);
  state.camera.shakeT = Math.max(state.camera.shakeT, seconds);
}
