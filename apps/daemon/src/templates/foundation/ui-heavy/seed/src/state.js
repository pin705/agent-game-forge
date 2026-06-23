const state = {
  mode: "loading",   // loading | title | playing | resolve | result | paused
  sceneId: null,
  screen: "title",   // title | map | battle | reward | gameover | win
  time: 0,
  camera: { shake: 0, shakeT: 0 },
  // Battle state
  player: null,
  enemy: null,
  hand: [],          // card objects currently in hand
  deck: [],          // draw pile (card ids)
  discard: [],       // discard pile (card ids)
  energy: 3,
  maxEnergy: 3,
  turn: "player",    // player | enemy | resolve
  resolveQueue: [],  // animations/effects queued
  battleOver: false,
  // Run state
  runScore: 0,
  floor: 1,
  // Cards catalog (loaded from data)
  cardDefs: [],
  enemies: [],       // enemy catalog
  // Juice
  particles: [],
  floaters: [],
  tweens: [],
  trails: [],
  hitstop: 0,
  combo: 0,
  comboT: 0,
  // UI
  hoveredCard: null,
  selectedCard: null,
  titleBlink: 0,
  error: null
};

function resetRunState() {
  state.floor = 1;
  state.runScore = 0;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.tweens.length = 0;
  state.trails.length = 0;
  state.hitstop = 0;
  state.combo = 0;
  state.comboT = 0;
}

function resetBattle() {
  state.hand.length = 0;
  state.deck.length = 0;
  state.discard.length = 0;
  state.energy = state.maxEnergy;
  state.turn = "player";
  state.battleOver = false;
  state.resolveQueue.length = 0;
  state.hoveredCard = null;
  state.selectedCard = null;
}
