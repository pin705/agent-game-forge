var _towerButtons = [];

function drawHud(ctx) {
  _towerButtons = [];

  // Left panel: gold + lives + wave
  softShape(ctx, 12, 12, 196, 92, 12, "rgba(10,16,12,0.74)", {
    shadowBlur: 14, highlight: false, stroke: "rgba(229,184,74,0.18)", lineWidth: 1
  });
  crispText(ctx, "Gold: " + state.gold, 24, 36, "bold 18px system-ui, sans-serif", COLORS.gold, "left");
  crispText(ctx, "Lives: " + state.lives, 24, 60, "bold 18px system-ui, sans-serif", COLORS.hp, "left");
  var waveTotal = (state.level && state.level.waves) ? state.level.waves.length : 0;
  crispText(ctx, "Wave: " + state.wave + "/" + waveTotal, 24, 84, "bold 16px system-ui, sans-serif", COLORS.text, "left");

  // Wave countdown
  if (!state.waveActive && state.wave < waveTotal) {
    crispText(ctx, "Next in " + Math.ceil(state.waveTimer) + "s", 24, 100, "13px system-ui, sans-serif", COLORS.muted, "left");
  } else if (!state.waveActive && state.wave >= waveTotal && state.mode === "playing") {
    crispText(ctx, "All waves done!", 24, 100, "13px system-ui, sans-serif", COLORS.xp || "#3ac47a", "left");
  }

  // Right panel: tower palette
  var types = Object.keys(TOWER_TYPES);
  var panelX = VIEW.w - 180;
  softShape(ctx, panelX - 8, 0, 188, types.length * 68 + 16, 12, "rgba(10,16,12,0.74)", {
    shadowBlur: 14, highlight: false, stroke: "rgba(229,184,74,0.14)", lineWidth: 1
  });
  crispText(ctx, "TOWERS", panelX, 18, "bold 13px system-ui, sans-serif", COLORS.text, "left");

  for (var i = 0; i < types.length; i++) {
    var type = types[i];
    var def = TOWER_TYPES[type];
    var by = 24 + i * 68;
    var selected = state.selectedTowerType === type;
    var canAfford = state.gold >= def.cost;

    // Card body — gradient + selected-state glow/stroke
    var cardOpts = {
      gradTop: selected ? "rgba(46,66,86,0.95)" : "rgba(24,34,44,0.9)",
      gradBottom: selected ? "rgba(28,42,56,0.95)" : "rgba(14,22,30,0.9)",
      shadowBlur: 10, highlight: false,
      stroke: selected ? COLORS.gold : "rgba(120,128,96,0.45)",
      lineWidth: selected ? 2 : 1
    };
    if (selected) { cardOpts.glow = "rgba(229,184,74,0.4)"; cardOpts.glowBlur = 18; }
    softShape(ctx, panelX - 4, by, 176, 60, 10, "rgba(24,34,44,0.9)", cardOpts);

    // Tower swatch
    softShape(ctx, panelX + 2, by + 8, 32, 32, 7, def.color, {
      gradTop: lightenHex(def.color, 55), gradBottom: def.color,
      shadowBlur: 6, stroke: "rgba(235,245,255,0.35)", lineWidth: 1, highlight: false
    });
    crispText(ctx, type.charAt(0).toUpperCase() + type.slice(1), panelX + 42, by + 26, "bold 13px system-ui, sans-serif", canAfford ? COLORS.text : COLORS.muted, "left");
    crispText(ctx, "$" + def.cost + "  rng " + def.range, panelX + 42, by + 44, "12px system-ui, sans-serif", canAfford ? COLORS.gold : COLORS.hp, "left");

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
