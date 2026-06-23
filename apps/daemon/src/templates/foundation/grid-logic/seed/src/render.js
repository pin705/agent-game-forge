function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function drawParticles(ctx) {
  for (var i = 0; i < state.particles.length; i++) {
    var p = state.particles[i];
    var alpha = clamp01(p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function renderFrame() {
  var ctx = dom.ctx;
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  if (state.mode === "loading") { drawLoading(ctx); return; }
  if (state.mode === "title")   { drawTitle(ctx); return; }
  if (state.mode === "gameover") { drawGameOver(ctx); return; }
  if (state.mode === "win")     { drawWinScreen(ctx); return; }
  drawGridCells(ctx);
  drawEntitiesOnCanvas(ctx);
  drawParticles(ctx);
  drawHud(ctx);
  if (state.mode === "paused") {
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.fillStyle = COLORS.text; ctx.font = "bold 38px monospace"; ctx.textAlign = "center";
    ctx.fillText("PAUSED", VIEW.w / 2, VIEW.h / 2);
    ctx.textAlign = "left";
  }
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.text; ctx.font = "24px monospace"; ctx.textAlign = "center";
  ctx.fillText("Loading...", VIEW.w / 2, VIEW.h / 2); ctx.textAlign = "left";
}

function drawTitle(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.gold; ctx.font = "bold 56px monospace"; ctx.textAlign = "center";
  ctx.fillText(GAME.title.toUpperCase(), VIEW.w / 2, 230);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Arrows: move   Z: undo   Reach the green exit", VIEW.w / 2, 285);
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    ctx.fillText("Press Enter to Start", VIEW.w / 2, 375);
  ctx.textAlign = "left";
}

function drawGameOver(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.hp; ctx.font = "bold 52px monospace"; ctx.textAlign = "center";
  ctx.fillText("DEFEATED", VIEW.w / 2, 280);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("Survived " + state.turn + " turns. Score: " + state.score, VIEW.w / 2, 340);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter to Retry", VIEW.w / 2, 400);
  ctx.textAlign = "left";
}

function drawWinScreen(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.goal; ctx.font = "bold 52px monospace"; ctx.textAlign = "center";
  ctx.fillText("ESCAPED!", VIEW.w / 2, 280);
  ctx.fillStyle = COLORS.text; ctx.font = "22px monospace";
  ctx.fillText("In " + state.moves + " moves. Score: " + state.score, VIEW.w / 2, 340);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) ctx.fillText("Press Enter to Retry", VIEW.w / 2, 400);
  ctx.textAlign = "left";
}

function drawGridCells(ctx) {
  if (!state.level || !state.grid.length) return;
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  var ox = gridOffsetX(), oy = gridOffsetY();
  var cs = CELL_SIZE;
  for (var row = 0; row < state.grid.length; row++) {
    for (var col = 0; col < state.grid[row].length; col++) {
      var cell = state.grid[row][col];
      var px = ox + col * cs, py = oy + row * cs;
      if (cell === CELL_TYPES.WALL || cell === CELL_TYPES.EMPTY) {
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(px, py, cs, cs);
        ctx.strokeStyle = COLORS.wallEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
      } else {
        ctx.fillStyle = COLORS.floor;
        ctx.fillRect(px, py, cs, cs);
        ctx.strokeStyle = COLORS.floorEdge;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
        if (cell === CELL_TYPES.GOAL) {
          ctx.fillStyle = COLORS.goal + "60";
          ctx.fillRect(px + 4, py + 4, cs - 8, cs - 8);
          ctx.fillStyle = COLORS.goal;
          ctx.font = "bold 28px monospace"; ctx.textAlign = "center";
          ctx.fillText("★", px + cs / 2, py + cs / 2 + 10);
          ctx.textAlign = "left";
        } else if (cell === CELL_TYPES.HAZARD) {
          ctx.fillStyle = COLORS.hazard + "44";
          ctx.fillRect(px + 4, py + 4, cs - 8, cs - 8);
        }
      }
    }
  }
}

function drawEntitiesOnCanvas(ctx) {
  var cs = CELL_SIZE;
  for (var i = 0; i < state.entities.length; i++) {
    var e = state.entities[i];
    if (!e.alive) continue;
    var dx = e.displayX, dy = e.displayY;
    if (e.type === "player") {
      ctx.fillStyle = COLORS.player;
      ctx.fillRect(dx + 8, dy + 8, cs - 16, cs - 16);
      // Direction dot
      ctx.fillStyle = "#fff";
      var dotX = e.facing > 0 ? dx + cs - 14 : dx + 8;
      ctx.fillRect(dotX, dy + cs / 2 - 4, 6, 8);
      // HP bar
      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(dx + 4, dy + 4, cs - 8, 5);
      ctx.fillStyle = COLORS.hp;
      ctx.fillRect(dx + 4, dy + 4, (cs - 8) * Math.max(0, e.hp / e.maxHp), 5);
    } else if (e.type === "enemy") {
      ctx.fillStyle = COLORS.enemy;
      ctx.fillRect(dx + 10, dy + 10, cs - 20, cs - 20);
      // HP
      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(dx + 4, dy + 4, cs - 8, 4);
      ctx.fillStyle = COLORS.hp;
      ctx.fillRect(dx + 4, dy + 4, (cs - 8) * Math.max(0, e.hp / e.maxHp), 4);
    } else if (e.type === "item") {
      ctx.fillStyle = COLORS.item;
      ctx.font = "bold 26px monospace"; ctx.textAlign = "center";
      ctx.fillText("◆", dx + cs / 2, dy + cs / 2 + 9);
      ctx.textAlign = "left";
    }
  }
}
