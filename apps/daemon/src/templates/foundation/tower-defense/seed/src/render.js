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
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.fillStyle = COLORS.text; ctx.font = "bold 38px monospace"; ctx.textAlign = "center";
    ctx.fillText("PAUSED", VIEW.w / 2, VIEW.h / 2);
    ctx.textAlign = "left";
  }
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.text; ctx.font = "24px monospace"; ctx.textAlign = "center";
  ctx.fillText("Loading...", VIEW.w / 2, VIEW.h / 2); ctx.textAlign = "left";
}

function drawTitle(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.gold; ctx.font = "bold 56px monospace"; ctx.textAlign = "center";
  ctx.fillText(GAME.title.toUpperCase(), VIEW.w / 2, 240);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Place towers. Defend the pass.", VIEW.w / 2, 296);
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    ctx.fillText("Press Enter to Start", VIEW.w / 2, 380);
  ctx.textAlign = "left";
}

function drawGameOver(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.hp; ctx.font = "bold 52px monospace"; ctx.textAlign = "center";
  ctx.fillText("FORTRESS FALLEN", VIEW.w / 2, 280);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Wave " + state.wave + " cleared", VIEW.w / 2, 340);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter to Retry", VIEW.w / 2, 400);
  ctx.textAlign = "left";
}

function drawWin(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = "#3ac47a"; ctx.font = "bold 52px monospace"; ctx.textAlign = "center";
  ctx.fillText("PASS HELD!", VIEW.w / 2, 280);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("All " + ((state.level && state.level.waves) ? state.level.waves.length : 0) + " waves defeated!", VIEW.w / 2, 340);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter to Replay", VIEW.w / 2, 400);
  ctx.textAlign = "left";
}

function drawMap(ctx) {
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  var path = getMainPath();
  if (path) {
    ctx.strokeStyle = COLORS.path;
    ctx.lineWidth = 44;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (var i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.stroke();
    // Edge highlight
    ctx.strokeStyle = COLORS.pathEdge;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Waypoint dots
    ctx.fillStyle = COLORS.pathEdge;
    for (var j = 0; j < path.points.length; j++) {
      ctx.beginPath();
      ctx.arc(path.points[j].x, path.points[j].y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Entry/exit arrows
    ctx.fillStyle = COLORS.gold;
    ctx.font = "bold 18px monospace";
    ctx.fillText("▶ ENTRY", path.points[0].x + 8, path.points[0].y - 14);
    var last = path.points[path.points.length - 1];
    ctx.fillText("EXIT ▶", last.x - 70, last.y - 14);
  }

  // Build spots
  var spots = (state.level && state.level.buildSpots) || [];
  for (var si = 0; si < spots.length; si++) {
    var spot = spots[si];
    var occupied = spotOccupied(spot.id);
    ctx.strokeStyle = occupied ? "rgba(100,100,100,0.3)" : "rgba(200,200,100,0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(spot.x - 24, spot.y - 24, 48, 48);
    ctx.setLineDash([]);
  }
}

function drawTowersOnCanvas(ctx) {
  for (var i = 0; i < state.towers.length; i++) {
    var t = state.towers[i];
    var def = TOWER_TYPES[t.type] || {};
    // Range ring (subtle)
    ctx.fillStyle = COLORS.towerRange;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.fill();
    // Tower body
    ctx.fillStyle = t.color;
    ctx.fillRect(t.x - 16, t.y - 16, 32, 32);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(t.x - 16, t.y - 16, 32, 32);
    // Barrel
    ctx.fillStyle = "#c8c0a8";
    ctx.fillRect(t.x - 4, t.y - 22, 8, 12);
  }
}

function drawEnemiesOnCanvas(ctx) {
  for (var i = 0; i < state.enemies.length; i++) {
    var e = state.enemies[i];
    if (!e.alive) continue;
    ctx.fillStyle = e.color;
    ctx.fillRect(e.x, e.y, e.w, e.h);
    // HP bar
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "#400";
      ctx.fillRect(e.x, e.y - 6, e.w, 4);
      ctx.fillStyle = COLORS.hp;
      ctx.fillRect(e.x, e.y - 6, e.w * (e.hp / e.maxHp), 4);
    }
  }
}

function drawProjectilesOnCanvas(ctx) {
  ctx.fillStyle = COLORS.bullet;
  for (var i = 0; i < state.projectiles.length; i++) {
    var p = state.projectiles[i];
    if (!p.alive) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
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
  ctx.fillStyle = (occupied || !canAfford) ? COLORS.buildInvalid : COLORS.buildHighlight;
  ctx.fillRect(spot.x - 24, spot.y - 24, 48, 48);
  // Preview range ring
  if (!occupied && canAfford) {
    ctx.strokeStyle = "rgba(200,220,100,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, def.range || 160, 0, Math.PI * 2);
    ctx.stroke();
  }
}
