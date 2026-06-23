function spawnParticle(x, y, opts) {
  var o = opts || {};
  state.particles.push({
    x: x,
    y: y,
    vx: o.vx !== undefined ? o.vx : (Math.random() * 2 - 1) * 90,
    vy: o.vy !== undefined ? o.vy : -Math.random() * 90,
    life: o.life !== undefined ? o.life : 0.35,
    maxLife: o.life !== undefined ? o.life : 0.35,
    size: o.size !== undefined ? o.size : 3,
    color: o.color !== undefined ? o.color : COLORS.gold
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
}

function drawParticles(ctx) {
  for (var i = 0; i < state.particles.length; i++) {
    var p = state.particles[i];
    var alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function screenshake(amount, seconds) {
  state.camera.shake = Math.max(state.camera.shake, amount);
  state.camera.shakeT = Math.max(state.camera.shakeT, seconds);
}
