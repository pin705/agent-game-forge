function drawHud(ctx) {
  var p = state.player;
  if (!p) return;

  // top-left stat panel: rounded translucent body
  softShape(ctx, 16, 14, 220, 70, 12, "rgba(8,12,22,0.72)", {
    shadowBlur: 14, highlight: false, stroke: "rgba(74,248,239,0.18)", lineWidth: 1
  });
  // HP as a gradient pill bar
  gradientBar(ctx, 28, 28, 184, 14, Math.max(0, p.hp / p.maxHp), "#ff5d5d", "#ff9a3f", "rgba(0,0,0,0.5)");
  crispText(ctx, "HP " + p.hp + "/" + p.maxHp, 32, 39, "bold 11px system-ui, sans-serif", "#fff", "left");
  crispText(ctx, "Lives " + p.lives, 28, 70, "bold 14px system-ui, sans-serif", COLORS.gold, "left");

  // top-right score panel
  var scoreStr = "Score " + state.score;
  softShape(ctx, VIEW.w - 196, 14, 180, 40, 12, "rgba(8,12,22,0.72)", {
    shadowBlur: 14, highlight: false, stroke: "rgba(74,248,239,0.18)", lineWidth: 1
  });
  crispText(ctx, scoreStr, VIEW.w - 106, 40, "bold 20px system-ui, sans-serif", COLORS.text, "center");
}
