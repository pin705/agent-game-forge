function drawHud(ctx) {
  var p = state.player;
  // HP dots
  ctx.font = "14px monospace";
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("HP:", 12, 26);
  for (var i = 0; i < (p ? p.maxHp : 5); i++) {
    ctx.fillStyle = (p && i < p.hp) ? COLORS.hp : COLORS.hpBack;
    ctx.fillRect(44 + i * 16, 14, 12, 12);
  }
  ctx.fillStyle = COLORS.text;
  ctx.fillText("Move: " + state.moves + "  Turn: " + state.turn + "  Score: " + state.score, 12, 50);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("Arrows: move   Z: undo", 12, 68);
  // Level name
  if (state.level) {
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.fillText(state.level.name || state.sceneId, VIEW.w - 12, 26);
    ctx.textAlign = "left";
  }
}
