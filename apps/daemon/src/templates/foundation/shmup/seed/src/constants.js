const VIEW = Object.freeze({ w: 1280, h: 720 });

const GAME = Object.freeze({
  title: "STARLANCE",
  tagline: "Hold the line. Clear the swarm.",
  startMode: "title"
});

// Vertical-scroll shmup palette. Asset-free: every sprite is a Canvas2D primitive.
const COLORS = Object.freeze({
  ink: "#05060f",
  inkLow: "#0c1230",
  text: "#e8f0ff",
  muted: "#8aa0c8",
  gold: "#ffd45a",
  ship: "#5be0ff",
  shipEdge: "#bff6ff",
  thrust: "#ff8a3c",
  playerBullet: "#bdfcff",
  enemy: "#ff5d73",
  enemyEdge: "#ffb3bf",
  enemyAlt: "#c77dff",
  enemyBullet: "#ff9d57",
  star: "#cfe0ff",
  hp: "#ff4d6d",
  shake: "#ffffff"
});

// Helper used widely; mirrors side-scroll seed's clamp.
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
