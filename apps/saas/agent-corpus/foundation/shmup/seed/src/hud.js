// Drawn HUD — score, lives (as ship pips), wave, combo. No DOM, all Canvas2D.
function drawHud(ctx) {
  ctx.save();
  ctx.textBaseline = "top";

  // score
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 26px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("SCORE " + String(state.score).padStart(6, "0"), 24, 20);

  // wave (center-top)
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.muted;
  ctx.font = "20px system-ui, sans-serif";
  ctx.fillText("WAVE " + state.wave, VIEW.w / 2, 24);

  // lives as little ship pips (top-right)
  ctx.textAlign = "right";
  ctx.fillText("LIVES", VIEW.w - 24, 24);
  for (let i = 0; i < state.lives; i += 1) {
    drawPip(ctx, VIEW.w - 110 - i * 30, 30);
  }

  // combo (under score) when chaining
  if ((state.combo || 0) >= 2) {
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.gold;
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText(state.combo + "x COMBO", 24, 54);
  }
  ctx.restore();
}

function drawPip(ctx, x, y) {
  ctx.fillStyle = COLORS.ship;
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 8, y + 7);
  ctx.lineTo(x - 8, y + 7);
  ctx.closePath();
  ctx.fill();
}
