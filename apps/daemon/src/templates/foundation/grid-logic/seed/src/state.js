var state = {
  mode: "loading",
  sceneId: null,
  level: null,
  grid: [],
  entities: [],
  player: null,
  particles: [],
  floaters: [],
  tweens: [],
  trails: [],
  hitstop: 0,
  combo: 0,
  comboT: 0,
  turn: 0,
  moves: 0,
  score: 0,
  history: [],
  camera: { x: 0, y: 0, shake: 0, shakeT: 0 },
  titleBlink: 0,
  time: 0,
  error: null
};

function resetRunState() {
  state.entities.length = 0;
  state.player = null;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.tweens.length = 0;
  state.trails.length = 0;
  state.hitstop = 0;
  state.combo = 0;
  state.comboT = 0;
  state.turn = 0;
  state.moves = 0;
  state.score = 0;
  state.history.length = 0;
  state.camera.x = 0; state.camera.y = 0; state.camera.shake = 0; state.camera.shakeT = 0;
}
