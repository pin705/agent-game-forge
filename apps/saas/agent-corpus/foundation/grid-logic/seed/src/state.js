const state = {
  mode: "loading",       // "loading" | "title" | "playing" | "won" | "complete"
  levels: [],            // ordered level-id registry from data/levels.json
  levelIndex: 0,
  level: null,           // pristine parsed level def (grid + entities + win/lose)
  entities: [],          // live entity objects (copied from level.entities, mutated)
  turnPhase: "waiting",  // "waiting" | "player" | "world" | "check" | "won"
  anim: [],              // active move-lerp animations; pipeline waits on it
  undoStack: [],         // snapshots, most-recent last (undo-stack.md)
  moveCount: 0,
  boxesOnGoal: 0,
  totalGoals: 0,

  // juice.js fields (see state contract in side-scroll seed)
  particles: [],
  floaters: [],   // juice.js — floating text
  tweens: [],     // juice.js — active property tweens
  trails: [],     // juice.js — motion ghosts
  hitstop: 0,     // juice.js — freeze-frame timer
  combo: 0,       // juice.js — current chain count
  comboT: 0,      // juice.js — combo reset timer

  camera: { shake: 0, shakeT: 0 },
  flash: 0,              // white win-flash alpha
  time: 0,
  titleBlink: 0,
  error: null
};

// Reset everything that changes during a single level's play.
function resetLevelState() {
  state.mode = "playing";
  state.turnPhase = "waiting";
  state.entities.length = 0;
  state.anim.length = 0;
  state.undoStack.length = 0;
  state.moveCount = 0;
  state.boxesOnGoal = 0;
  state.totalGoals = 0;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.tweens.length = 0;
  state.trails.length = 0;
  state.hitstop = 0;
  state.combo = 0;
  state.comboT = 0;
  state.camera.shake = 0;
  state.camera.shakeT = 0;
  state.flash = 0;
}
