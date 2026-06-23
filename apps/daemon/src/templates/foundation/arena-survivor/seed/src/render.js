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
  if (state.mode === "paused") {
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0,0,VIEW.w,VIEW.h);
    ctx.fillStyle = COLORS.text; ctx.font = "bold 36px monospace"; ctx.textAlign = "center";
    ctx.fillText("PAUSED", VIEW.w/2, VIEW.h/2);
    ctx.textAlign = "left";
  }
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0,0,VIEW.w,VIEW.h);
  ctx.fillStyle = COLORS.text; ctx.font = "24px monospace"; ctx.textAlign = "center";
  ctx.fillText("Loading...", VIEW.w/2, VIEW.h/2); ctx.textAlign = "left";
}

function drawTitle(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0,0,VIEW.w,VIEW.h);
  ctx.fillStyle = COLORS.gold; ctx.font = "bold 56px monospace"; ctx.textAlign = "center";
  ctx.fillText(GAME.title.toUpperCase(), VIEW.w/2, 240);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Survive the endless horde", VIEW.w/2, 295);
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    ctx.fillText("Press Enter to Start", VIEW.w/2, 380);
  ctx.textAlign = "left";
}

function drawGameOver(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0,0,VIEW.w,VIEW.h);
  ctx.fillStyle = COLORS.hp; ctx.font = "bold 52px monospace"; ctx.textAlign = "center";
  ctx.fillText("GAME OVER", VIEW.w/2, 280);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Kills: " + state.killCount + "  Score: " + state.score, VIEW.w/2, 340);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter to Retry", VIEW.w/2, 400);
  ctx.textAlign = "left";
}

function worldToScreen(wx, wy) {
  var sx = wx - state.camera.x + VIEW.w / 2;
  var sy = wy - state.camera.y + VIEW.h / 2;
  var shake = state.camera.shake > 0 ? (Math.random()*2-1)*state.camera.shake : 0;
  return { x: sx + shake, y: sy + shake };
}

function drawArena(ctx) {
  ctx.fillStyle = COLORS.arena; ctx.fillRect(0,0,VIEW.w,VIEW.h);
  // Grid lines for visual reference
  ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 1;
  var gridSize = 64;
  var offX = (-(state.camera.x % gridSize) + VIEW.w/2) % gridSize;
  var offY = (-(state.camera.y % gridSize) + VIEW.h/2) % gridSize;
  for (var gx = offX; gx < VIEW.w; gx += gridSize) { ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,VIEW.h); ctx.stroke(); }
  for (var gy = offY; gy < VIEW.h; gy += gridSize) { ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(VIEW.w,gy); ctx.stroke(); }
}

function drawPlayerOnCanvas(ctx) {
  var p = state.player;
  if (!p) return;
  var s = worldToScreen(p.x, p.y);
  var flicker = p.invuln > 0 && Math.floor(state.time * 18) % 2 === 0;
  if (flicker) return;
  ctx.fillStyle = COLORS.jade;
  ctx.fillRect(s.x - p.w/2, s.y - p.h/2, p.w, p.h);
  // Direction dot
  ctx.fillStyle = "#fff"; ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
}

function drawEnemiesOnCanvas(ctx) {
  if (!enemyPool) return;
  var alive = enemyPool.alive();
  for (var i = 0; i < alive.length; i++) {
    var e = alive[i];
    var s = worldToScreen(e.x, e.y);
    ctx.fillStyle = e.color; ctx.fillRect(s.x - e.w/2, s.y - e.h/2, e.w, e.h);
    // HP bar
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "#400"; ctx.fillRect(s.x - e.w/2, s.y - e.h/2 - 6, e.w, 4);
      ctx.fillStyle = COLORS.hp; ctx.fillRect(s.x - e.w/2, s.y - e.h/2 - 6, e.w * (e.hp/e.maxHp), 4);
    }
  }
}

function drawProjectilesOnCanvas(ctx) {
  if (!projectilePool) return;
  var alive = projectilePool.alive();
  for (var i = 0; i < alive.length; i++) {
    var proj = alive[i];
    var s = worldToScreen(proj.x, proj.y);
    ctx.fillStyle = proj.color; ctx.fillRect(s.x - proj.w/2, s.y - proj.h/2, proj.w, proj.h);
  }
}

function drawXpOrbs(ctx) {
  if (!xpPool) return;
  var alive = xpPool.alive();
  for (var i = 0; i < alive.length; i++) {
    var o = alive[i];
    var s = worldToScreen(o.x, o.y);
    ctx.fillStyle = COLORS.xp;
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI*2); ctx.fill();
  }
}
