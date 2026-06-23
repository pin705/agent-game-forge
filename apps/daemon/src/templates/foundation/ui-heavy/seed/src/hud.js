function drawHud(ctx) {
  if (state.screen !== "battle") return;
  // Player HP bar (left side)
  const p = state.player;
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(20, VIEW.h - CARD_H - 110, 240, 80);
  ctx.fillStyle = COLORS.hpBack;
  ctx.fillRect(30, VIEW.h - CARD_H - 90, 220, 16);
  ctx.fillStyle = COLORS.hp;
  ctx.fillRect(30, VIEW.h - CARD_H - 90, 220 * (p.hp / p.maxHp), 16);
  ctx.fillStyle = COLORS.text;
  ctx.font = "14px monospace";
  ctx.fillText("HP: " + p.hp + " / " + p.maxHp, 30, VIEW.h - CARD_H - 100);
  if (p.block > 0) {
    ctx.fillStyle = COLORS.block;
    ctx.fillText("Shield: " + p.block, 160, VIEW.h - CARD_H - 100);
  }
  // Energy
  ctx.fillStyle = COLORS.energyColor;
  ctx.font = "bold 20px monospace";
  ctx.fillText("E: " + state.energy + "/" + state.maxEnergy, 30, VIEW.h - CARD_H - 60);
  // Deck/discard counts
  ctx.fillStyle = COLORS.muted;
  ctx.font = "13px monospace";
  ctx.fillText("Deck: " + state.deck.length + "  Discard: " + state.discard.length, 30, VIEW.h - CARD_H - 40);
}
