function drawHud(ctx) {
  var p = state.player;
  if (!p) return;
  // HP
  ctx.fillStyle = COLORS.hpBack; ctx.fillRect(20, 20, 120, 12);
  ctx.fillStyle = COLORS.hp; ctx.fillRect(20, 20, 120 * Math.max(0, p.hp/p.maxHp), 12);
  ctx.fillStyle = COLORS.text; ctx.font = "13px monospace";
  ctx.fillText("HP " + p.hp + "/" + p.maxHp, 20, 16);
  // Score
  ctx.fillText("Score: " + state.score, VIEW.w - 150, 30);
  // Lives
  ctx.fillText("Lives: " + p.lives, VIEW.w - 150, 50);
  // Side panels
  ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(0, 0, PLAY_X, VIEW.h);
  ctx.fillRect(PLAY_X + PLAY_W, 0, VIEW.w - PLAY_X - PLAY_W, VIEW.h);
}
