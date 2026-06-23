function spawnParticle(x, y, opts) {
  if (!opts) opts = {};
  state.particles.push({
    x: x,
    y: y,
    vx: opts.vx !== undefined ? opts.vx : (Math.random() * 2 - 1) * 90,
    vy: opts.vy !== undefined ? opts.vy : -Math.random() * 90,
    life: opts.life !== undefined ? opts.life : 0.35,
    maxLife: opts.life !== undefined ? opts.life : 0.35,
    size: opts.size !== undefined ? opts.size : 3,
    color: opts.color !== undefined ? opts.color : COLORS.gold
  });
}

function burstParticles(x, y, count, color) {
  for (let i = 0; i < count; i += 1) {
    spawnParticle(x, y, { color: color, vx: (Math.random() * 2 - 1) * 150, vy: -40 - Math.random() * 160 });
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
    const alpha = p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function screenshake(amount, seconds) {
  state.camera.shake = Math.max(state.camera.shake, amount);
  state.camera.shakeT = Math.max(state.camera.shakeT, seconds);
}
