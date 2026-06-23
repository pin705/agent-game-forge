var _stars = [];
function initStars() {
  _stars = [];
  for (var i = 0; i < 120; i++) {
    // tier: 0 far/dim, 1 mid, 2 near/bright — gives parallax depth
    var tier = i % 3;
    _stars.push({
      x: PLAY_X + Math.random() * PLAY_W,
      y: Math.random() * VIEW.h,
      size: tier === 2 ? Math.random() * 1.4 + 1.4 : tier === 1 ? Math.random() * 1 + 0.9 : Math.random() * 0.8 + 0.4,
      speed: tier === 2 ? 120 + Math.random() * 90 : tier === 1 ? 70 + Math.random() * 50 : 30 + Math.random() * 30,
      tier: tier
    });
  }
}

function renderFrame() {
  var ctx = dom.ctx;
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  if (state.mode === "loading") { drawLoading(ctx); return; }
  if (state.mode === "title")   { drawTitle(ctx); return; }
  if (state.mode === "gameover") { drawGameOver(ctx); return; }
  drawBackground(ctx);
  drawEnemyBulletsCanvas(ctx);
  drawPlayerBulletsCanvas(ctx);
  drawEnemiesCanvas(ctx);
  drawPlayerCanvas(ctx);
  drawParticles(ctx);
  drawHud(ctx);
  if (state.mode === "paused") {
    ctx.fillStyle = "rgba(5,7,15,0.62)"; ctx.fillRect(0,0,VIEW.w,VIEW.h);
    crispText(ctx, t("paused"), VIEW.w/2, VIEW.h/2, "bold 40px system-ui, sans-serif", COLORS.text, "center");
  }
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0,0,VIEW.w,VIEW.h);
  crispText(ctx, t("loading"), VIEW.w/2, VIEW.h/2, "24px system-ui, sans-serif", COLORS.text, "center");
}

function _verticalBackdrop(ctx, top, bottom) {
  var g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function drawTitle(ctx) {
  _verticalBackdrop(ctx, "#0e1a38", "#05070f");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(74,248,239,0.05)", "rgba(0,0,0,0.62)");
  var pulse = 1 + Math.sin(state.time * 2) * 0.03;
  ctx.save();
  ctx.translate(VIEW.w / 2, 240);
  ctx.scale(pulse, pulse);
  crispText(ctx, t("title"), 0, 0, "bold 58px system-ui, sans-serif", COLORS.gold, "center");
  ctx.restore();
  crispText(ctx, t("tagline"), VIEW.w/2, 300, "20px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("start"), VIEW.w/2, 388, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function drawGameOver(ctx) {
  _verticalBackdrop(ctx, "#2a0f12", "#080507");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(217,54,43,0.06)", "rgba(0,0,0,0.7)");
  crispText(ctx, t("gameOver"), VIEW.w/2, 278, "bold 56px system-ui, sans-serif", COLORS.hp, "center");
  crispText(ctx, t("result", { s: state.score }), VIEW.w/2, 340, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("retry"), VIEW.w/2, 402, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function drawBackground(ctx) {
  // Deep-space vertical gradient for the play field
  var g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  g.addColorStop(0, "#0a1228"); g.addColorStop(1, "#05070f");
  ctx.fillStyle = g;
  ctx.fillRect(PLAY_X, 0, PLAY_W, VIEW.h);
  // Darker gradient side panels so the play field pops
  var sg = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  sg.addColorStop(0, "#060912"); sg.addColorStop(1, "#02030a");
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, PLAY_X, VIEW.h);
  ctx.fillRect(PLAY_X + PLAY_W, 0, VIEW.w - PLAY_X - PLAY_W, VIEW.h);
  // Scroll stars as soft glowing dots in brightness tiers (far/mid/near)
  for (var i = 0; i < _stars.length; i++) {
    var s = _stars[i];
    s.y += s.speed * 0.016;
    if (s.y > VIEW.h + 4) { s.y = -4; s.x = PLAY_X + Math.random() * PLAY_W; }
    if (s.tier === 2) {
      glowDot(ctx, s.x, s.y, s.size, "rgba(200,230,255,0.95)", 6);
    } else if (s.tier === 1) {
      ctx.fillStyle = "rgba(180,210,245,0.55)";
      ctx.fillRect(s.x, s.y, s.size, s.size);
    } else {
      ctx.fillStyle = "rgba(150,180,220,0.30)";
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
  }
  // Subtle ambience over the whole viewport
  vignette(ctx, VIEW.w, VIEW.h, "rgba(40,90,180,0.04)", "rgba(0,0,0,0.55)");
}

function drawPlayerCanvas(ctx) {
  var p = state.player;
  if (!p) return;
  var flicker = p.invuln > 0 && Math.floor(state.time * 18) % 2 === 0;
  if (flicker) return;
  var cx = p.x + p.w / 2;
  // Cyan glow bloom beneath the ship
  glowDot(ctx, cx, p.y + p.h * 0.55, p.w * 0.32, "rgba(74,248,239,0.45)", 22);
  // Ship body: gradient-filled triangle with cyan glow + bright outline
  ctx.save();
  ctx.shadowColor = "rgba(74,248,239,0.7)";
  ctx.shadowBlur = 14;
  var bg = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
  bg.addColorStop(0, "#bffaf6");
  bg.addColorStop(0.5, "#4af8ef");
  bg.addColorStop(1, "#1390a6");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(cx, p.y);
  ctx.lineTo(p.x, p.y + p.h);
  ctx.lineTo(p.x + p.w, p.y + p.h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(225,255,253,0.7)";
  ctx.beginPath();
  ctx.moveTo(cx, p.y);
  ctx.lineTo(p.x, p.y + p.h);
  ctx.lineTo(p.x + p.w, p.y + p.h);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  // Cockpit spark
  glowDot(ctx, cx, p.y + p.h * 0.45, 2.5, "#eafffe", 8);
}

function drawEnemiesCanvas(ctx) {
  for (var i = 0; i < state.enemies.length; i++) {
    var e = state.enemies[i];
    if (!e.alive) continue;
    softShape(ctx, e.x, e.y, e.w, e.h, 7, COLORS.enemyColor, {
      gradTop: "#ff9a5a", gradBottom: "#b32a22", glow: "rgba(232,64,64,0.5)", glowBlur: 12,
      stroke: "rgba(0,0,0,0.35)", lineWidth: 1, shadowBlur: 8, highlight: false
    });
    // menacing eyes
    ctx.fillStyle = "rgba(30,8,8,0.85)";
    ctx.fillRect(e.x + e.w * 0.24 - 2, e.y + e.h * 0.34, 4, 4);
    ctx.fillRect(e.x + e.w * 0.76 - 2, e.y + e.h * 0.34, 4, 4);
    if (e.hp < e.maxHp) {
      gradientBar(ctx, e.x, e.y - 8, e.w, 4, e.hp / e.maxHp, "#ff5d5d", "#ffd23f", "rgba(0,0,0,0.55)");
    }
  }
}

function drawPlayerBulletsCanvas(ctx) {
  if (!_playerBullets) return;
  var bullets = _playerBullets.alive();
  for (var i = 0; i < bullets.length; i++) {
    var b = bullets[i];
    var bx = b.x + b.w / 2;
    var by = b.y + b.h / 2;
    // short vertical streak behind the bolt, aligned to velocity
    var vlen = Math.hypot(b.vx || 0, b.vy || -1) || 1;
    var tx = bx - ((b.vx || 0) / vlen) * 14;
    var ty = by - ((b.vy || -1) / vlen) * 14;
    ctx.save();
    ctx.strokeStyle = "rgba(150,235,255,0.5)";
    ctx.lineWidth = Math.max(2, b.w * 0.7);
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx, by); ctx.stroke();
    ctx.restore();
    glowDot(ctx, bx, by, Math.max(2.5, b.w * 0.6), "#eafdff", 12);
  }
}

function drawEnemyBulletsCanvas(ctx) {
  if (!_enemyBullets) return;
  var bullets = _enemyBullets.alive();
  for (var i = 0; i < bullets.length; i++) {
    var b = bullets[i];
    glowDot(ctx, b.x + b.w / 2, b.y + b.h / 2, Math.max(2.5, b.w * 0.6), "#ff7a3c", 11);
  }
}
