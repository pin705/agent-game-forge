var _enemyId = 0;

var ENEMY_STATS = {
  scout: { hp: 3,  maxHp: 3,  speed: 90, reward: 10, color: "#c84040", w: 24, h: 24 },
  heavy: { hp: 12, maxHp: 12, speed: 45, reward: 30, color: "#c06080", w: 36, h: 36 }
};

function spawnEnemy(kind) {
  var s = ENEMY_STATS[kind] || ENEMY_STATS.scout;
  state.enemies.push({
    id: "e" + (++_enemyId),
    alive: true,
    kind: kind,
    t: 0,
    x: 0, y: 0,
    hp: s.hp, maxHp: s.maxHp,
    speed: s.speed, reward: s.reward,
    color: s.color, w: s.w, h: s.h
  });
}

function updateEnemies(dt) {
  var path = getMainPath();
  if (!path) return;
  for (var i = 0; i < state.enemies.length; i++) {
    var e = state.enemies[i];
    if (!e.alive) continue;
    e.t += (e.speed * dt) / path.totalLength;
    var pos = pointOnPath(path, e.t);
    e.x = pos.x - e.w / 2;
    e.y = pos.y - e.h / 2;
    if (e.t >= 1) {
      e.alive = false;
      state.lives -= 1;
      screenshake(4, 0.1);
      if (state.lives <= 0) { state.mode = "gameover"; }
    }
  }
  for (var j = state.enemies.length - 1; j >= 0; j--) {
    if (!state.enemies[j].alive) state.enemies.splice(j, 1);
  }
}
