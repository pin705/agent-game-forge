// state.js — global mutable singleton. Loaded after constants, before all
// subsystems + juice.js. Mirrors side-scroll seed (global `const state` + reset).
const state = {
  mode: "loading",         // loading | title | playing | win | gameover
  config: null,            // td-config.json
  time: 0,
  titleBlink: 0,

  // economy
  gold: 0,
  lives: 0,
  outcome: null,           // null | "win" | "lose"

  // world
  grid: { cellSize: 64, cols: 20, rows: 11 },
  path: null,              // buildPath() result (points, segLengths, totalLength)
  occupied: {},            // "col,row" -> true  (cells with towers)

  // entities
  enemies: [],
  towers: [],
  projectiles: [],
  particles: [],
  enemySeq: 0,
  towerSeq: 0,

  // wave manager
  wave: null,

  // build / input
  selectedTowerType: 0,    // index into config.towers
  hover: null,             // { col, row, cx, cy, valid }

  // camera (for screenshake — particles.js reads state.camera.shake/shakeT)
  camera: { x: 0, y: 0, shake: 0, shakeT: 0 },

  // juice.js fields
  floaters: [],
  tweens: [],
  trails: [],
  hitstop: 0,
  combo: 0,
  comboT: 0,

  flash: 0,                // life-lost full-screen red flash (0..1)
  error: null
};

function resetRunState() {
  state.mode = "playing";
  state.time = 0;
  state.outcome = null;
  state.enemies.length = 0;
  state.towers.length = 0;
  state.projectiles.length = 0;
  state.particles.length = 0;
  state.enemySeq = 0;
  state.towerSeq = 0;
  state.occupied = {};
  state.selectedTowerType = 0;
  state.hover = null;
  state.camera.shake = 0;
  state.camera.shakeT = 0;
  state.floaters.length = 0;
  state.tweens.length = 0;
  state.trails.length = 0;
  state.hitstop = 0;
  state.combo = 0;
  state.comboT = 0;
  state.flash = 0;
  // re-derive economy + wave timeline from config
  initEconomy(state.config);
  state.path = buildPath(state.config.path);
  initWaves(state.config);
}
