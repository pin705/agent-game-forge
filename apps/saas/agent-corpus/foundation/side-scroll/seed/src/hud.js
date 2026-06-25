function drawHud(ctx) {
  if (!state.player) return;
  const hud = cfg("hud");
  const p = state.player;
  ctx.save();
  // stat panel — rounded translucent card with a soft edge
  softShape(ctx, 22, 18, 292, 80, 12, "rgba(18,13,11,0.78)", { shadowBlur: 14, highlight: false, stroke: COLORS.panelEdge, lineWidth: 1 });
  crispText(ctx, t("hudRonin"), 40, 48, "bold 18px system-ui, sans-serif", COLORS.text, "left");
  gradientBar(ctx, 112, 32, hud.hpBarWidth, 16, p.hp / p.maxHp, "#ff5d5d", "#ff9a3f", "rgba(0,0,0,0.5)");
  crispText(ctx, t("hudLives", { n: p.lives }), 40, 84, "15px system-ui, sans-serif", COLORS.gold, "left");
  crispText(ctx, t("hudScore", { n: state.score }), 162, 84, "15px system-ui, sans-serif", COLORS.gold, "left");
  if (state.mode === "paused") drawCenteredPanel(ctx, t("paused"), t("pausedHint"));
  if (state.mode === "gameover") drawCenteredPanel(ctx, t("gameOver"), t("gameOverHint"));
  if (state.mode === "win") drawCenteredPanel(ctx, t("win"), state.endingText || t("winHint"));
  drawMessage(ctx);
  ctx.restore();
}

function drawMessage(ctx) {
  if (!state.message) return;
  softShape(ctx, 180, VIEW.h - 120, VIEW.w - 360, 76, 12, "rgba(18,13,11,0.85)", { shadowBlur: 16, highlight: false, stroke: COLORS.panelEdge, lineWidth: 1 });
  ctx.fillStyle = COLORS.text;
  ctx.font = "20px system-ui, sans-serif";
  wrapText(ctx, state.message.text, 204, VIEW.h - 82, VIEW.w - 408, 26);
}

function drawCenteredPanel(ctx, title, subtitle) {
  ctx.fillStyle = "rgba(7,5,4,0.7)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  vignette(ctx, VIEW.w, VIEW.h, "rgba(229,184,74,0.05)", "rgba(0,0,0,0.5)");
  softShape(ctx, 370, 246, 540, 180, 18, "rgba(18,13,11,0.96)", { shadowBlur: 24, glow: "rgba(229,184,74,0.18)", glowBlur: 26, stroke: COLORS.gold, lineWidth: 2, highlight: false });
  var pulse = 1 + Math.sin(state.time * 3) * 0.03;
  ctx.save();
  ctx.translate(VIEW.w / 2, 318);
  ctx.scale(pulse, pulse);
  crispText(ctx, title, 0, 0, "bold 44px system-ui, sans-serif", COLORS.gold, "center");
  ctx.restore();
  crispText(ctx, subtitle, VIEW.w / 2, 372, "20px system-ui, sans-serif", COLORS.text, "center");
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
}
