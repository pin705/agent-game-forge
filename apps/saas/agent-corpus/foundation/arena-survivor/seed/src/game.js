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
  var stack = (err && err.stack ? String(err.stack).split("\n").slice(1,6) : []);
  for (var j = 0; j < stack.length; j++) { ctx.fillText(stack[j].trim().slice(0,110), 28, y); y += 18; }
  ctx.restore();
}

function startNewRun() {
  resetRunState();
  var pc = CONFIG.player;
  var spawn = (state.level && state.level.playerSpawn) || { x: 1600, y: 1600 };
  state.player = {
    x: spawn.x, y: spawn.y, w: pc.radius * 2, h: pc.radius * 2,
    hp: pc.maxHp, maxHp: pc.maxHp, speed: pc.speed, invuln: 0,
    xp: 0, level: 1, weapons: ["wand"]
  };
  _weaponTimer = 0;
  WEAPON_COOLDOWN = CONFIG.weapon.cooldown;
  state.mode = "playing";
}

function updateCamera() {
  if (!state.player) return;
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  if (state.camera.shakeT > 0) {
    state.camera.shakeT -= 0.016;
    if (state.camera.shakeT <= 0) state.camera.shake = 0;
  }
}

function updatePlayerMovement(dt) {
  var p = state.player;
  if (!p) return;
  var dx = 0, dy = 0;
  if (isHeld("left"))  dx -= 1;
  if (isHeld("right")) dx += 1;
  if (isHeld("up"))    dy -= 1;
  if (isHeld("down"))  dy += 1;
  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
  p.x += dx * p.speed * dt;
  p.y += dy * p.speed * dt;
  if (state.level) {
    var r = CONFIG.player.radius;
    var aw = state.level.arena.width, ah = state.level.arena.height;
    p.x = Math.max(r, Math.min(aw - r, p.x));
    p.y = Math.max(r, Math.min(ah - r, p.y));
  }
  if (p.invuln > 0) p.invuln -= dt;
}

function handleGlobalInput() {
  if (state.mode === "title" && wasPressed("start")) { startNewRun(); return; }
  if (state.mode === "gameover" && wasPressed("start")) { startNewRun(); return; }
  if (state.mode === "playing" && wasPressed("pause")) { state.mode = "paused"; return; }
  if (state.mode === "paused" && wasPressed("pause")) { state.mode = "playing"; return; }
  if (state.mode === "levelup") {
    if (wasPressed("start") || isHeld("interact")) applyUpgrade(state.upgradeCards[0]);
    var keys = ["Digit1","Digit2","Digit3"];
    for (var i = 0; i < keys.length; i++) {
      if (state.upgradeCards[i] && wasPressed(keys[i])) { applyUpgrade(state.upgradeCards[i]); break; }
    }
  }
}

function updateScene(dt) {
  if (state.mode !== "playing") return;
  state.runTime += dt;
  updateCamera();
  updatePlayerMovement(dt);
  spawnWave(dt);
  updateEnemies(dt);
  updateWeapons(dt);
  updateProjectiles(dt);
  updateXp(dt);
}

async function loadLevel(id) {
  var levelsRes = await fetch("data/levels.json");
  var levels = await levelsRes.json();
  var entry = levels.levels.find(function(l) { return l.id === id; });
  if (!entry) throw new Error("Level not found: " + id);
  var res = await fetch(entry.file);
  state.level = await res.json();
  state.sceneId = id;
}

var CONFIG = null;
async function loadConfig() {
  var res = await fetch("data/arena-config.json");
  CONFIG = await res.json();
}

async function boot() {
  initDom();
  initInput();
  initMobile();
  initPools();
  window.addEventListener("error", function(e) { drawErrorOverlay(e.error || e.message, "Error"); });
  window.addEventListener("unhandledrejection", function(e) { drawErrorOverlay(e.reason, "Async error"); });
  await loadStrings();
  await loadConfig();
  await loadLevel("arena");
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
    drawMobileControls(dom.ctx);
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
