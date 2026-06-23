let lastFrame = 0;

// Visible error screen: any boot / runtime / async error is painted on the canvas
// (message + top stack) instead of silently freezing with only a console log.
// This is the in-game half of the debug protocol — the player can see + report it.
function drawErrorOverlay(err, label) {
  const ctx = typeof dom !== "undefined" && dom.ctx;
  if (!ctx) return;
  const w = (dom.canvas && dom.canvas.width) || 1280;
  const h = (dom.canvas && dom.canvas.height) || 720;
  ctx.save();
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

function wireMouseInput() {
  dom.canvas.addEventListener('click', function(e) {
    const rect = dom.canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (VIEW.w / rect.width);
    const my = (e.clientY - rect.top) * (VIEW.h / rect.height);
    handleCanvasClick(mx, my);
  });
  dom.canvas.addEventListener('mousemove', function(e) {
    const rect = dom.canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (VIEW.w / rect.width);
    const my = (e.clientY - rect.top) * (VIEW.h / rect.height);
    handleCanvasHover(mx, my);
  });
}

async function loadCatalogs() {
  try {
    const cardsResp = await fetch('data/cards.json');
    if (cardsResp.ok) {
      state.cardDefs = await cardsResp.json();
    }
  } catch (e) {
    // fallback to BUILTIN_CARDS
  }
  try {
    const enemiesResp = await fetch('data/enemies.json');
    if (enemiesResp.ok) {
      state.enemies = await enemiesResp.json();
    }
  } catch (e) {
    // fallback to inline enemy defs
  }
}

async function boot() {
  initDom();
  initInput();
  wireMouseInput();
  window.addEventListener("error", function(e) { drawErrorOverlay(e.error || e.message, "Error"); });
  window.addEventListener("unhandledrejection", function(e) { drawErrorOverlay(e.reason, "Async error"); });
  await loadStrings();
  await loadCatalogs();
  state.mode = GAME.startMode;
  state.screen = "title";
  requestAnimationFrame(frame);
}

function frame(nowMs) {
  try {
    const now = nowMs / 1000;
    const dt = Math.min(0.05, lastFrame ? now - lastFrame : 0);
    lastFrame = now;
    // Hit-stop: gameplay freezes while the timer runs, but FX + render keep going
    // so the freeze-frame reads as impact weight, not a stutter. (juice.js)
    if (state.hitstop > 0) state.hitstop = Math.max(0, state.hitstop - dt);
    const sdt = state.hitstop > 0 ? 0 : dt;
    updateInput();
    handleGlobalInput();
    updateBattleAnim(sdt);
    updateParticles(dt);
    updateJuice(dt);
    tickMusic(dt);
    renderFrame();
    drawJuice(dom.ctx);
    requestAnimationFrame(frame);
  } catch (err) {
    // Don't silently freeze: show the error on-canvas (loop stops, overlay stays).
    console.error(err);
    state.error = err;
    drawErrorOverlay(err, "Runtime error");
  }
}

function handleGlobalInput() {
  if ((state.mode === "title" || state.screen === "title") && wasPressed("start")) {
    startGame();
    return;
  }
  if ((state.mode === "gameover" || state.screen === "gameover") && wasPressed("start")) {
    startGame();
    return;
  }
  if (state.mode === "result" && wasPressed("start")) {
    startNextBattle();
    return;
  }
  if ((state.mode === "playing" || state.mode === "paused") && wasPressed("pause")) {
    state.mode = state.mode === "paused" ? "playing" : "paused";
  }
}

function updateBattleAnim(dt) {
  state.time += dt;
  state.titleBlink += dt;
}

function startGame() {
  resetRunState();
  resetBattle();
  startBattle("slime");
  state.mode = "playing";
}

function startNextBattle() {
  state.floor++;
  startBattle("golem");
  state.mode = "playing";
  state.screen = "battle";
}

boot().catch(function(err) {
  console.error(err);
  state.error = err;
  drawErrorOverlay(err, "Boot failed");
});
