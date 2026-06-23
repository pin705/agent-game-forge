function pushHistory() {
  var snap = {
    playerGridX: state.player ? state.player.gridX : 0,
    playerGridY: state.player ? state.player.gridY : 0,
    playerHp: state.player ? state.player.hp : 0,
    entities: state.entities.map(function(e) {
      return { id: e.id, gridX: e.gridX, gridY: e.gridY, hp: e.hp, alive: e.alive };
    }),
    grid: state.grid.map(function(r) { return r.slice(); }),
    moves: state.moves,
    turn: state.turn,
    score: state.score
  };
  state.history.push(snap);
  if (state.history.length > 60) state.history.shift();
}

function undo() {
  if (state.history.length === 0 || state.mode !== "playing") return;
  var snap = state.history.pop();
  if (state.player) {
    state.player.gridX = snap.playerGridX;
    state.player.gridY = snap.playerGridY;
    state.player.hp = snap.playerHp;
  }
  for (var i = 0; i < snap.entities.length; i++) {
    var saved = snap.entities[i];
    for (var j = 0; j < state.entities.length; j++) {
      if (state.entities[j].id === saved.id) {
        state.entities[j].gridX = saved.gridX;
        state.entities[j].gridY = saved.gridY;
        state.entities[j].hp = saved.hp;
        state.entities[j].alive = saved.alive;
        break;
      }
    }
  }
  state.grid = snap.grid.map(function(r) { return r.slice(); });
  state.moves = snap.moves;
  state.turn = snap.turn;
  state.score = snap.score;
  syncDisplayPositions();
  screenshake(2, 0.05);
}
