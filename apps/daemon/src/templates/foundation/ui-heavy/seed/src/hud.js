function drawHud(ctx) {
  if (state.screen !== "battle") return;
  const p = state.player;
  // Player stat panel (left side) — same footprint: 20, VIEW.h-CARD_H-110, 240x80
  const panelY = VIEW.h - CARD_H - 110;
  softShape(ctx, 20, panelY, 240, 80, 12, COLORS.panel, {
    shadowBlur: 14, highlight: false, stroke: "rgba(120,160,220,0.18)", lineWidth: 1
  });
  // HP label + bar (bar at 30, VIEW.h-CARD_H-90, 220x16)
  crispText(ctx, t("hp", { hp: p.hp, max: p.maxHp }), 30, VIEW.h - CARD_H - 100, "bold 14px system-ui, sans-serif", COLORS.text, "left");
  if (p.block > 0) {
    crispText(ctx, t("shield", { block: p.block }), 160, VIEW.h - CARD_H - 100, "bold 14px system-ui, sans-serif", COLORS.block, "left");
  }
  gradientBar(ctx, 30, VIEW.h - CARD_H - 90, 220, 16, Math.max(0, p.hp / p.maxHp), "#ff5d5d", "#ff9a3f", COLORS.hpBack);
  // Energy
  crispText(ctx, t("energy", { energy: state.energy, max: state.maxEnergy }), 30, VIEW.h - CARD_H - 60, "bold 20px system-ui, sans-serif", COLORS.energyColor, "left");
  // Deck/discard counts
  crispText(ctx, t("deck", { deck: state.deck.length, discard: state.discard.length }), 30, VIEW.h - CARD_H - 40, "13px system-ui, sans-serif", COLORS.muted, "left");
}
