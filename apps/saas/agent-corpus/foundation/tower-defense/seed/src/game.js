// game.js — boot + frame loop. Loaded LAST. Mirrors side-scroll seed: try/catch
// frame, drawErrorOverlay, window error handlers, hit-stop dt gate, juice wiring.
let lastFrame = 0;

// Visible error screen: any boot / runtime / async error is painted on the
// canvas (message + top stack) instead of silently freezing.
function drawErrorOverlay(err, label) {
  const ctx = typeof dom !== "undefined" && dom.ctx;
  if (!ctx) return;
  const w = (dom.canvas && dom.canvas.width) || 1280;
  const h = (dom.canvas && dom.canvas.height) || 720;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#2a0d0d";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffd7d7";
  ctx.font = "bold 20px monospace";
  ctx.fillText((label || "Error") + ":", 28, 48);
  ctx.fillStyle = "#ffecec";
  ctx.font = "15px monospace";
  const msg = (err && (err.message || err.toString())) || String(err);
  let y = 84;
  for (const ln of (String(msg).match(/.{1,92}/g) || [String(msg)]).slice(0, 4)) { ctx.fillText(ln, 28, y); y += 24; }
  ctx.fillStyle = "#e7b7b7";
  ctx.font = "12px monospace";
  y += 8;
  for (const s of (err && err.stack ? String(err.stack).split("\n").slice(1, 6) : [])) { ctx.fillText(s.trim().slice(0, 110), 28, y); y += 18; }
  ctx.restore();
}

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function boot() {
  initDom();
  initInput();
  window.addEventListener("error", (e) => drawErrorOverlay(e.error || e.message, "Error"));
  window.addEventListener("unhandledrejection", (e) => drawErrorOverlay(e.reason, "Async error"));

  const levels = await loadJSON("data/levels.json");
  const entry = levels.levels.find((l) => l.id === GAME.startScene) || levels.levels[0];
  state.config = await loadJSON(entry.file);
  state.grid = { ...state.config.grid };

  // prime derived state for the title screen (path visible behind title)
  state.path = buildPath(state.config.path);
  initEconomy(state.config);
  initWaves(state.config);

  state.mode = GAME.startMode;
  requestAnimationFrame(frame);
}

function startNewRun() {
  resetRunState();
}

// routed from input.js mousedown (canvas coords already in 1280x720 space)
function onPointer(mx, my) {
  if (state.mode === "title" || state.mode === "win" || state.mode === "gameover") {
    startNewRun();
    return;
  }
  if (state.mode !== "playing") return;
  // tower picker buttons first
  const pick = pickerHitTest(mx, my);
  if (pick >= 0) { state.selectedTowerType = pick; return; }
  // otherwise try to build on the clicked grid cell
  const cs = state.grid.cellSize;
  const col = Math.floor(mx / cs);
  const row = Math.floor(my / cs);
  tryPlaceTower(col, row);
}

function handleKeys() {
  if ((state.mode === "title" || state.mode === "win" || state.mode === "gameover") && wasPressed("start")) {
    startNewRun();
    return;
  }
  if (state.mode === "playing") {
    if (wasPressed("one")) state.selectedTowerType = 0;
    if (wasPressed("two")) state.selectedTowerType = Math.min(1, state.config.towers.length - 1);
    if (wasPressed("three")) state.selectedTowerType = Math.min(2, state.config.towers.length - 1);
    if (wasPressed("next")) requestNextWaveNow();
  }
}

function updateHover() {
  if (!input.mouse.inside) { state.hover = null; return; }
  const cs = state.grid.cellSize;
  const col = Math.floor(input.mouse.x / cs);
  const row = Math.floor(input.mouse.y / cs);
  state.hover = {
    col, row,
    cx: col * cs + cs / 2,
    cy: row * cs + cs / 2,
    valid: isCellBuildable(col, row) && canAfford(towerTypeByIndex(state.selectedTowerType).cost)
  };
}

function frame(nowMs) {
  try {
    const now = nowMs / 1000;
    const dt = Math.min(0.05, lastFrame ? now - lastFrame : 0);
    lastFrame = now;
    state.time += dt;
    state.titleBlink += dt;

    // Hit-stop: gameplay freezes while the timer runs; FX + render keep going.
    if (state.hitstop > 0) state.hitstop = Math.max(0, state.hitstop - dt);
    const sdt = state.hitstop > 0 ? 0 : dt;

    updateInput();
    handleKeys();

    if (state.mode === "playing") {
      updateHover();
      updateWaves(sdt);
      updateEnemies(sdt);
      updateTowers(sdt);
      updateProjectiles(sdt);
    }

    // FX always advance (even during hitstop / banners)
    updateParticles(dt);
    updateJuice(dt);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.2);

    renderFrame();
    drawJuice(dom.ctx);

    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    state.error = err;
    drawErrorOverlay(err, "Runtime error");
  }
}

boot().catch((err) => {
  console.error(err);
  state.error = err;
  drawErrorOverlay(err, "Boot failed");
});
