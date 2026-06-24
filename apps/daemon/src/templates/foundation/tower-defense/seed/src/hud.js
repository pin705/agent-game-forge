// hud.js — pure render of gold / lives / wave + the tower picker bar. Reads
// state, never mutates economy. (recipes/economy.md "HUD reads, never writes").
function drawHud(ctx) {
  // top-left stats
  ctx.textAlign = "left";
  ctx.font = "bold 22px monospace";
  ctx.fillStyle = COLORS.gold;
  ctx.fillText(`Gold ${state.gold}`, 16, 30);
  ctx.fillStyle = COLORS.hp;
  ctx.fillText(`Lives ${state.lives}`, 16, 58);
  ctx.fillStyle = COLORS.text;
  const w = state.wave;
  const waveNo = Math.max(1, w.index + 1);
  ctx.fillText(`Wave ${Math.min(waveNo, w.defs.length)}/${w.defs.length}`, 16, 86);

  if (w.waiting && !w.done && state.mode === "playing") {
    ctx.fillStyle = COLORS.muted;
    ctx.font = "16px monospace";
    ctx.fillText(`Next wave in ${Math.ceil(state.wave.restTimer)}s  (press N to send now)`, 16, 110);
  }

  drawTowerPicker(ctx);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "15px monospace";
  ctx.textAlign = "right";
  const sel = towerTypeByIndex(state.selectedTowerType);
  ctx.fillText(`Click a grass cell to place ${sel.name} (cost ${sel.cost})`, VIEW.w - 16, 30);
  ctx.textAlign = "left";
}

// tower buttons across the bottom; the selected one is outlined gold
function drawTowerPicker(ctx) {
  const types = state.config.towers;
  const bw = 150, bh = 56, gap = 12;
  const totalW = types.length * bw + (types.length - 1) * gap;
  let x = (VIEW.w - totalW) / 2;
  const y = VIEW.h - bh - 14;
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const selected = i === state.selectedTowerType;
    const afford = canAfford(t.cost);
    ctx.fillStyle = "rgba(16,19,15,0.85)";
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = selected ? COLORS.gold : "rgba(255,255,255,0.2)";
    ctx.lineWidth = selected ? 3 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, bw, bh);
    // icon
    ctx.fillStyle = t.color;
    ctx.beginPath(); ctx.arc(x + 26, y + bh / 2, 14, 0, Math.PI * 2); ctx.fill();
    // label
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 17px monospace";
    ctx.fillText(`${i + 1} ${t.name}`, x + 48, y + 24);
    ctx.fillStyle = afford ? COLORS.gold : COLORS.bad;
    ctx.font = "15px monospace";
    ctx.fillText(`${t.cost}g`, x + 48, y + 44);
    // remember rect for click hit-testing
    t._btn = { x, y, w: bw, h: bh };
    x += bw + gap;
  }
}

// hit-test the tower picker; returns picked index or -1
function pickerHitTest(mx, my) {
  const types = state.config.towers;
  for (let i = 0; i < types.length; i++) {
    const b = types[i]._btn;
    if (b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return i;
  }
  return -1;
}
