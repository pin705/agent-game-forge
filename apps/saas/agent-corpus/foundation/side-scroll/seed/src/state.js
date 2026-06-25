const state = {
  mode: "loading",
  sceneId: null,
  level: null,
  camera: { x: 0, y: 0, lookahead: 0, snapY: 0, shake: 0, shakeT: 0 },
  time: 0,
  runTime: 0,
  score: 0,
  flags: {
    bossDefeated: false,
    warOrderCollected: false
  },
  player: null,
  enemies: [],
  projectiles: [],
  attacks: [],
  particles: [],
  floaters: [],   // juice.js — floating damage/pickup text
  tweens: [],     // juice.js — active property tweens
  trails: [],     // juice.js — motion ghosts
  hitstop: 0,     // juice.js — freeze-frame timer (gameplay dt → 0 while > 0)
  combo: 0,       // juice.js — current hit-chain count
  comboT: 0,      // juice.js — combo reset timer
  pickups: [],
  hazards: [],
  storyTriggers: {},
  checkpoint: null,
  lastCheckpointId: null,
  message: null,
  titleBlink: 0,
  endingText: "",
  error: null
};

function resetRunState() {
  state.mode = "playing";
  state.time = 0;
  state.runTime = 0;
  state.score = 0;
  state.flags.bossDefeated = false;
  state.flags.warOrderCollected = false;
  state.projectiles.length = 0;
  state.attacks.length = 0;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.tweens.length = 0;
  state.trails.length = 0;
  state.hitstop = 0;
  state.combo = 0;
  state.comboT = 0;
  state.storyTriggers = {};
  state.lastCheckpointId = null;
  state.message = null;
  state.endingText = "";
}
