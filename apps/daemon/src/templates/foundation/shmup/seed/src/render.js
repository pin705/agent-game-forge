var _stars = [];
function initStars() {
  _stars = [];
  for (var i = 0; i < 120; i++) {
    _stars.push({
      x: PLAY_X + Math.random() * PLAY_W,
      y: Math.random() * VIEW.h,
      size: Math.random() * 2 + 0.5,
      speed: 40 + Math.random() * 120
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
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0,0,VIEW.w,VIEW.h);
    ctx.fillStyle = COLORS.text; ctx.font = "bold 36px monospace"; ctx.textAlign = "center";
    ctx.fillText("PAUSED", VIEW.w/2, VIEW.h/2); ctx.textAlign = "left";
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
  ctx.fillText("Shoot everything, survive the waves", VIEW.w/2, 295);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter to Start", VIEW.w/2, 380);
  ctx.textAlign = "left";
}

function drawGameOver(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0,0,VIEW.w,VIEW.h);
  ctx.fillStyle = COLORS.hp; ctx.font = "bold 52px monospace"; ctx.textAlign = "center";
  ctx.fillText("GAME OVER", VIEW.w/2, 280);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Score: " + state.score, VIEW.w/2, 340);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter to Retry", VIEW.w/2, 400);
  ctx.textAlign = "left";
}

function drawBackground(ctx) {
  ctx.fillStyle = COLORS.bgColor; ctx.fillRect(PLAY_X, 0, PLAY_W, VIEW.h);
  ctx.fillStyle = COLORS.bgSide;
  ctx.fillRect(0, 0, PLAY_X, VIEW.h);
  ctx.fillRect(PLAY_X + PLAY_W, 0, VIEW.w - PLAY_X - PLAY_W, VIEW.h);
  // Scroll stars
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  for (var i = 0; i < _stars.length; i++) {
    var s = _stars[i];
    s.y += s.speed * 0.016;
    if (s.y > VIEW.h + 4) { s.y = -4; s.x = PLAY_X + Math.random() * PLAY_W; }
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }
}

function drawPlayerCanvas(ctx) {
  var p = state.player;
  if (!p) return;
  var flicker = p.invuln > 0 && Math.floor(state.time * 18) % 2 === 0;
  if (flicker) return;
  // Draw ship as triangle
  ctx.fillStyle = COLORS.playerColor;
  ctx.beginPath();
  ctx.moveTo(p.x + p.w/2, p.y);
  ctx.lineTo(p.x, p.y + p.h);
  ctx.lineTo(p.x + p.w, p.y + p.h);
  ctx.closePath(); ctx.fill();
}

function drawEnemiesCanvas(ctx) {
  for (var i = 0; i < state.enemies.length; i++) {
    var e = state.enemies[i];
    if (!e.alive) continue;
    ctx.fillStyle = COLORS.enemyColor;
    ctx.fillRect(e.x, e.y, e.w, e.h);
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "#400"; ctx.fillRect(e.x, e.y - 6, e.w, 4);
      ctx.fillStyle = COLORS.hp; ctx.fillRect(e.x, e.y - 6, e.w * (e.hp/e.maxHp), 4);
    }
  }
}

function drawPlayerBulletsCanvas(ctx) {
  if (!_playerBullets) return;
  ctx.fillStyle = COLORS.bulletPlayer;
  var bullets = _playerBullets.alive();
  for (var i = 0; i < bullets.length; i++) {
    ctx.fillRect(bullets[i].x, bullets[i].y, bullets[i].w, bullets[i].h);
  }
}

function drawEnemyBulletsCanvas(ctx) {
  if (!_enemyBullets) return;
  ctx.fillStyle = COLORS.bulletEnemy;
  var bullets = _enemyBullets.alive();
  for (var i = 0; i < bullets.length; i++) {
    ctx.fillRect(bullets[i].x, bullets[i].y, bullets[i].w, bullets[i].h);
  }
}
