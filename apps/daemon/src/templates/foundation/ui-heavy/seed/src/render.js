function renderFrame() {
  const ctx = dom.ctx;
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  if (state.mode === "loading") { drawLoading(ctx); return; }
  if (state.mode === "title" || state.screen === "title") { drawTitle(ctx); return; }
  if (state.mode === "gameover" || state.screen === "gameover") { drawGameOver(ctx); return; }
  if (state.mode === "result") { drawResult(ctx); return; }
  drawBattleScreen(ctx);
  drawParticles(ctx);
  drawHud(ctx);
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.text; ctx.font = "24px monospace"; ctx.textAlign = "center";
  ctx.fillText("Loading...", VIEW.w / 2, VIEW.h / 2);
  ctx.textAlign = "left";
}

function drawTitle(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.gold; ctx.font = "bold 56px monospace"; ctx.textAlign = "center";
  ctx.fillText(GAME.title.toUpperCase(), VIEW.w / 2, 240);
  ctx.fillStyle = COLORS.text; ctx.font = "20px monospace";
  ctx.fillText("A card-battler dungeon", VIEW.w / 2, 290);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) {
    ctx.fillText("Press Enter / Click to Start", VIEW.w / 2, 380);
  }
  ctx.fillStyle = COLORS.muted; ctx.font = "14px monospace";
  ctx.fillText("Floor " + state.floor + "   Score " + state.runScore, VIEW.w / 2, 460);
  ctx.textAlign = "left";
  // Register start region
  clearClickRegions();
  registerClickRegion("start", 0, 0, VIEW.w, VIEW.h, startGame);
}

function drawBattleScreen(ctx) {
  // Background
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  // Floor indicator
  ctx.fillStyle = COLORS.muted; ctx.font = "14px monospace"; ctx.textAlign = "center";
  ctx.fillText("Floor " + state.floor, VIEW.w / 2, 30);
  ctx.textAlign = "left";

  // Enemy (right side)
  const e = state.enemy;
  if (e) {
    ctx.fillStyle = e.color || COLORS.enemyColor;
    ctx.fillRect(760, 160, 180, 220);
    // HP bar
    ctx.fillStyle = COLORS.hpBack; ctx.fillRect(760, 155, 180, 10);
    ctx.fillStyle = COLORS.hp;
    const enemyHpFrac = Math.max(0, e.hp / e.maxHp);
    ctx.fillRect(760, 155, 180 * enemyHpFrac, 10);
    ctx.fillStyle = COLORS.text; ctx.font = "14px monospace";
    ctx.fillText((e.name || "Enemy") + " " + e.hp + "/" + e.maxHp, 760, 150);
    if (e.block > 0) { ctx.fillStyle = COLORS.block; ctx.fillText("Blk:" + e.block, 920, 150); }
    // Intent label
    ctx.fillStyle = COLORS.muted; ctx.font = "12px monospace";
    ctx.fillText("Intent: atk " + (e.intent ? e.intent.value : "?"), 760, 400);
  }

  // Player (left side)
  const p = state.player;
  if (p) {
    ctx.fillStyle = p.color || COLORS.playerColor;
    ctx.fillRect(340, 160, 120, 160);
    if (p.block > 0) {
      ctx.fillStyle = COLORS.block + "88";
      ctx.fillRect(330, 150, 140, 180);
    }
  }

  // Hand of cards
  clearClickRegions();
  for (let i = 0; i < state.hand.length; i++) {
    drawCard(ctx, state.hand[i], i, state.hand.length, i === state.hoveredCard);
  }

  // End Turn button
  const etX = VIEW.w - 180, etY = VIEW.h - CARD_H - 110;
  ctx.fillStyle = state.turn === "player" ? COLORS.gold : COLORS.muted;
  ctx.fillRect(etX, etY, 160, 50);
  ctx.fillStyle = COLORS.ink; ctx.font = "bold 16px monospace"; ctx.textAlign = "center";
  ctx.fillText("End Turn", etX + 80, etY + 30);
  ctx.textAlign = "left";
  registerClickRegion("endTurn", etX, etY, 160, 50, function() { if (state.turn === "player") endPlayerTurn(); });
}

function drawCard(ctx, card, index, total, hovered) {
  const r = cardRect(index, total);
  const y = hovered ? r.y - 20 : r.y;
  ctx.fillStyle = COLORS.cardBg;
  ctx.fillRect(r.x, y, r.w, r.h);
  ctx.strokeStyle = hovered ? COLORS.cardHighlight : cardColor(card.type);
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x, y, r.w, r.h);
  // Card name
  ctx.fillStyle = COLORS.text; ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
  ctx.fillText(card.name, r.x + r.w / 2, y + 24);
  // Cost gem
  ctx.fillStyle = COLORS.energyColor;
  ctx.beginPath(); ctx.arc(r.x + 18, y + 18, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COLORS.ink; ctx.font = "bold 14px monospace";
  ctx.fillText(String(card.cost), r.x + 18, y + 23);
  // Type color band
  ctx.fillStyle = cardColor(card.type);
  ctx.fillRect(r.x + 8, y + 36, r.w - 16, 4);
  // Art area placeholder
  ctx.fillStyle = cardColor(card.type) + "33";
  ctx.fillRect(r.x + 8, y + 48, r.w - 16, 80);
  // Type icon (text-only, no emoji to avoid font issues)
  ctx.fillStyle = cardColor(card.type); ctx.font = "bold 14px monospace";
  const typeLabel = card.type === "attack" ? "ATK" : card.type === "block" ? "DEF" : "HEL";
  ctx.fillText(typeLabel, r.x + r.w / 2, y + 94);
  // Value
  ctx.fillStyle = COLORS.text; ctx.font = "bold 18px monospace";
  ctx.fillText(String(card.value), r.x + r.w / 2, y + 148);
  // Text
  ctx.fillStyle = COLORS.muted; ctx.font = "11px monospace";
  const words = card.text.split(' ');
  let line = '', ly = y + 168;
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    const test = line + w + ' ';
    if (test.length > 16 && line) { ctx.fillText(line, r.x + r.w / 2, ly); line = w + ' '; ly += 14; }
    else { line = test; }
  }
  if (line) ctx.fillText(line, r.x + r.w / 2, ly);
  ctx.textAlign = "left";
}

function drawGameOver(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.hp; ctx.font = "bold 52px monospace"; ctx.textAlign = "center";
  ctx.fillText("DEFEAT", VIEW.w / 2, 280);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Score: " + state.runScore, VIEW.w / 2, 340);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter to Retry", VIEW.w / 2, 420);
  ctx.textAlign = "left";
  clearClickRegions();
  registerClickRegion("retry", 0, 0, VIEW.w, VIEW.h, startGame);
}

function drawResult(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.gold; ctx.font = "bold 48px monospace"; ctx.textAlign = "center";
  ctx.fillText("VICTORY!", VIEW.w / 2, 260);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Score: " + Math.round(state.runScore), VIEW.w / 2, 330);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter for Next Battle", VIEW.w / 2, 410);
  ctx.textAlign = "left";
  clearClickRegions();
  registerClickRegion("next", 0, 0, VIEW.w, VIEW.h, startNextBattle);
}
