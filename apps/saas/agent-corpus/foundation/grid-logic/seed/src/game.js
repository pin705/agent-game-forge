let lastFrame = 0;

// Visible error screen: any boot / runtime / async error is painted on the canvas
// (message + top stack) instead of silently freezing. This is the in-game half of
// the debug protocol — copied verbatim in spirit from the side-scroll seed.
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

async function loadLevelRegistry() {
  const res = await fetch("data/levels.json");
  if (!res.ok) throw new Error(`levels.json failed to load (${res.status})`);
  const reg = await res.json();
  state.levels = reg.levels || [];
  if (!state.levels.length) throw new Error("levels.json has no levels");
}

async function boot() {
  initDom();
  initInput();
  window.addEventListener("error", (e) => drawErrorOverlay(e.error || e.message, "Error"));
  window.addEventListener("unhandledrejection", (e) => drawErrorOverlay(e.reason, "Async error"));
  await loadLevelRegistry();
  await loadLevelById(state.levels[state.levelIndex]);
  state.mode = GAME.startMode;           // -> "title"
  requestAnimationFrame(frame);
}

function startGame() {
  state.levelIndex = 0;
  loadLevelById(state.levels[0]).catch((err) => { state.error = err; drawErrorOverlay(err, "Start failed"); });
}

function handleGlobalInput() {
  if (state.mode === "title" && wasPressed("start")) { startGame(); return; }
  if (state.mode === "complete" && wasPressed("reset")) { startGame(); return; }

  if (state.mode !== "playing") return;
  if (wasPressed("reset")) { resetLevel(); return; }
  if (wasPressed("undo")) { popUndo(); return; }
  if (!acceptingInput()) return;
  if (wasPressed("up")) takePlayerTurn(() => tryMove("up"));
  else if (wasPressed("down")) takePlayerTurn(() => tryMove("down"));
  else if (wasPressed("left")) takePlayerTurn(() => tryMove("left"));
  else if (wasPressed("right")) takePlayerTurn(() => tryMove("right"));
}

function frame(nowMs) {
  try {
    const now = nowMs / 1000;
    const dt = Math.min(0.05, lastFrame ? now - lastFrame : 0);
    lastFrame = now;
    state.time += dt;
    state.titleBlink += dt;

    // Hit-stop: gameplay freezes while the timer runs, but FX + render keep going.
    if (state.hitstop > 0) state.hitstop = Math.max(0, state.hitstop - dt);
    const sdt = state.hitstop > 0 ? 0 : dt;

    updateInput();
    handleGlobalInput();

    updateAnimations(sdt);   // drain move-lerp queue (gated by hit-stop)
    pumpAnimCallback();      // fire whenAnimationsDone(cb) once the queue empties
    updateWinHold(dt);
    updateParticles(dt);
    updateJuice(dt);         // tweens + floaters + trails + combo (juice.js)
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 1.6);

    renderFrame();
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
