const VIEW = Object.freeze({ w: 1280, h: 720 });
const GAME = Object.freeze({ title: "Iron Bastion", startScene: "guandu_pass", startMode: "title" });
const COLORS = Object.freeze({
  ink: "#101820",
  panel: "rgba(16, 24, 32, 0.88)",
  text: "#e0d8c0",
  muted: "#788060",
  hp: "#d9362b",
  hpBack: "#391c1c",
  gold: "#e5b84a",
  path: "#5c4830",
  pathEdge: "#7c6848",
  grass: "#2a3c20",
  tower: "#4a6888",
  towerRange: "rgba(74, 104, 136, 0.15)",
  enemy: "#c84040",
  bullet: "#fff080",
  buildHighlight: "rgba(100, 200, 100, 0.3)",
  buildInvalid: "rgba(200, 50, 50, 0.3)"
});

const TOWER_TYPES = Object.freeze({
  archer: { cost: 60, damage: 2, range: 180, cooldown: 1.0, color: "#4a6888", label: "Archer $60" },
  cannon: { cost: 120, damage: 8, range: 140, cooldown: 2.5, color: "#885040", label: "Cannon $120" }
});
