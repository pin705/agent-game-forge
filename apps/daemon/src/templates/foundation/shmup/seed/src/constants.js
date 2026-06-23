var VIEW = Object.freeze({ w: 1280, h: 720 });
var PLAY_W = 720;  // shmup play area width, centered in 1280
var PLAY_X = (1280 - 720) / 2;  // x offset = 280
var GAME = Object.freeze({ title: "Thunder Wing", startScene: "stage_1", startMode: "title" });
var COLORS = Object.freeze({
  ink: "#050a14", panel: "rgba(5,10,20,0.85)", text: "#d8e8f8", muted: "#708090",
  hp: "#d9362b", hpBack: "#391c1c", gold: "#e5c84a",
  playerColor: "#4af8ef", enemyColor: "#e84040", bulletPlayer: "#ffffff", bulletEnemy: "#ff6020",
  bgColor: "#050a14", bgSide: "#080c18"
});
// Player movement bounds within the play area
var PLAYER_BOUNDS = Object.freeze({ x: PLAY_X + 20, y: 350, w: PLAY_W - 40, h: 340 });
