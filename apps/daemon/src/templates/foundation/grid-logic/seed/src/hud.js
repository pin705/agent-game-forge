function drawHud(ctx) {
  var p = state.player;

  // Top-left translucent stat panel.
  softShape(ctx, 16, 14, 244, 84, 12, "rgba(11,11,22,0.72)", {
    shadowBlur: 14, highlight: false, stroke: "rgba(120,140,210,0.18)", lineWidth: 1
  });
  // HP pips: small rounded glowing capsules.
  crispText(ctx, "HP", 30, 38, "bold 12px system-ui, sans-serif", COLORS.muted, "left");
  var maxHp = p ? p.maxHp : 5;
  for (var i = 0; i < maxHp; i++) {
    var px = 56 + i * 16, py = 27;
    if (p && i < p.hp) {
      glowDot(ctx, px + 5, py + 5, 4, COLORS.hp, 8);
      fillRoundRect(ctx, px, py, 11, 11, 4, "#ff5d5d");
    } else {
      fillRoundRect(ctx, px, py, 11, 11, 4, COLORS.hpBack);
    }
  }
  crispText(ctx, "Move " + state.moves + "   Turn " + state.turn + "   Score " + state.score, 30, 64, "bold 14px system-ui, sans-serif", COLORS.text, "left");
  crispText(ctx, "Arrows: move    Z: undo", 30, 86, "12px system-ui, sans-serif", COLORS.muted, "left");

  // Top-right level-name chip.
  if (state.level) {
    var label = state.level.name || state.sceneId;
    var cw = Math.max(96, label.length * 9 + 28);
    softShape(ctx, VIEW.w - 16 - cw, 14, cw, 34, 12, "rgba(11,11,22,0.72)", {
      shadowBlur: 14, highlight: false, stroke: "rgba(120,140,210,0.18)", lineWidth: 1
    });
    crispText(ctx, label, VIEW.w - 16 - cw / 2, 36, "bold 14px system-ui, sans-serif", COLORS.gold, "center");
  }
}
