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
    ctx.fillStyle = "rgba(8,8,15,0.62)"; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    crispText(ctx, t("paused"), VIEW.w / 2, VIEW.h / 2, "bold 40px system-ui, sans-serif", COLORS.text, "center");
  }
}

function verticalBackdrop(ctx, top, bottom) {
  var g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  crispText(ctx, t("loading"), VIEW.w / 2, VIEW.h / 2, "24px system-ui, sans-serif", COLORS.text, "center");
}

function drawTitle(ctx) {
  verticalBackdrop(ctx, "#16162a", "#070710");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(47,166,106,0.05)", "rgba(0,0,0,0.62)");
  var pulse = 1 + Math.sin(state.time * 2) * 0.03;
  ctx.save();
  ctx.translate(VIEW.w / 2, 230);
  ctx.scale(pulse, pulse);
  crispText(ctx, t("title"), 0, 0, "bold 58px system-ui, sans-serif", COLORS.gold, "center");
  ctx.restore();
  crispText(ctx, t("tagline"), VIEW.w / 2, 290, "20px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("start"), VIEW.w / 2, 380, "18px system-ui, sans-serif", COLORS.muted, "center");
  crispText(ctx, t("hint"), VIEW.w / 2, 422, "15px system-ui, sans-serif", COLORS.muted, "center");
}

function drawGameOver(ctx) {
  verticalBackdrop(ctx, "#2a0f12", "#080507");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(217,54,43,0.06)", "rgba(0,0,0,0.72)");
  crispText(ctx, t("defeated"), VIEW.w / 2, 280, "bold 56px system-ui, sans-serif", COLORS.hp, "center");
  crispText(ctx, t("defeatedResult", { t: state.turn, s: state.score }), VIEW.w / 2, 342, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("retry"), VIEW.w / 2, 404, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function drawWinScreen(ctx) {
  verticalBackdrop(ctx, "#0f2a1d", "#050a08");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(47,166,106,0.10)", "rgba(0,0,0,0.68)");
  var pulse = 1 + Math.sin(state.time * 3) * 0.04;
  ctx.save();
  ctx.translate(VIEW.w / 2, 280);
  ctx.scale(pulse, pulse);
  crispText(ctx, t("escaped"), 0, 0, "bold 56px system-ui, sans-serif", COLORS.goal, "center");
  ctx.restore();
  crispText(ctx, t("escapedResult", { m: state.moves, s: state.score }), VIEW.w / 2, 342, "22px system-ui, sans-serif", COLORS.text, "center");
  if (Math.floor(state.titleBlink * 2) % 2 === 0)
    crispText(ctx, t("retry"), VIEW.w / 2, 404, "18px system-ui, sans-serif", COLORS.muted, "center");
}

function drawGridCells(ctx) {
  if (!state.level || !state.grid.length) return;
  // Dungeon mood: dark vertical gradient + vignette so the board sits in a lit pool.
  verticalBackdrop(ctx, "#16162a", "#08080f");
  vignette(ctx, VIEW.w, VIEW.h, "rgba(120,140,210,0.04)", "rgba(0,0,0,0.62)");
  var ox = gridOffsetX(), oy = gridOffsetY();
  var cs = CELL_SIZE;
  var gap = 2; // inset so cells read as separate tiles
  var pulse = 0.5 + Math.sin(state.time * 3) * 0.5; // 0..1 for goal/hazard glow
  for (var row = 0; row < state.grid.length; row++) {
    for (var col = 0; col < state.grid[row].length; col++) {
      var cell = state.grid[row][col];
      var px = ox + col * cs, py = oy + row * cs;
      if (cell === CELL_TYPES.WALL || cell === CELL_TYPES.EMPTY) {
        // Walls: raised bevel above the floor via softShape drop shadow.
        softShape(ctx, px + 1, py + 1, cs - 2, cs - 2, 6, COLORS.wall, {
          gradTop: "#2a2840", gradBottom: "#15131f", shadowBlur: 6, shadowOffsetY: 3,
          stroke: COLORS.wallEdge, lineWidth: 1, highlight: false
        });
      } else {
        // Floor tile: rounded, inset, lighter at top so it reads as a lit slab.
        var fx = px + gap, fy = py + gap, fw = cs - gap * 2, fh = cs - gap * 2;
        var fg = ctx.createLinearGradient(fx, fy, fx, fy + fh);
        fg.addColorStop(0, "#2c2a38"); fg.addColorStop(1, COLORS.floor);
        fillRoundRect(ctx, fx, fy, fw, fh, 5, fg);
        roundRectPath(ctx, fx + 0.5, fy + 0.5, fw - 1, fh - 1, 5);
        ctx.strokeStyle = COLORS.floorEdge; ctx.lineWidth = 1; ctx.stroke();
        if (cell === CELL_TYPES.GOAL) {
          glowDot(ctx, px + cs / 2, py + cs / 2, 9 + pulse * 7, COLORS.goal, 18 + pulse * 14);
          softShape(ctx, px + 8, py + 8, cs - 16, cs - 16, 8, COLORS.goal, {
            gradTop: "#54d98c", gradBottom: "#1c7a4c", glow: "rgba(47,166,106,0.7)",
            glowBlur: 14, stroke: "rgba(220,255,235,0.5)", lineWidth: 2, highlight: false
          });
          crispText(ctx, "★", px + cs / 2, py + cs / 2 + 10, "bold 28px system-ui, sans-serif", "#eafff2", "center");
        } else if (cell === CELL_TYPES.HAZARD) {
          softShape(ctx, px + 6, py + 6, cs - 12, cs - 12, 7, COLORS.hazard, {
            gradTop: "#e05a5a", gradBottom: "#7a2424", glow: "rgba(200,64,64," + (0.25 + pulse * 0.35) + ")",
            glowBlur: 10 + pulse * 8, stroke: "rgba(255,160,140,0.35)", lineWidth: 1, highlight: false
          });
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
      // Soft ground shadow ellipse.
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.beginPath();
      ctx.ellipse(dx + cs / 2, dy + cs - 12, (cs - 16) * 0.5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Jade/cyan rounded body with glow + drop shadow.
      softShape(ctx, dx + 8, dy + 8, cs - 16, cs - 16, 9, COLORS.player, {
        gradTop: "#7cffd8", gradBottom: "#1f9c7a", glow: "rgba(74,248,192,0.7)",
        glowBlur: 16, stroke: "rgba(225,255,248,0.55)", lineWidth: 2
      });
      // Direction indicator.
      var dotX = e.facing > 0 ? dx + cs - 18 : dx + 12;
      glowDot(ctx, dotX + 3, dy + cs / 2, 4, "#eafffa", 8);
      // HP bar.
      gradientBar(ctx, dx + 6, dy + 4, cs - 12, 5, Math.max(0, e.hp / e.maxHp), "#ff5d5d", "#ffd23f", COLORS.hpBack);
    } else if (e.type === "enemy") {
      // Ground shadow.
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.beginPath();
      ctx.ellipse(dx + cs / 2, dy + cs - 12, (cs - 20) * 0.55, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Menacing red rounded body.
      softShape(ctx, dx + 10, dy + 10, cs - 20, cs - 20, 7, COLORS.enemy, {
        gradTop: "#ff7a8e", gradBottom: "#a01838", glow: "rgba(232,64,96,0.55)",
        glowBlur: 12, stroke: "rgba(0,0,0,0.35)", lineWidth: 1, highlight: false
      });
      // Little menacing eyes.
      ctx.fillStyle = "rgba(20,6,10,0.9)";
      ctx.fillRect(dx + cs / 2 - 9, dy + cs / 2 - 4, 4, 4);
      ctx.fillRect(dx + cs / 2 + 5, dy + cs / 2 - 4, 4, 4);
      // HP bar.
      gradientBar(ctx, dx + 6, dy + 4, cs - 12, 4, Math.max(0, e.hp / e.maxHp), "#ff5d5d", "#ffd23f", COLORS.hpBack);
    } else if (e.type === "item") {
      var ipulse = 1 + Math.sin(state.time * 6) * 0.18;
      glowDot(ctx, dx + cs / 2, dy + cs / 2, 11 * ipulse, COLORS.item, 16);
      crispText(ctx, "◆", dx + cs / 2, dy + cs / 2 + 9, "bold 26px system-ui, sans-serif", "#fff3c8", "center");
    }
  }
}
