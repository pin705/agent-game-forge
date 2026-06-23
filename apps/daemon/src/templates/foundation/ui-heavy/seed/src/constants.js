const VIEW = Object.freeze({ w: 1280, h: 720 });
const GAME = Object.freeze({
  title: "Ink & Iron",
  startMode: "title"
});
const COLORS = Object.freeze({
  ink: "#0d1018",
  panel: "rgba(13, 16, 24, 0.92)",
  panelEdge: "#2a3050",
  text: "#e0d8c8",
  muted: "#707888",
  hp: "#d9362b",
  hpBack: "#391c1c",
  block: "#4888c8",
  blockBg: "#1c2848",
  gold: "#e5c84a",
  cardBg: "#18202e",
  cardEdge: "#303848",
  cardHighlight: "#3870c0",
  cardAttack: "#c84848",
  cardBlock: "#4888c8",
  cardHeal: "#48c870",
  playerColor: "#4af8c0",
  enemyColor: "#e84060",
  energyColor: "#f0a830"
});
const CARD_W = 140, CARD_H = 200;
const HAND_Y = VIEW.h - CARD_H - 20;
