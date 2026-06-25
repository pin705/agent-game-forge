// hud.js — drawn HUD (no DOM): a top panel with move count + boxes-on-goal / total
// + level number, and a controls hint along the bottom.

function drawHud(ctx) {
  ctx.save();
  // top status bar
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(0, 0, VIEW.w, 46);
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.beginPath();
  ctx.moveTo(0, 46.5); ctx.lineTo(VIEW.w, 46.5);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.font = "20px monospace";
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`Level ${state.levelIndex + 1}/${state.levels.length}`, 24, 31);

  ctx.textAlign = "center";
  const allDone = state.boxesOnGoal === state.totalGoals && state.totalGoals > 0;
  ctx.fillStyle = allDone ? COLORS.jade : COLORS.gold;
  ctx.fillText(`Goals  ${state.boxesOnGoal} / ${state.totalGoals}`, VIEW.w / 2, 31);

  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`Moves  ${state.moveCount}`, VIEW.w - 24, 31);

  // controls hint
  ctx.textAlign = "center";
  ctx.font = "14px monospace";
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("Arrows / WASD move    Z undo    R reset", VIEW.w / 2, VIEW.h - 18);
  ctx.restore();
}
