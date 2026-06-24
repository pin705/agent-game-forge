// All drawing — Canvas2D primitives only, ZERO external assets.
function renderFrame() {
  const ctx = dom.ctx;
  drawBackground(ctx);
  if (state.mode === "loading") { drawLoading(ctx); return; }
  if (state.mode === "title") { drawStars(ctx); drawTitle(ctx); return; }

  // screen shake: jitter the world layer (particles.js ticks shakeT)
  ctx.save();
  if (state.camera.shake > 0) {
    const s = state.camera.shake;
    ctx.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
  }
  drawStars(ctx);
  drawEnemies(ctx);
  drawBulletList(ctx, state.enemyBullets);
  drawPlayer(ctx);
  drawBulletList(ctx, state.playerBullets);
  drawParticles(ctx);
  ctx.restore();

  drawHud(ctx);
  if (state.mode === "paused") drawPaused(ctx);
  if (state.mode === "gameover") drawGameOver(ctx);
}

function drawBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  grad.addColorStop(0, COLORS.ink);
  grad.addColorStop(1, COLORS.inkLow);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.text;
  ctx.font = "24px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Loading…", VIEW.w / 2, VIEW.h / 2);
  ctx.textAlign = "left";
}

function drawTitle(ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(5,6,15,0.5)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.ship;
  ctx.font = "bold 72px system-ui, sans-serif";
  ctx.fillText(GAME.title, VIEW.w / 2, 250);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "22px system-ui, sans-serif";
  ctx.fillText(GAME.tagline, VIEW.w / 2, 300);

  // a preview ship so the title screen shows the asset-free craft
  drawShipShape(ctx, VIEW.w / 2, 420, 46, COLORS.ship, COLORS.shipEdge, false);

  if (Math.floor(state.titleBlink * 2) % 2 === 0) {
    ctx.fillStyle = COLORS.text;
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillText("Press ENTER / SPACE to launch", VIEW.w / 2, 540);
  }
  ctx.fillStyle = COLORS.muted;
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText("Arrows / WASD move  •  Space / J fire  •  P pause", VIEW.w / 2, 590);
  ctx.restore();
}

// --- Ship sprite: an upward-pointing triangle + cockpit + thruster flame ------
function drawShipShape(ctx, cx, cy, size, body, edge, thrust) {
  const h = size;
  const w = size * 0.85;
  ctx.save();
  if (thrust) {
    const fl = 0.6 + Math.random() * 0.5;
    ctx.fillStyle = COLORS.thrust;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.22, cy + h * 0.42);
    ctx.lineTo(cx, cy + h * 0.42 + h * 0.5 * fl);
    ctx.lineTo(cx + w * 0.22, cy + h * 0.42);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.55);          // nose
  ctx.lineTo(cx + w * 0.5, cy + h * 0.42); // right wing
  ctx.lineTo(cx + w * 0.18, cy + h * 0.42);
  ctx.lineTo(cx, cy + h * 0.2);
  ctx.lineTo(cx - w * 0.18, cy + h * 0.42);
  ctx.lineTo(cx - w * 0.5, cy + h * 0.42); // left wing
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  // cockpit
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.arc(cx, cy - h * 0.12, size * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(ctx) {
  const p = state.player;
  if (!p) return;
  // i-frame flicker
  if (p.invuln > 0 && Math.floor(state.time * 20) % 2 === 0) return;
  drawShipShape(ctx, p.x, p.y, p.h, COLORS.ship, COLORS.shipEdge, true);
}

// --- Enemy sprite: an inverted (downward) chevron, hurt-flash on hit ----------
function drawEnemies(ctx) {
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const s = e.h;
    const w = s * 0.9;
    ctx.save();
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y + s * 0.55);            // nose points down
    ctx.lineTo(e.x + w * 0.5, e.y - s * 0.42);
    ctx.lineTo(e.x + w * 0.16, e.y - s * 0.42);
    ctx.lineTo(e.x, e.y - s * 0.18);
    ctx.lineTo(e.x - w * 0.16, e.y - s * 0.42);
    ctx.lineTo(e.x - w * 0.5, e.y - s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLORS.enemyEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    const a = hurtFlash(e.hurt); // juice.js — white-out on hit
    if (a) {
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
    ctx.restore();
  }
}

// Particle draw lives here (particles.js is copied verbatim from the side-scroll
// seed, which renders particles in its own render.js — so the seed owns this).
function drawParticles(ctx) {
  ctx.save();
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBulletList(ctx, list) {
  ctx.save();
  for (const b of list) {
    if (!b.alive) continue;
    ctx.fillStyle = b.color;
    if (b.side === "player") {
      ctx.fillRect(b.x - b.r * 0.5, b.y - b.r * 1.4, b.r, b.r * 2.8);
    } else {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPaused(ctx) {
  overlayText(ctx, "PAUSED", "Press P to resume");
}

function drawGameOver(ctx) {
  overlayText(ctx, "GAME OVER", "Score " + state.score + "  •  Press ENTER to retry");
}

function overlayText(ctx, big, small) {
  ctx.save();
  ctx.fillStyle = "rgba(5,6,15,0.65)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.fillText(big, VIEW.w / 2, VIEW.h / 2 - 10);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "22px system-ui, sans-serif";
  ctx.fillText(small, VIEW.w / 2, VIEW.h / 2 + 40);
  ctx.restore();
}
