const state = {
  mode: "loading",
  sceneId: null,
  level: null,
  time: 0,
  camera: { shake: 0, shakeT: 0 },
  towers: [],
  enemies: [],
  projectiles: [],
  particles: [],
  floaters: [],
  tweens: [],
  trails: [],
  hitstop: 0,
  combo: 0,
  comboT: 0,
  gold: 150,
  lives: 20,
  wave: 0,
  waveActive: false,
  waveTimer: 5,
  selectedTowerType: "archer",
  cursor: { x: 0, y: 0 },
  titleBlink: 0,
  error: null
};

function resetRunState() {
  state.towers.length = 0;
  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.tweens.length = 0;
  state.trails.length = 0;
  state.hitstop = 0;
  state.combo = 0;
  state.comboT = 0;
  state.gold = 150;
  state.lives = 20;
  state.wave = 0;
  state.waveActive = false;
  state.waveTimer = 5;
  state.time = 0;
}
