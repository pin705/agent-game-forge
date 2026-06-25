// render.js — all drawing is Canvas2D primitives (NO images, NO external assets).
// Order: bg gradient -> board (floor/grid/goal/hazard/wall) -> entities -> particles
// -> HUD -> screen overlays. Camera shake is applied as a translate; win-flash is a
// white veil that fades.

function renderFrame() {
  const ctx = dom.ctx;
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  drawBackground(ctx);

  if (state.mode === "loading") { drawCentered(ctx, "Loading…", 26, COLORS.muted); return; }

  // Camera shake (decays via particles.js timer).
  ctx.save();
  if (state.camera.shake > 0 && state.camera.shakeT > 0) {
    const s = state.camera.shake;
    ctx.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
  }

  if (state.level) {
    drawBoard(ctx);
    drawEntities(ctx);
    drawParticles(ctx);
  }
  drawJuice(ctx);          // floaters + trails (juice.js)
  ctx.restore();

  if (state.level) drawHud(ctx);

  // Win flash veil.
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${state.flash * 0.5})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  if (state.mode === "title") drawTitle(ctx);
  if (state.mode === "complete") drawComplete(ctx);
}

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  g.addColorStop(0, COLORS.bgTop);
  g.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function drawBoard(ctx) {
  const lvl = state.level;
  const o = gridOffset(lvl);
  const cs = lvl.cellSize;
  for (let y = 0; y < lvl.rows; y += 1) {
    for (let x = 0; x < lvl.cols; x += 1) {
      const cell = lvl.grid[y][x];
      const px = o.x + x * cs;
      const py = o.y + y * cs;
      if (cell === EMPTY) continue;
      if (cell === WALL) { drawWall(ctx, px, py, cs); continue; }

      // floor base (subtle checker)
      ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.floorA : COLORS.floorB;
      ctx.fillRect(px, py, cs, cs);

      if (cell === GOAL) drawGoal(ctx, px, py, cs);
      if (cell === HAZARD) drawHazard(ctx, px, py, cs);

      ctx.strokeStyle = COLORS.grid;
      ctx.strokeRect(px + 0.5, py + 0.5, cs, cs);
    }
  }
}

function drawWall(ctx, px, py, cs) {
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(px, py, cs, cs);
  ctx.fillStyle = COLORS.wallTop;
  ctx.fillRect(px, py, cs, Math.max(6, cs * 0.16));
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.strokeRect(px + 0.5, py + 0.5, cs, cs);
}

function drawGoal(ctx, px, py, cs) {
  const cx = px + cs / 2, cy = py + cs / 2;
  const pulse = 0.5 + 0.5 * Math.sin(state.time * 3);
  ctx.save();
  ctx.strokeStyle = COLORS.goal;
  ctx.globalAlpha = 0.55 + pulse * 0.45;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, cs * 0.26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = COLORS.goal;
  ctx.globalAlpha = 0.30 + pulse * 0.25;
  ctx.beginPath();
  ctx.arc(cx, cy, cs * 0.10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHazard(ctx, px, py, cs) {
  ctx.save();
  ctx.fillStyle = COLORS.hazard;
  ctx.globalAlpha = 0.30;
  ctx.fillRect(px + 3, py + 3, cs - 6, cs - 6);
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = COLORS.hazard;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + cs - 8, py + cs - 8);
  ctx.moveTo(px + cs - 8, py + 8); ctx.lineTo(px + 8, py + cs - 8);
  ctx.stroke();
  ctx.restore();
}

function drawEntities(ctx) {
  // boxes first (so the player draws on top when overlapping a step)
  for (const e of state.entities) if (e.type === "box" && e.alive !== false) drawBox(ctx, e);
  for (const e of state.entities) if (e.type === "player") drawPlayer(ctx, e);
}

function drawBox(ctx, b) {
  const cs = state.level.cellSize;
  const onGoal = getCell(state.level, b.gridX, b.gridY) === GOAL;
  // pop decays toward 0 (set in onBoxOnGoal); gives a quick squash.
  if (b.pop > 0) b.pop = Math.max(0, b.pop - 0.06);
  const f = (b.sizeFactor || 0.82) * (1 + (b.pop || 0) * 0.18);
  const size = cs * f;
  const x = b.px - size / 2, y = b.py - size / 2;
  ctx.fillStyle = onGoal ? COLORS.boxDone : COLORS.box;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = onGoal ? COLORS.boxDoneTop : COLORS.boxTop;
  ctx.fillRect(x, y, size, Math.max(5, size * 0.18));
  // X-brace face so a crate reads as a crate without art.
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, size, size);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y); ctx.lineTo(x, y + size);
  ctx.stroke();
}

function drawPlayer(ctx, p) {
  const cs = state.level.cellSize;
  const squash = 1 - (p.step || 0) * 0.18;
  const size = cs * (p.sizeFactor || 0.7);
  const w = size, h = size * squash;
  const x = p.px - w / 2, y = p.py - h / 2 + (size - h) / 2;
  ctx.fillStyle = COLORS.player;
  ctx.beginPath();
  ctx.arc(p.px, p.py, w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.playerEdge;
  ctx.stroke();
  // facing eye
  const d = DIRS[p.facing || "down"];
  ctx.fillStyle = "#0b1626";
  ctx.beginPath();
  ctx.arc(p.px + d.dx * w * 0.22, p.py + d.dy * w * 0.22, w * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

// --- screens ---------------------------------------------------------------
function drawCentered(ctx, text, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${size}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText(text, VIEW.w / 2, VIEW.h / 2);
  ctx.restore();
}

function drawTitle(ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.gold;
  ctx.font = "bold 64px monospace";
  ctx.fillText(GAME.title, VIEW.w / 2, 250);
  ctx.fillStyle = COLORS.text;
  ctx.font = "22px monospace";
  ctx.fillText(GAME.tagline, VIEW.w / 2, 300);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "16px monospace";
  ctx.fillText("Arrows / WASD move · Z undo · R reset", VIEW.w / 2, 360);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) {
    ctx.fillStyle = COLORS.jade;
    ctx.font = "24px monospace";
    ctx.fillText("Press Enter to start", VIEW.w / 2, 440);
  }
  ctx.restore();
}

function drawComplete(ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.jade;
  ctx.font = "bold 56px monospace";
  ctx.fillText("ALL SOLVED", VIEW.w / 2, 320);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "20px monospace";
  ctx.fillText("Press R to play again", VIEW.w / 2, 380);
  ctx.restore();
}
