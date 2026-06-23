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

function verticalBackdrop(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function drawLoading(ctx) {
  verticalBackdrop(ctx, "#141d30", "#070a12");
  crispText(ctx, t("loading"), VIEW.w / 2, VIEW.h / 2, "24px system-ui, sans-serif", COLORS.text, "center");
}

function drawTitle(ctx) {
  verticalBackdrop(ctx, "#1a1320", "#08060c");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(229,200,74,0.06)", "rgba(0,0,0,0.65)");
  const pulse = 1 + Math.sin(state.time * 2) * 0.03;
  ctx.save();
  ctx.translate(VIEW.w / 2, 240);
  ctx.scale(pulse, pulse);
  crispText(ctx, t("title"), 0, 0, "bold 58px system-ui, sans-serif", COLORS.gold, "center");
  ctx.restore();
  crispText(ctx, t("tagline"), VIEW.w / 2, 296, "20px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0) {
    crispText(ctx, t("start"), VIEW.w / 2, 384, "18px system-ui, sans-serif", COLORS.text, "center");
  }
  crispText(ctx, t("titleStats", { floor: state.floor, score: state.runScore }), VIEW.w / 2, 460, "14px system-ui, sans-serif", COLORS.muted, "center");
  // Register start region
  clearClickRegions();
  registerClickRegion("start", 0, 0, VIEW.w, VIEW.h, startGame);
}

function drawBattleScreen(ctx) {
  // Lit-stage backdrop
  verticalBackdrop(ctx, "#1d2436", "#0a0d16");
  // faint floor line under the combatants
  ctx.save();
  ctx.strokeStyle = "rgba(120,150,200,0.10)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 392); ctx.lineTo(VIEW.w, 392); ctx.stroke();
  ctx.restore();
  vignette(ctx, VIEW.w, VIEW.h, "rgba(90,120,200,0.05)", "rgba(0,0,0,0.6)");

  // Floor indicator
  crispText(ctx, t("floor", { floor: state.floor }), VIEW.w / 2, 30, "14px system-ui, sans-serif", COLORS.muted, "center");

  // Enemy (right side) — rect 760,160,180x220 unchanged
  const e = state.enemy;
  if (e) {
    const ec = e.color || COLORS.enemyColor;
    softShape(ctx, 760, 160, 180, 220, 16, ec, {
      gradTop: "#ff8a7a", gradBottom: ec, glow: "rgba(232,64,96,0.5)", glowBlur: 22,
      stroke: "rgba(20,8,12,0.5)", lineWidth: 2, highlight: false
    });
    // simple eyes for character
    ctx.fillStyle = "rgba(20,8,12,0.85)";
    ctx.fillRect(810, 232, 12, 12);
    ctx.fillRect(878, 232, 12, 12);
    // HP bar (same footprint: 760,155,180x10)
    gradientBar(ctx, 760, 155, 180, 10, Math.max(0, e.hp / e.maxHp), "#ff5d5d", "#ffd23f", COLORS.hpBack);
    crispText(ctx, t("enemyName", { name: (e.name || "Enemy"), hp: e.hp, max: e.maxHp }), 760, 150, "bold 14px system-ui, sans-serif", COLORS.text, "left");
    if (e.block > 0) crispText(ctx, t("enemyBlock", { block: e.block }), 920, 150, "bold 14px system-ui, sans-serif", COLORS.block, "left");
    // Intent label
    crispText(ctx, t("intent", { value: (e.intent ? e.intent.value : t("intentUnknown")) }), 760, 400, "12px system-ui, sans-serif", COLORS.muted, "left");
  }

  // Player (left side) — rect 340,160,120x160 unchanged
  const p = state.player;
  if (p) {
    const pc = p.color || COLORS.playerColor;
    softShape(ctx, 340, 160, 120, 160, 14, pc, {
      gradTop: "#9bfde0", gradBottom: "#1f9c84", glow: "rgba(74,248,192,0.55)", glowBlur: 20,
      stroke: "rgba(220,255,245,0.45)", lineWidth: 2
    });
    if (p.block > 0) {
      // translucent blue rounded shield overlay (330,150,140x180) with a glow
      softShape(ctx, 330, 150, 140, 180, 16, "rgba(72,136,200,0.28)", {
        shadow: false, glow: "rgba(72,136,200,0.55)", glowBlur: 16,
        stroke: "rgba(140,190,240,0.7)", lineWidth: 2, highlight: false
      });
    }
  }

  // Hand of cards
  clearClickRegions();
  for (let i = 0; i < state.hand.length; i++) {
    drawCard(ctx, state.hand[i], i, state.hand.length, i === state.hoveredCard);
  }

  // End Turn button — rect etX,etY,160x50 unchanged
  const etX = VIEW.w - 180, etY = VIEW.h - CARD_H - 110;
  const active = state.turn === "player";
  softShape(ctx, etX, etY, 160, 50, 12, active ? COLORS.gold : COLORS.muted, {
    gradTop: active ? "#ffe27a" : "#8a93a6", gradBottom: active ? "#c79a1f" : "#5a6172",
    glow: active ? "rgba(229,200,74,0.45)" : null, glowBlur: 16,
    stroke: "rgba(0,0,0,0.35)", lineWidth: 1, highlight: false
  });
  crispText(ctx, t("endTurn"), etX + 80, etY + 32, "bold 16px system-ui, sans-serif", COLORS.ink, "center");
  registerClickRegion("endTurn", etX, etY, 160, 50, function() { if (state.turn === "player") endPlayerTurn(); });
}

function cardBandColors(type) {
  if (type === "attack") return { c0: "#e86a5c", c1: COLORS.cardAttack };
  if (type === "block") return { c0: "#62a4e0", c1: COLORS.cardBlock };
  if (type === "heal") return { c0: "#68d88c", c1: COLORS.cardHeal };
  return { c0: COLORS.cardEdge, c1: COLORS.cardEdge };
}

function drawCard(ctx, card, index, total, hovered) {
  const r = cardRect(index, total);
  const y = hovered ? r.y - 20 : r.y;
  const accent = cardColor(card.type);
  // Polished card body: vertical dark-slate gradient + drop shadow (deeper when raised),
  // glowing stroke when hovered. Footprint stays r.x/r.w and CARD_H — hit-test intact.
  softShape(ctx, r.x, y, r.w, r.h, 12, COLORS.cardBg, {
    gradTop: "#222c40", gradBottom: "#121826",
    shadowBlur: hovered ? 24 : 12, shadowOffsetY: hovered ? 10 : 5,
    glow: hovered ? (accent + "cc") : null, glowBlur: 22,
    stroke: hovered ? COLORS.cardHighlight : accent, lineWidth: hovered ? 3 : 2,
    highlight: false
  });
  // Colored top band by type
  const band = cardBandColors(card.type);
  const bandG = ctx.createLinearGradient(r.x, y, r.x + r.w, y);
  bandG.addColorStop(0, band.c0); bandG.addColorStop(1, band.c1);
  fillRoundRect(ctx, r.x + 8, y + 8, r.w - 16, 26, 7, bandG);
  // Card name (on the band)
  crispText(ctx, card.name, r.x + r.w / 2, y + 26, "bold 13px system-ui, sans-serif", "#fff", "center");
  // Art area placeholder — faint tinted panel
  fillRoundRect(ctx, r.x + 8, y + 44, r.w - 16, 84, 8, accent + "26");
  // Type icon (text-only)
  const typeLabel = card.type === "attack" ? t("typeAttack") : card.type === "block" ? t("typeBlock") : t("typeHeal");
  crispText(ctx, typeLabel, r.x + r.w / 2, y + 92, "bold 14px system-ui, sans-serif", accent, "center");
  // Value
  crispText(ctx, String(card.value), r.x + r.w / 2, y + 152, "bold 20px system-ui, sans-serif", COLORS.text, "center");
  // Text (wrapped)
  const words = card.text.split(' ');
  let line = '', ly = y + 172;
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    const test = line + w + ' ';
    if (test.length > 16 && line) {
      crispText(ctx, line, r.x + r.w / 2, ly, "11px system-ui, sans-serif", COLORS.muted, "center");
      line = w + ' '; ly += 14;
    } else { line = test; }
  }
  if (line) crispText(ctx, line, r.x + r.w / 2, ly, "11px system-ui, sans-serif", COLORS.muted, "center");
  // Cost gem (glowing) with the number on top — drawn last so it sits above the band
  glowDot(ctx, r.x + 18, y + 18, 13, COLORS.energyColor, 12);
  crispText(ctx, String(card.cost), r.x + 18, y + 23, "bold 14px system-ui, sans-serif", COLORS.ink, "center");
}

function drawGameOver(ctx) {
  verticalBackdrop(ctx, "#2a0f12", "#080507");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(217,54,43,0.06)", "rgba(0,0,0,0.7)");
  const pulse = 1 + Math.sin(state.time * 2) * 0.03;
  ctx.save();
  ctx.translate(VIEW.w / 2, 280);
  ctx.scale(pulse, pulse);
  crispText(ctx, t("defeat"), 0, 0, "bold 52px system-ui, sans-serif", COLORS.hp, "center");
  ctx.restore();
  crispText(ctx, t("score", { score: state.runScore }), VIEW.w / 2, 340, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("retry"), VIEW.w / 2, 420, "18px system-ui, sans-serif", COLORS.muted, "center");
  clearClickRegions();
  registerClickRegion("retry", 0, 0, VIEW.w, VIEW.h, startGame);
}

function drawResult(ctx) {
  verticalBackdrop(ctx, "#141d30", "#070a12");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(229,200,74,0.07)", "rgba(0,0,0,0.65)");
  const pulse = 1 + Math.sin(state.time * 2) * 0.03;
  ctx.save();
  ctx.translate(VIEW.w / 2, 260);
  ctx.scale(pulse, pulse);
  crispText(ctx, t("victory"), 0, 0, "bold 48px system-ui, sans-serif", COLORS.gold, "center");
  ctx.restore();
  crispText(ctx, t("score", { score: Math.round(state.runScore) }), VIEW.w / 2, 330, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("nextBattle"), VIEW.w / 2, 410, "18px system-ui, sans-serif", COLORS.muted, "center");
  clearClickRegions();
  registerClickRegion("next", 0, 0, VIEW.w, VIEW.h, startNextBattle);
}
