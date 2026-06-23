var VIEW = Object.freeze({ w: 1280, h: 720 });
var GAME = Object.freeze({ title: "Shadow Dungeon", startScene: "level_1", startMode: "title" });
var CELL_SIZE = 64;
var CELL_TYPES = Object.freeze({ EMPTY: 0, WALL: 1, FLOOR: 2, GOAL: 3, HAZARD: 4, SPAWN: 5 });
var COLORS = Object.freeze({
  ink: "#0d0d18",
  panel: "rgba(13,13,24,0.88)",
  text: "#d8d0c0",
  muted: "#706860",
  hp: "#d9362b",
  hpBack: "#391c1c",
  gold: "#e5b84a",
  wall: "#1e1c2e",
  wallEdge: "#2e2c3e",
  floor: "#24222e",
  floorEdge: "#34324e",
  goal: "#2fa66a",
  hazard: "#c84040",
  player: "#4af8c0",
  enemy: "#e84060",
  item: "#f0c040",
  spawn: "#304848"
});
