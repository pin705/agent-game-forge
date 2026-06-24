// particles.js — spark/burst particles + screenshake (vanilla, zero deps).
// Copied from the side-scroll seed; the only adaptation is that this seed has no
// config loader, so the spark speed/life defaults are inline constants instead of
// cfg("hud").particles. drawParticles() is added because this seed renders its own
// particles (the side-scroll seed draws them inside its draw layer).
const PARTICLE_DEFAULTS = Object.freeze({ sparkSpeed: 90, sparkLife: 0.35 });

function spawnParticle(x, y, opts = {}) {
  const visual = PARTICLE_DEFAULTS;
  state.particles.push({
    x,
    y,
    vx: opts.vx ?? (Math.random() * 2 - 1) * (visual.sparkSpeed ?? 90),
    vy: opts.vy ?? -Math.random() * (visual.sparkSpeed ?? 90),
    life: opts.life ?? visual.sparkLife ?? 0.35,
    maxLife: opts.life ?? visual.sparkLife ?? 0.35,
    size: opts.size ?? 3,
    color: opts.color ?? COLORS.gold
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

function screenshake(amount, seconds) {
  state.camera.shake = Math.max(state.camera.shake, amount);
  state.camera.shakeT = Math.max(state.camera.shakeT, seconds);
}

// Particles are spawned in SCREEN space (callers pass screen coords), so this
// draws straight to the canvas without the camera transform.
function drawParticles(ctx) {
  for (let i = 0; i < state.particles.length; i += 1) {
    const p = state.particles[i];
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
