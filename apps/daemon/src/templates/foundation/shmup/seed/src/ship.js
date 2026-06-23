function createPlayer() {
  return {
    x: PLAY_X + PLAY_W/2 - 20, y: PLAYER_BOUNDS.y + PLAYER_BOUNDS.h - 60,
    w: 40, h: 40, hp: 5, maxHp: 5, lives: 3, speed: 320,
    shootTimer: 0, shootCooldown: 0.18, invuln: 0
  };
}

function updateShip(dt) {
  var p = state.player;
  if (!p) return;
  // Movement
  var dx = 0, dy = 0;
  if (isHeld("left"))  dx -= 1;
  if (isHeld("right")) dx += 1;
  if (isHeld("up"))    dy -= 1;
  if (isHeld("down"))  dy += 1;
  p.x = Math.max(PLAYER_BOUNDS.x, Math.min(PLAYER_BOUNDS.x + PLAYER_BOUNDS.w - p.w, p.x + dx * p.speed * dt));
  p.y = Math.max(PLAYER_BOUNDS.y, Math.min(PLAYER_BOUNDS.y + PLAYER_BOUNDS.h - p.h, p.y + dy * p.speed * dt));
  // Auto-fire
  p.shootTimer -= dt;
  if (p.shootTimer <= 0) {
    p.shootTimer = p.shootCooldown;
    if (_playerBullets) {
      var b = _playerBullets.get();
      if (b) { b.alive = true; b.x = p.x + p.w/2 - 3; b.y = p.y - 10; b.vy = -600; b.dmg = 1; }
    }
  }
  if (p.invuln > 0) p.invuln -= dt;
}

function damagePlayer(amount) {
  var p = state.player;
  if (!p || p.invuln > 0) return;
  p.hp -= amount;
  p.invuln = 1.5;
  screenshake(5, 0.15);
  floater("-" + amount, p.x + p.w/2, p.y, { color: "#d93" });
  if (p.hp <= 0) state.mode = "gameover";
}
