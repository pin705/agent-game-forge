const VIEW = Object.freeze({ w: 1280, h: 720 });

const GAME = Object.freeze({
  title: "Crate Logic",
  tagline: "Push every crate onto a goal",
  startMode: "title"
});

// Canonical cell-type ints (genres/grid-logic.md §"Cell types") — keep stable.
const EMPTY = 0, WALL = 1, FLOOR = 2, GOAL = 3, HAZARD = 4, SPAWN = 5;

const DIRS = Object.freeze({
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
});

const COLORS = Object.freeze({
  ink: "#0e1320",
  bgTop: "#1a2336",
  bgBottom: "#0b101b",
  text: "#e7eefc",
  muted: "#8ea0c4",
  gold: "#e7c14a",
  jade: "#46c08a",
  wall: "#2f3a55",
  wallTop: "#43526f",
  floorA: "#1b2541",
  floorB: "#161e36",
  grid: "rgba(255,255,255,0.07)",
  goal: "#e7c14a",
  goalDone: "#46c08a",
  hazard: "#d9483b",
  player: "#5fb0ff",
  playerEdge: "#2e6fb0",
  box: "#c98a4b",
  boxTop: "#e0a766",
  boxDone: "#46c08a",
  boxDoneTop: "#6fe0aa",
  panel: "rgba(10, 14, 24, 0.80)",
  panelEdge: "#37456a"
});

// Tuning baked in (asset-free seed — no external config files needed).
const TUNE = Object.freeze({
  cellSize: 64,
  animationSpeed: 0.13, // move-lerp seconds; the pipeline waits on it
  maxUndoSteps: 200
});
