// render.js — scene draw orchestration (asset-free: Canvas2D primitives only).
// Shares global `state`, dom, COLORS, VIEW.
function renderFrame() {
  const ctx = dom.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);

  if (state.mode === "loading") { drawLoading(ctx); return; }
  if (state.mode === "title") { drawField(ctx); drawTitle(ctx); return; }

  // screenshake offset
  let ox = 0, oy = 0;
  if (state.camera.shake > 0 && state.camera.shakeT > 0) {
    ox = (Math.random() * 2 - 1) * state.camera.shake;
    oy = (Math.random() * 2 - 1) * state.camera.shake;
  }
  ctx.save();
  ctx.translate(ox, oy);
  drawField(ctx);
  drawHoverPreview(ctx);
  drawTowers(ctx);
  drawEnemies(ctx);
  drawProjectiles(ctx);
  drawParticles(ctx);
  ctx.restore();

  // life-lost flash (full-screen, fades via game.js)
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(217,54,43,${state.flash * 0.4})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  drawHud(ctx);
  if (state.mode === "win") drawBanner(ctx, "VICTORY", COLORS.ok);
  if (state.mode === "gameover") drawBanner(ctx, "DEFEATED", COLORS.bad);
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.text;
  ctx.font = "24px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Loading...", VIEW.w / 2, VIEW.h / 2);
  ctx.textAlign = "left";
}

function drawField(ctx) {
  // grass background
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  // grid
  const cs = state.grid.cellSize;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= VIEW.w; x += cs) { ctx.moveTo(x, 0); ctx.lineTo(x, VIEW.h); }
  for (let y = 0; y <= VIEW.h; y += cs) { ctx.moveTo(0, y); ctx.lineTo(VIEW.w, y); }
  ctx.stroke();
  drawPath(ctx);
}

function drawPath(ctx) {
  if (!state.path) return;
  const pts = state.path.points;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = COLORS.pathEdge;
  ctx.lineWidth = 54;
  strokePolyline(ctx, pts);
  ctx.strokeStyle = COLORS.path;
  ctx.lineWidth = 44;
  strokePolyline(ctx, pts);
  // spawn + exit markers
  const a = pts[0], b = pts[pts.length - 1];
  ctx.fillStyle = "rgba(110,207,111,0.5)";
  ctx.beginPath(); ctx.arc(Math.max(8, a.x), a.y, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(217,54,43,0.5)";
  ctx.beginPath(); ctx.arc(Math.min(VIEW.w - 8, b.x), b.y, 16, 0, Math.PI * 2); ctx.fill();
}

function strokePolyline(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawHoverPreview(ctx) {
  const h = state.hover;
  if (!h || !input.mouse.inside) return;
  const cs = state.grid.cellSize;
  const type = towerTypeByIndex(state.selectedTowerType);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = h.valid ? "rgba(110,207,111,0.25)" : "rgba(217,54,43,0.25)";
  ctx.fillRect(h.col * cs, h.row * cs, cs, cs);
  ctx.strokeStyle = h.valid ? COLORS.ok : COLORS.bad;
  ctx.lineWidth = 2;
  ctx.strokeRect(h.col * cs + 1, h.row * cs + 1, cs - 2, cs - 2);
  // range ring
  ctx.beginPath();
  ctx.arc(h.cx, h.cy, type.range, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.stroke();
  if (h.valid) drawTowerShape(ctx, h.cx, h.cy, type.color, 1, 0, 0);
  ctx.restore();
}

function drawTowers(ctx) {
  for (const t of state.towers) {
    drawTowerShape(ctx, t.x, t.y, t.color, t.scale, t.angle, t.recoil);
  }
}

function drawTowerShape(ctx, x, y, color, scale, angle, recoil) {
  const s = (scale ?? 1);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // base
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.arc(0, 4, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ctx.arc(-5, -5, 6, 0, Math.PI * 2); ctx.fill();
  // barrel (recoils backward when firing)
  ctx.rotate(angle || 0);
  const kick = (recoil || 0) * 6;
  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(8 - kick, -5, 20, 10);
  ctx.restore();
}

function drawEnemies(ctx) {
  for (const e of state.enemies) {
    if (e.dead) continue;
    // body
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.arc(e.x, e.y + 3, e.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = e.slowMul < 1 ? "#7fc6e6" : e.color;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2); ctx.fill();
    // hurt flash overlay
    const hf = hurtFlash(e.hurtTimer);
    if (hf > 0) {
      ctx.save();
      ctx.globalAlpha = hf;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // facing eye
    ctx.fillStyle = "#10130f";
    ctx.beginPath(); ctx.arc(e.x + e.facing * e.radius * 0.4, e.y - 2, 3, 0, Math.PI * 2); ctx.fill();
    // hp bar
    if (e.hp < e.maxHp) {
      const w = e.radius * 2;
      const x = e.x - e.radius;
      const y = e.y - e.radius - 9;
      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(x, y, w, 4);
      ctx.fillStyle = COLORS.hp;
      ctx.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), 4);
    }
  }
}

function drawProjectiles(ctx) {
  for (const p of state.projectiles) {
    if (p.dead) continue;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.splashRadius > 0 ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles(ctx) {
  for (const p of state.particles) {
    const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.globalAlpha = 1;
  }
}

function drawTitle(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.gold;
  ctx.font = "bold 64px monospace";
  ctx.fillText(GAME.title, VIEW.w / 2, 250);
  ctx.fillStyle = COLORS.text;
  ctx.font = "22px monospace";
  ctx.fillText(GAME.tagline, VIEW.w / 2, 300);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) {
    ctx.font = "26px monospace";
    ctx.fillText("Press ENTER / click to start", VIEW.w / 2, 400);
  }
  ctx.fillStyle = COLORS.muted;
  ctx.font = "16px monospace";
  ctx.fillText("Click a grass cell to build · keys 1/2/3 pick tower · N sends next wave", VIEW.w / 2, 470);
  ctx.textAlign = "left";
}

function drawBanner(ctx, text, color) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, VIEW.h / 2 - 80, VIEW.w, 160);
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.font = "bold 72px monospace";
  ctx.fillText(text, VIEW.w / 2, VIEW.h / 2 + 6);
  ctx.fillStyle = COLORS.text;
  ctx.font = "22px monospace";
  ctx.fillText("Press ENTER to play again", VIEW.w / 2, VIEW.h / 2 + 56);
  ctx.textAlign = "left";
}
