var lastFrame = 0;

function drawErrorOverlay(err, label) {
  var ctx = typeof dom !== "undefined" && dom.ctx;
  if (!ctx) return;
  var w = (dom.canvas && dom.canvas.width) || 1280;
  var h = (dom.canvas && dom.canvas.height) || 720;
  ctx.save();
  ctx.fillStyle = "#2a0d0d"; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = "#ffd7d7"; ctx.font = "bold 20px monospace";
  ctx.fillText((label || "Error") + ":", 28, 48);
  ctx.fillStyle = "#ffecec"; ctx.font = "15px monospace";
  var msg = (err && (err.message || err.toString())) || String(err);
  var y = 84;
  var lines = (String(msg).match(/.{1,92}/g) || [String(msg)]).slice(0,4);
  for (var i = 0; i < lines.length; i++) { ctx.fillText(lines[i], 28, y); y += 24; }
  ctx.fillStyle = "#e7b7b7"; ctx.font = "12px monospace"; y += 8;
  var stack = err && err.stack ? String(err.stack).split("\n").slice(1,6) : [];
  for (var j = 0; j < stack.length; j++) { ctx.fillText(stack[j].trim().slice(0,110), 28, y); y += 18; }
  ctx.restore();
}

function startNewRun() {
  resetRunState();
  _spawnAccum = 0;
  state.player = createPlayer();
  initStars();
  state.mode = "playing";
}

function handleGlobalInput() {
  if ((state.mode === "title") && wasPressed("start")) { startNewRun(); return; }
  if (state.mode === "gameover" && wasPressed("start")) { startNewRun(); return; }
  if (state.mode === "playing" && wasPressed("pause")) { state.mode = "paused"; return; }
  if (state.mode === "paused"  && wasPressed("pause")) { state.mode = "playing"; return; }
}

function updateScene(dt) {
  if (state.mode !== "playing") return;
  state.scrollY += 60 * dt;
  updateShip(dt);
  updateWaves(dt);
  updateEnemies(dt);
  updatePlayerBullets(dt);
  updateEnemyBullets(dt);
}

async function loadLevel(id) {
  var res = await fetch("data/levels.json");
  var levels = await res.json();
  var entry = levels.levels.find(function(l) { return l.id === id; });
  if (!entry) throw new Error("Level not found: " + id);
  var r2 = await fetch(entry.file);
  state.level = await r2.json();
  state.sceneId = id;
}

async function boot() {
  initDom();
  initInput();
  initPools();
  window.addEventListener("error", function(e) { drawErrorOverlay(e.error || e.message, "Error"); });
  window.addEventListener("unhandledrejection", function(e) { drawErrorOverlay(e.reason, "Async error"); });
  await loadLevel("stage_1");
  state.mode = GAME.startMode;
  requestAnimationFrame(frame);
}

function frame(nowMs) {
  try {
    var now = nowMs / 1000;
    var dt = Math.min(0.05, lastFrame ? now - lastFrame : 0);
    lastFrame = now;
    state.time += dt;
    state.titleBlink += dt;
    if (state.hitstop > 0) state.hitstop = Math.max(0, state.hitstop - dt);
    var sdt = state.hitstop > 0 ? 0 : dt;
    updateInput();
    handleGlobalInput();
    updateScene(sdt);
    updateParticles(dt);
    updateJuice(dt);
    tickMusic(dt);
    renderFrame();
    drawJuice(dom.ctx);
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    state.error = err;
    drawErrorOverlay(err, "Runtime error");
  }
}

boot().catch(function(err) {
  console.error(err);
  state.error = err;
  drawErrorOverlay(err, "Boot failed");
});
