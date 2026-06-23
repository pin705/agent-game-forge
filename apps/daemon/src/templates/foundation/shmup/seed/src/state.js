var state = {
  mode: "loading",
  sceneId: null,
  level: null,
  time: 0,
  score: 0,
  scrollY: 0,
  camera: { shake: 0, shakeT: 0 },
  player: null,
  enemies: [],
  particles: [],
  floaters: [],
  tweens: [],
  trails: [],
  hitstop: 0,
  combo: 0,
  comboT: 0,
  waveTime: 0,
  waveIndex: 0,
  titleBlink: 0,
  error: null
};

function resetRunState() {
  state.time = 0; state.score = 0; state.scrollY = 0;
  state.camera.shake = 0; state.camera.shakeT = 0;
  state.enemies.length = 0;
  state.particles.length = 0; state.floaters.length = 0;
  state.tweens.length = 0; state.trails.length = 0;
  state.hitstop = 0; state.combo = 0; state.comboT = 0;
  state.waveTime = 0; state.waveIndex = 0;
}
