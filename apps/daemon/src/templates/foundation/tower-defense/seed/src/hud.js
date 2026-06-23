var _towerButtons = [];

function drawHud(ctx) {
  _towerButtons = [];

  // Left panel: gold + lives + wave
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(0, 0, 200, 100);
  ctx.fillStyle = COLORS.gold;
  ctx.font = "bold 18px monospace";
  ctx.fillText("Gold: " + state.gold, 12, 26);
  ctx.fillStyle = COLORS.hp;
  ctx.fillText("Lives: " + state.lives, 12, 50);
  ctx.fillStyle = COLORS.text;
  var waveTotal = (state.level && state.level.waves) ? state.level.waves.length : 0;
  ctx.fillText("Wave: " + state.wave + "/" + waveTotal, 12, 74);

  // Wave countdown
  if (!state.waveActive && state.wave < waveTotal) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = "13px monospace";
    ctx.fillText("Next in " + Math.ceil(state.waveTimer) + "s", 12, 94);
  } else if (!state.waveActive && state.wave >= waveTotal && state.mode === "playing") {
    ctx.fillStyle = COLORS.xp || "#3ac47a";
    ctx.font = "13px monospace";
    ctx.fillText("All waves done!", 12, 94);
  }

  // Right panel: tower palette
  var types = Object.keys(TOWER_TYPES);
  var panelX = VIEW.w - 180;
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(panelX - 8, 0, 188, types.length * 68 + 16);
  ctx.fillStyle = COLORS.text;
  ctx.font = "12px monospace";
  ctx.fillText("TOWERS", panelX, 16);

  for (var i = 0; i < types.length; i++) {
    var type = types[i];
    var def = TOWER_TYPES[type];
    var by = 24 + i * 68;
    var selected = state.selectedTowerType === type;
    var canAfford = state.gold >= def.cost;

    ctx.fillStyle = selected ? (canAfford ? "rgba(74,104,136,0.5)" : "rgba(136,80,64,0.4)") : COLORS.panel;
    ctx.fillRect(panelX - 4, by, 176, 60);
    ctx.strokeStyle = selected ? COLORS.gold : COLORS.muted;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(panelX - 4, by, 176, 60);

    ctx.fillStyle = def.color;
    ctx.fillRect(panelX + 2, by + 8, 32, 32);
    ctx.fillStyle = canAfford ? COLORS.text : COLORS.muted;
    ctx.font = "bold 13px monospace";
    ctx.fillText(type.charAt(0).toUpperCase() + type.slice(1), panelX + 42, by + 24);
    ctx.fillStyle = canAfford ? COLORS.gold : COLORS.hp;
    ctx.font = "12px monospace";
    ctx.fillText("$" + def.cost + "  rng " + def.range, panelX + 42, by + 42);

    _towerButtons.push({ type: type, x: panelX - 4, y: by, w: 176, h: 60 });
  }
}

function handleHudClick(mx, my) {
  for (var i = 0; i < _towerButtons.length; i++) {
    var b = _towerButtons[i];
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
      state.selectedTowerType = b.type;
      return true;
    }
  }
  return false;
}
