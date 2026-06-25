// waves.js — wave timeline: flatten each wave into a time-stamped spawn queue,
// drain it, rest between waves, win when the last wave clears.
// (recipes/path-and-waves.md). Shares global `state`.
const MIN_SPAWN_INTERVAL = 0.35;
const TIME_BETWEEN_WAVES = 5;

function initWaves(level) {
  state.wave = {
    defs: level.waves,
    index: -1,
    queue: [],
    elapsed: 0,
    active: false,
    alive: 0,
    waiting: true,
    restTimer: level.waves[0] ? (level.waves[0].delay ?? 1) : 1,
    done: false
  };
}

function buildQueue(waveDef) {
  const queue = [];
  let at = 0;
  for (const g of waveDef.groups) {
    const step = Math.max(g.interval, MIN_SPAWN_INTERVAL);
    for (let i = 0; i < g.count; i++) { queue.push({ group: g, at }); at += step; }
  }
  queue.sort((a, b) => a.at - b.at);
  return queue;
}

function startNextWave() {
  const w = state.wave;
  w.index++;
  if (w.index >= w.defs.length) { w.active = false; return; }
  w.queue = buildQueue(w.defs[w.index]);
  w.elapsed = 0;
  w.active = true;
  w.waiting = false;
}

// "send next wave now" (N key) during a rest pause
function requestNextWaveNow() {
  if (state.wave.waiting) state.wave.restTimer = 0;
}

function notifyEnemyRemoved() {
  state.wave.alive = Math.max(0, state.wave.alive - 1);
}

function updateWaves(dt) {
  const w = state.wave;
  if (w.done) return;

  if (w.waiting) {
    w.restTimer -= dt;
    if (w.restTimer <= 0) startNextWave();
    return;
  }
  if (!w.active) return;

  w.elapsed += dt;
  while (w.queue.length && w.elapsed >= w.queue[0].at) {
    const next = w.queue.shift();
    spawnEnemy(next.group);
    w.alive++;
  }

  if (w.queue.length === 0 && w.alive <= 0) onWaveCleared();
}

function onWaveCleared() {
  const w = state.wave;
  if (w.index + 1 >= w.defs.length) {
    w.active = false;
    w.done = true;
    winGame();
  } else {
    w.active = false;
    w.waiting = true;
    const nextDef = w.defs[w.index + 1];
    w.restTimer = (nextDef && nextDef.delay != null) ? nextDef.delay : TIME_BETWEEN_WAVES;
    // wave-clear bonus to keep the economy moving (scales up a little per wave)
    const bonus = 30 + w.index * 10;
    earnGold(bonus);
    floater(`+${bonus} wave bonus`, VIEW.w / 2, 120, { color: COLORS.gold, size: 20 });
  }
}
