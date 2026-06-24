// constants.js — VIEW + palette. Global-script style: no modules, top-level
// const shared via window. Mirrors side-scroll seed.
const VIEW = Object.freeze({ w: 1280, h: 720 });

const GAME = Object.freeze({
  title: "Guandu Pass",
  tagline: "Hold the road. Don't let them through.",
  startScene: "td_level",
  startMode: "title"
});

const COLORS = Object.freeze({
  ink: "#10130f",
  grass: "#1c2a1a",
  grassAlt: "#22321f",
  path: "#5a4632",
  pathEdge: "#3c2f22",
  grid: "rgba(255,255,255,0.05)",
  text: "#f2e7d0",
  muted: "#9fb08c",
  gold: "#e5b84a",
  hp: "#d9362b",
  hpBack: "#39201c",
  enemy: "#c8553d",
  brute: "#9b3b8f",
  boss: "#d94f4f",
  ok: "#6fcf6f",
  bad: "#d9362b"
});

// Reward / leak by enemy type (gold-on-kill, lives-on-leak).
const ENEMY_DEFS = Object.freeze({
  scout:   { reward: 5,  leak: 1, radius: 13, color: COLORS.enemy },
  brute:   { reward: 14, leak: 2, radius: 18, color: COLORS.brute },
  warlord: { reward: 150, leak: 10, radius: 30, color: COLORS.boss }
});
