const state = {
  mode: "loading",
  sceneId: null,
  level: null,
  time: 0,
  runTime: 0,
  score: 0,
  camera: { x: 0, y: 0, shake: 0, shakeT: 0 },
  player: null,
  enemies: [],
  projectiles: [],
  pickups: [],
  particles: [],
  floaters: [],
  tweens: [],
  trails: [],
  hitstop: 0,
  combo: 0,
  comboT: 0,
  waveTimer: 0,
  waveIndex: 0,
  killCount: 0,
  upgradeCards: [],
  titleBlink: 0,
  error: null
};

function resetRunState() {
  state.time = 0; state.runTime = 0; state.score = 0;
  state.camera.x = 0; state.camera.y = 0; state.camera.shake = 0; state.camera.shakeT = 0;
  state.enemies.length = 0; state.projectiles.length = 0; state.pickups.length = 0;
  state.particles.length = 0; state.floaters.length = 0; state.tweens.length = 0; state.trails.length = 0;
  state.hitstop = 0; state.combo = 0; state.comboT = 0;
  state.waveTimer = 0; state.waveIndex = 0; state.killCount = 0; state.upgradeCards = [];
}
