function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function drawParticles(ctx) {
  for (var i = 0; i < state.particles.length; i++) {
    var p = state.particles[i];
    var alpha = clamp01(p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function renderFrame() {
  var ctx = dom.ctx;
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  if (state.mode === "loading") { drawLoading(ctx); return; }
  if (state.mode === "title")   { drawTitle(ctx); return; }
  if (state.mode === "gameover") { drawGameOver(ctx); return; }
  if (state.mode === "win")     { drawWin(ctx); return; }
  drawMap(ctx);
  drawTowersOnCanvas(ctx);
  drawProjectilesOnCanvas(ctx);
  drawEnemiesOnCanvas(ctx);
  drawParticles(ctx);
  drawHud(ctx);
  drawBuildCursor(ctx);
  if (state.mode === "paused") {
    ctx.fillStyle = "rgba(7,12,8,0.6)"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    crispText(ctx, t("paused"), VIEW.w / 2, VIEW.h / 2, "bold 40px system-ui, sans-serif", COLORS.text, "center");
  }
}

function verticalBackdrop(ctx, top, bottom) {
  var g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function drawLoading(ctx) {
  verticalBackdrop(ctx, "#1a2616", "#0a0e08");
  crispText(ctx, t("loading"), VIEW.w / 2, VIEW.h / 2, "24px system-ui, sans-serif", COLORS.text, "center");
}

function drawTitle(ctx) {
  verticalBackdrop(ctx, "#2f4524", "#0a0e08");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(229,184,74,0.06)", "rgba(0,0,0,0.62)");
  var pulse = 1 + Math.sin(state.time * 2) * 0.03;
  ctx.save();
  ctx.translate(VIEW.w / 2, 240);
  ctx.scale(pulse, pulse);
  crispText(ctx, t("title"), 0, 0, "bold 64px system-ui, sans-serif", COLORS.gold, "center");
  ctx.restore();
  crispText(ctx, t("tagline"), VIEW.w / 2, 300, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("start"), VIEW.w / 2, 384, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function drawGameOver(ctx) {
  verticalBackdrop(ctx, "#2a0f12", "#080507");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(217,54,43,0.07)", "rgba(0,0,0,0.72)");
  crispText(ctx, t("gameOver"), VIEW.w / 2, 280, "bold 56px system-ui, sans-serif", COLORS.hp, "center");
  crispText(ctx, t("gameOverSub", { n: state.wave }), VIEW.w / 2, 340, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("retry"), VIEW.w / 2, 400, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function drawWin(ctx) {
  verticalBackdrop(ctx, "#11321f", "#06120b");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(58,196,122,0.08)", "rgba(0,0,0,0.7)");
  crispText(ctx, t("win"), VIEW.w / 2, 280, "bold 56px system-ui, sans-serif", "#3ac47a", "center");
  crispText(ctx, t("winSub", { n: (state.level && state.level.waves) ? state.level.waves.length : 0 }), VIEW.w / 2, 340, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("replay"), VIEW.w / 2, 400, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function tracePath(ctx, path) {
  ctx.beginPath();
  ctx.moveTo(path.points[0].x, path.points[0].y);
  for (var i = 1; i < path.points.length; i++) {
    ctx.lineTo(path.points[i].x, path.points[i].y);
  }
}

function drawMap(ctx) {
  // Lush ground: vertical gradient + ambient vignette
  verticalBackdrop(ctx, "#2f4524", "#1a2616");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(120,150,80,0.05)", "rgba(0,0,0,0.5)");

  var path = getMainPath();
  if (path) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Dark soft edge under the road (shadow lip)
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "#3a2c1c";
    ctx.lineWidth = 50;
    tracePath(ctx, path);
    ctx.stroke();
    ctx.restore();
    // Road body
    ctx.strokeStyle = COLORS.path;
    ctx.lineWidth = 42;
    tracePath(ctx, path);
    ctx.stroke();
    // Lighter worn center stripe
    ctx.strokeStyle = COLORS.pathEdge;
    ctx.lineWidth = 16;
    tracePath(ctx, path);
    ctx.stroke();
    // Faint dashed centerline
    ctx.save();
    ctx.strokeStyle = "rgba(40,30,18,0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 14]);
    tracePath(ctx, path);
    ctx.stroke();
    ctx.restore();

    // Waypoint dots
    for (var j = 0; j < path.points.length; j++) {
      glowDot(ctx, path.points[j].x, path.points[j].y, 4, "rgba(124,104,72,0.9)", 6);
    }

    // Entry/exit markers
    glowDot(ctx, path.points[0].x, path.points[0].y, 9, "rgba(58,196,122,0.9)", 14);
    crispText(ctx, t("entry"), path.points[0].x + 14, path.points[0].y - 12, "bold 15px system-ui, sans-serif", "#7fe6a8", "left");
    var last = path.points[path.points.length - 1];
    glowDot(ctx, last.x, last.y, 9, "rgba(217,54,43,0.9)", 14);
    crispText(ctx, t("exit"), last.x - 14, last.y - 12, "bold 15px system-ui, sans-serif", "#ff7a6e", "right");
  }

  // Build spots: soft dashed rounded rects, faint glow when empty
  var spots = (state.level && state.level.buildSpots) || [];
  var spotPulse = 0.5 + Math.sin(state.time * 3) * 0.2;
  for (var si = 0; si < spots.length; si++) {
    var spot = spots[si];
    var occupied = spotOccupied(spot.id);
    ctx.save();
    if (!occupied) {
      ctx.shadowColor = "rgba(229,184,74," + (0.35 * spotPulse).toFixed(3) + ")";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "rgba(229,184,74,0.06)";
      roundRectPath(ctx, spot.x - 24, spot.y - 24, 48, 48, 10);
      ctx.fill();
    }
    ctx.strokeStyle = occupied ? "rgba(110,110,100,0.28)" : "rgba(229,184,74,0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    roundRectPath(ctx, spot.x - 24, spot.y - 24, 48, 48, 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function lightenHex(hex, amt) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  var n = parseInt(m[1], 16);
  var r = Math.min(255, ((n >> 16) & 255) + amt);
  var g = Math.min(255, ((n >> 8) & 255) + amt);
  var b = Math.min(255, (n & 255) + amt);
  return "rgb(" + r + "," + g + "," + b + ")";
}

function drawTowersOnCanvas(ctx) {
  for (var i = 0; i < state.towers.length; i++) {
    var t = state.towers[i];
    var def = TOWER_TYPES[t.type] || {};
    // Range ring (subtle)
    ctx.save();
    ctx.fillStyle = COLORS.towerRange;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,160,200,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Ground shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(t.x, t.y + 16, 18, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Barrel aimed up (behind body so the base overlaps its root)
    ctx.save();
    ctx.fillStyle = "#cfc8b0";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 4;
    fillRoundRect(ctx, t.x - 4, t.y - 26, 8, 18, 3, "#cfc8b0");
    ctx.restore();
    // Tower body
    softShape(ctx, t.x - 16, t.y - 16, 32, 32, 8, t.color, {
      gradTop: lightenHex(t.color, 55), gradBottom: t.color,
      glow: "rgba(120,170,210,0.45)", glowBlur: 12,
      stroke: "rgba(235,245,255,0.4)", lineWidth: 1.5
    });
    // Turret cap
    glowDot(ctx, t.x, t.y - 2, 4, lightenHex(t.color, 80), 6);
  }
}

function drawEnemiesOnCanvas(ctx) {
  for (var i = 0; i < state.enemies.length; i++) {
    var e = state.enemies[i];
    if (!e.alive) continue;
    // Ground shadow (enemy origin is top-left)
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath();
    ctx.ellipse(e.x + e.w / 2, e.y + e.h - 1, e.w * 0.5, e.h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    softShape(ctx, e.x, e.y, e.w, e.h, 6, e.color, {
      gradTop: "#ff7a6e", gradBottom: e.color,
      glow: "rgba(220,70,60,0.5)", glowBlur: 11,
      stroke: "rgba(0,0,0,0.35)", lineWidth: 1, highlight: false
    });
    // Eyes
    ctx.fillStyle = "rgba(20,8,8,0.85)";
    ctx.fillRect(e.x + e.w * 0.28, e.y + e.h * 0.34, 3, 3);
    ctx.fillRect(e.x + e.w * 0.72 - 3, e.y + e.h * 0.34, 3, 3);
    // HP bar
    if (e.hp < e.maxHp) {
      gradientBar(ctx, e.x, e.y - 7, e.w, 4, e.hp / e.maxHp, "#ff5d5d", "#ffd23f", "rgba(0,0,0,0.55)");
    }
  }
}

function drawProjectilesOnCanvas(ctx) {
  for (var i = 0; i < state.projectiles.length; i++) {
    var p = state.projectiles[i];
    if (!p.alive) continue;
    glowDot(ctx, p.x, p.y, 4, COLORS.bullet, 10);
  }
}

function drawBuildCursor(ctx) {
  if (!state.level) return;
  var mx = state.cursor.x, my = state.cursor.y;
  var spot = nearestBuildSpot(mx, my, 60);
  if (!spot) return;
  var occupied = spotOccupied(spot.id);
  var def = TOWER_TYPES[state.selectedTowerType] || {};
  var canAfford = state.gold >= (def.cost || 999);
  var ok = !occupied && canAfford;
  // Soft rounded glow highlight
  ctx.save();
  ctx.shadowColor = ok ? "rgba(100,220,120,0.7)" : "rgba(220,70,60,0.7)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = ok ? COLORS.buildHighlight : COLORS.buildInvalid;
  roundRectPath(ctx, spot.x - 24, spot.y - 24, 48, 48, 10);
  ctx.fill();
  ctx.strokeStyle = ok ? "rgba(150,255,170,0.8)" : "rgba(255,120,110,0.8)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, spot.x - 24, spot.y - 24, 48, 48, 10);
  ctx.stroke();
  ctx.restore();
  // Preview range ring
  if (ok) {
    ctx.strokeStyle = "rgba(200,220,100,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, def.range || 160, 0, Math.PI * 2);
    ctx.stroke();
  }
}
