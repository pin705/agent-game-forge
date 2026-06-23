function drawHud(ctx) {
  var p = state.player;
  if (!p) return;
  // HP bar
  ctx.fillStyle = COLORS.hpBack; ctx.fillRect(20, 20, 200, 14);
  ctx.fillStyle = COLORS.hp; ctx.fillRect(20, 20, 200 * Math.max(0, p.hp / p.maxHp), 14);
  ctx.fillStyle = COLORS.text; ctx.font = "13px monospace";
  ctx.fillText("HP " + p.hp + "/" + p.maxHp, 20, 16);
  // XP bar
  var xpPct = Math.min(1, (p.xp || 0) / xpForNextLevel());
  ctx.fillStyle = COLORS.xpBack; ctx.fillRect(20, 38, 200, 8);
  ctx.fillStyle = COLORS.xp; ctx.fillRect(20, 38, 200 * xpPct, 8);
  ctx.fillStyle = COLORS.text;
  ctx.fillText("Lv " + (p.level || 1) + "  Kills: " + state.killCount, 20, 64);
  // Timer (top right)
  var mins = Math.floor(state.runTime / 60), secs = Math.floor(state.runTime % 60);
  ctx.fillText((mins < 10 ? "0" : "") + mins + ":" + (secs < 10 ? "0" : "") + secs, VIEW.w - 80, 30);
}

function drawLevelUpOverlay(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.gold; ctx.font = "bold 32px monospace"; ctx.textAlign = "center";
  ctx.fillText("LEVEL UP!", VIEW.w / 2, 200);
  ctx.textAlign = "left";
  var cards = state.upgradeCards;
  for (var i = 0; i < cards.length; i++) {
    var cx = VIEW.w / 2 - 220 + i * 170, cy = 260;
    ctx.fillStyle = COLORS.panel; ctx.fillRect(cx, cy, 150, 100);
    ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 2; ctx.strokeRect(cx, cy, 150, 100);
    ctx.fillStyle = COLORS.text; ctx.font = "bold 15px monospace"; ctx.textAlign = "center";
    ctx.fillText(cards[i].name, cx + 75, cy + 30);
    ctx.fillStyle = COLORS.muted; ctx.font = "13px monospace";
    ctx.fillText(cards[i].desc, cx + 75, cy + 55);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = COLORS.muted; ctx.font = "14px monospace"; ctx.textAlign = "center";
  ctx.fillText("Click a card or press 1/2/3", VIEW.w / 2, 400);
  ctx.textAlign = "left";
}
