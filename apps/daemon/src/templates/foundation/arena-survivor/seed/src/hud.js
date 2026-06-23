function drawHud(ctx) {
  var p = state.player;
  if (!p) return;

  // top-left stat panel
  softShape(ctx, 16, 14, 244, 74, 12, "rgba(10,14,24,0.72)", { shadowBlur: 14, highlight: false, stroke: "rgba(120,160,220,0.18)", lineWidth: 1 });
  gradientBar(ctx, 28, 26, 200, 14, Math.max(0, p.hp / p.maxHp), "#ff5d5d", "#ff9a3f", "rgba(0,0,0,0.5)");
  crispText(ctx, "HP " + p.hp + "/" + p.maxHp, 32, 37, "bold 11px system-ui, sans-serif", "#fff", "left");
  var xpPct = Math.min(1, (p.xp || 0) / xpForNextLevel());
  gradientBar(ctx, 28, 46, 200, 9, xpPct, "#3ac47a", "#a8ff6a", "rgba(0,0,0,0.5)");
  crispText(ctx, "Lv " + (p.level || 1), 28, 80, "bold 14px system-ui, sans-serif", COLORS.gold, "left");
  crispText(ctx, "Kills " + state.killCount, 120, 80, "13px system-ui, sans-serif", COLORS.text, "left");

  // top-right timer
  var mins = Math.floor(state.runTime / 60), secs = Math.floor(state.runTime % 60);
  var tstr = (mins < 10 ? "0" : "") + mins + ":" + (secs < 10 ? "0" : "") + secs;
  softShape(ctx, VIEW.w - 116, 14, 100, 40, 12, "rgba(10,14,24,0.72)", { shadowBlur: 14, highlight: false, stroke: "rgba(120,160,220,0.18)", lineWidth: 1 });
  crispText(ctx, tstr, VIEW.w - 66, 40, "bold 20px system-ui, sans-serif", COLORS.text, "center");
}

function drawLevelUpOverlay(ctx) {
  ctx.fillStyle = "rgba(7,10,18,0.74)"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  var pop = 1 + Math.sin(state.time * 4) * 0.04;
  ctx.save();
  ctx.translate(VIEW.w / 2, 188); ctx.scale(pop, pop);
  crispText(ctx, "LEVEL UP!", 0, 0, "bold 34px system-ui, sans-serif", COLORS.gold, "center");
  ctx.restore();
  var cards = state.upgradeCards;
  for (var i = 0; i < cards.length; i++) {
    var cx = VIEW.w / 2 - 235 + i * 165, cy = 250;
    softShape(ctx, cx, cy, 150, 110, 14, "rgba(18,26,40,0.96)", {
      shadowBlur: 18, glow: "rgba(229,184,74,0.25)", glowBlur: 22, stroke: COLORS.gold, lineWidth: 2, highlight: false
    });
    crispText(ctx, cards[i].name, cx + 75, cy + 40, "bold 16px system-ui, sans-serif", COLORS.text, "center");
    crispText(ctx, cards[i].desc, cx + 75, cy + 70, "13px system-ui, sans-serif", COLORS.muted, "center");
    crispText(ctx, String(i + 1), cx + 75, cy + 98, "bold 13px system-ui, sans-serif", COLORS.gold, "center");
  }
  crispText(ctx, "Click a card or press 1 / 2 / 3", VIEW.w / 2, 404, "14px system-ui, sans-serif", COLORS.muted, "center");
}
