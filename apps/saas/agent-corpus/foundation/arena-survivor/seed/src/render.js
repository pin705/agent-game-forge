function renderFrame() {
  var ctx = dom.ctx;
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  if (state.mode === "loading") { drawLoading(ctx); return; }
  if (state.mode === "title") { drawTitle(ctx); return; }
  if (state.mode === "gameover") { drawGameOver(ctx); return; }
  drawArena(ctx);
  drawXpOrbs(ctx);
  drawProjectilesOnCanvas(ctx);
  drawEnemiesOnCanvas(ctx);
  drawPlayerOnCanvas(ctx);
  drawParticles(ctx);
  drawHud(ctx);
  if (state.mode === "levelup") drawLevelUpOverlay(ctx);
  if (state.mode === "paused") drawPauseOverlay(ctx);
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  crispText(ctx, t("loading"), VIEW.w / 2, VIEW.h / 2, "24px system-ui, sans-serif", COLORS.text, "center");
}

function drawTitle(ctx) {
  verticalBackdrop(ctx, "#141d30", "#070a12");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(60,196,122,0.05)", "rgba(0,0,0,0.6)");
  var pulse = 1 + Math.sin(state.time * 2) * 0.03;
  ctx.save();
  ctx.translate(VIEW.w / 2, 232);
  ctx.scale(pulse, pulse);
  crispText(ctx, t("title"), 0, 0, "bold 58px system-ui, sans-serif", COLORS.gold, "center");
  ctx.restore();
  crispText(ctx, t("tagline"), VIEW.w / 2, 292, "20px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("start"), VIEW.w / 2, 384, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function drawGameOver(ctx) {
  verticalBackdrop(ctx, "#2a0f12", "#080507");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(217,54,43,0.06)", "rgba(0,0,0,0.7)");
  crispText(ctx, t("gameOver"), VIEW.w / 2, 270, "bold 56px system-ui, sans-serif", COLORS.hp, "center");
  crispText(ctx, t("result", { k: state.killCount, s: state.score }), VIEW.w / 2, 332, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("retry"), VIEW.w / 2, 404, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function drawPauseOverlay(ctx) {
  ctx.fillStyle = "rgba(7,10,18,0.62)"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  crispText(ctx, t("paused"), VIEW.w / 2, VIEW.h / 2, "bold 40px system-ui, sans-serif", COLORS.text, "center");
}

function verticalBackdrop(ctx, top, bottom) {
  var g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function worldToScreen(wx, wy) {
  var sx = wx - state.camera.x + VIEW.w / 2;
  var sy = wy - state.camera.y + VIEW.h / 2;
  var shake = state.camera.shake > 0 ? (Math.random() * 2 - 1) * state.camera.shake : 0;
  return { x: sx + shake, y: sy + shake };
}

function drawArena(ctx) {
  verticalBackdrop(ctx, "#1d2740", "#0d1322");
  var gridSize = 64;
  var offX = (-(state.camera.x % gridSize) + VIEW.w / 2) % gridSize;
  var offY = (-(state.camera.y % gridSize) + VIEW.h / 2) % gridSize;
  ctx.strokeStyle = "rgba(120,160,220,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (var gx = offX; gx < VIEW.w; gx += gridSize) { ctx.moveTo(gx, 0); ctx.lineTo(gx, VIEW.h); }
  for (var gy = offY; gy < VIEW.h; gy += gridSize) { ctx.moveTo(0, gy); ctx.lineTo(VIEW.w, gy); }
  ctx.stroke();
  vignette(ctx, VIEW.w, VIEW.h, "rgba(80,150,255,0.05)", "rgba(0,0,0,0.55)");
}

function drawPlayerOnCanvas(ctx) {
  var p = state.player;
  if (!p) return;
  var s = worldToScreen(p.x, p.y);
  var flicker = p.invuln > 0 && Math.floor(state.time * 18) % 2 === 0;
  if (flicker) return;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(s.x, s.y + p.h / 2 - 2, p.w * 0.5, p.h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  softShape(ctx, s.x - p.w / 2, s.y - p.h / 2, p.w, p.h, 9, COLORS.jade, {
    gradTop: "#5fe6a8", gradBottom: "#1f8a57", glow: "rgba(60,196,122,0.7)", glowBlur: 16, stroke: "rgba(220,255,235,0.5)", lineWidth: 2
  });
  var dir = playerAimDir(p);
  glowDot(ctx, s.x + dir.x * (p.w * 0.22), s.y + dir.y * (p.h * 0.22), 4, "#eafff5", 8);
}

function playerAimDir(p) {
  if (typeof findNearest === "function") {
    var t = findNearest();
    if (t) { var dx = t.x - p.x, dy = t.y - p.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; }
  }
  return { x: 1, y: 0 };
}

function drawEnemiesOnCanvas(ctx) {
  if (!enemyPool) return;
  var alive = enemyPool.alive();
  for (var i = 0; i < alive.length; i++) {
    var e = alive[i];
    var s = worldToScreen(e.x, e.y);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + e.h / 2 - 1, e.w * 0.5, e.h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    softShape(ctx, s.x - e.w / 2, s.y - e.h / 2, e.w, e.h, 7, e.color, {
      gradTop: "#ff7a6e", gradBottom: e.color, glow: "rgba(220,70,60,0.5)", glowBlur: 12, stroke: "rgba(0,0,0,0.35)", lineWidth: 1, highlight: false
    });
    var flash = hurtFlash(e.hurtTimer || 0);
    if (flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = flash;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, e.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "rgba(20,8,8,0.85)";
    ctx.fillRect(s.x - e.w * 0.22, s.y - e.h * 0.12, 4, 4);
    ctx.fillRect(s.x + e.w * 0.22 - 4, s.y - e.h * 0.12, 4, 4);
    if (e.hp < e.maxHp) {
      gradientBar(ctx, s.x - e.w / 2, s.y - e.h / 2 - 8, e.w, 4, e.hp / e.maxHp, "#ff5d5d", "#ffd23f", "rgba(0,0,0,0.55)");
    }
  }
}

function drawProjectilesOnCanvas(ctx) {
  if (!projectilePool) return;
  var alive = projectilePool.alive();
  for (var i = 0; i < alive.length; i++) {
    var proj = alive[i];
    var s = worldToScreen(proj.x, proj.y);
    var vlen = Math.hypot(proj.vx || 0, proj.vy || 0) || 1;
    var tx = s.x - (proj.vx / vlen) * 12, ty = s.y - (proj.vy / vlen) * 12;
    ctx.save();
    ctx.strokeStyle = "rgba(120,210,255,0.5)";
    ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
    ctx.restore();
    glowDot(ctx, s.x, s.y, 5, "#aee9ff", 12);
  }
}

function drawXpOrbs(ctx) {
  if (!xpPool) return;
  var alive = xpPool.alive();
  var pulse = 1 + Math.sin(state.time * 6) * 0.18;
  for (var i = 0; i < alive.length; i++) {
    var o = alive[i];
    var s = worldToScreen(o.x, o.y);
    glowDot(ctx, s.x, s.y, 4.5 * pulse, COLORS.xp, 10);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
  }
}
