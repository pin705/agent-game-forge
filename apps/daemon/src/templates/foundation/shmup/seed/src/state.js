const state = {
  mode: "loading",
  time: 0,
  titleBlink: 0,
  scroll: 0,            // monotonic backdrop scroll distance (scrolling-bg recipe)

  score: 0,
  lives: 3,
  wave: 0,              // 1-based current wave index (0 = none yet)

  player: null,
  enemies: [],          // live pooled enemies
  playerBullets: [],    // live pooled player shots
  enemyBullets: [],     // live pooled enemy shots
  stars: [],            // pooled parallax starfield dots

  // camera holds only shake here (no follow — autoscroll genre). particles.js
  // ticks shakeT and zeroes shake; render.js applies the offset.
  camera: { shake: 0, shakeT: 0 },

  // --- juice.js fields (mandated by conventions/juice.md) ---
  particles: [],
  floaters: [],   // floating score/text
  tweens: [],     // active property tweens
  trails: [],     // motion ghosts
  hitstop: 0,     // freeze-frame timer (gameplay dt → 0 while > 0)
  combo: 0,       // current hit-chain count
  comboT: 0,      // combo reset timer

  error: null
};

function resetRunState() {
  state.mode = "playing";
  state.time = 0;
  state.scroll = 0;
  state.score = 0;
  state.lives = cfg("player").lives ?? 3;
  state.wave = 0;
  state.enemies.length = 0;
  state.playerBullets.length = 0;
  state.enemyBullets.length = 0;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.tweens.length = 0;
  state.trails.length = 0;
  state.hitstop = 0;
  state.combo = 0;
  state.comboT = 0;
  state.camera.shake = 0;
  state.camera.shakeT = 0;
}
