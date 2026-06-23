var _waveSpawnTimer = 0;
var _waveSpawned = 0;

function updateWaves(dt) {
  if (!state.level || !state.level.waves) return;
  if (state.mode !== "playing") return;
  if (!state.waveActive) {
    state.waveTimer -= dt;
    if (state.waveTimer <= 0 && state.wave < state.level.waves.length) {
      startNextWave();
    }
    return;
  }
  var waveData = state.level.waves[state.wave - 1];
  if (!waveData) { state.waveActive = false; return; }
  _waveSpawnTimer -= dt;
  if (_waveSpawnTimer <= 0 && _waveSpawned < waveData.count) {
    _waveSpawned++;
    _waveSpawnTimer = waveData.interval;
    spawnEnemy(waveData.kind);
  }
  if (_waveSpawned >= waveData.count && state.enemies.length === 0) {
    state.waveActive = false;
    state.waveTimer = 8;
    if (state.wave >= state.level.waves.length) {
      state.mode = "win";
    }
  }
}

function startNextWave() {
  if (!state.level || state.wave >= state.level.waves.length) return;
  state.wave++;
  _waveSpawned = 0;
  _waveSpawnTimer = 0;
  state.waveActive = true;
  state.waveTimer = 0;
}
