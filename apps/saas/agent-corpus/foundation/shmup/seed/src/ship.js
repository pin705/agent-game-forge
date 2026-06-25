// Player ship — 4-dir movement clamped to a sub-rectangle, fixed upward auto-fire,
// lives + i-frames on hit. Tuning from data/shmup-config.json `player`.
function createPlayer() {
  const c = cfg("player");
  return {
    x: VIEW.w / 2,
    y: VIEW.h - 120,
    w: c.size ?? 40,
    h: c.size ?? 40,
    speed: c.speed ?? 420,
    hitboxR: c.hitboxR ?? 7,   // tiny center hitbox → grazing feel (bullet-patterns recipe)
    fireCooldown: c.fireCooldown ?? 0.14,
    fireTimer: 0,
    invuln: 0
  };
}

function playerBounds() {
  const b = cfg("player").bounds || {};
  return {
    x: b.x ?? 40,
    y: b.y ?? 80,
    w: b.w ?? (VIEW.w - 80),
    h: b.h ?? (VIEW.h - 120)
  };
}

function updateShip(dt) {
  const p = state.player;
  if (!p) return;
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);

  const ax = clamp(input.actions.ax || 0, -1, 1);
  const ay = clamp(input.actions.ay || 0, -1, 1);
  p.x += ax * p.speed * dt;
  p.y += ay * p.speed * dt;

  const b = playerBounds();
  p.x = clamp(p.x, b.x, b.x + b.w);
  p.y = clamp(p.y, b.y, b.y + b.h);

  // auto-fire upward on cooldown (also fires while holding fire — same path)
  p.fireTimer -= dt;
  if (p.fireTimer <= 0) {
    p.fireTimer = p.fireCooldown;
    const def = bulletDef("player_main");
    emit("player", def, p.x, p.y - p.h / 2, { x: 0, y: -1 });
  }
}

function damagePlayer() {
  const p = state.player;
  if (!p || p.invuln > 0) return;
  state.lives -= 1;
  p.invuln = cfg("player").iframes ?? 1.6;
  // juice: shake + freeze-frame + a hot flash burst (conventions/juice.md player-hit)
  screenshake(16, 0.4);
  hitstop(0.12);
  burstParticles(p.x, p.y, 22, COLORS.ship);
  floater("-1", p.x, p.y - 30, { color: COLORS.hp, size: 24 });
  state.combo = 0;
  if (state.lives <= 0) {
    state.lives = 0;
    state.mode = "gameover";
  }
}
