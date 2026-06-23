function spawnParticle(x, y, opts) {
  opts = opts || {};
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
  for (var i = 0; i < count; i++) {
    spawnParticle(x, y, { color: color, vx: (Math.random() * 2 - 1) * 150, vy: -40 - Math.random() * 160 });
  }
}

function updateParticles(dt) {
  for (var i = 0; i < state.particles.length; i++) {
    var p = state.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 320 * dt;
  }
  state.particles = state.particles.filter(function(p) { return p.life > 0; });
  if (state.camera.shakeT > 0) {
    state.camera.shakeT -= dt;
    if (state.camera.shakeT <= 0) state.camera.shake = 0;
  }
}

function drawParticles(ctx) {
  for (var i = 0; i < state.particles.length; i++) {
    var p = state.particles[i];
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
