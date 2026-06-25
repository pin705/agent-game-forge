function updateXp(dt) {
  if (!xpPool || !state.player) return;
  var p = state.player;
  var xc = CONFIG.xp;
  var orbs = xpPool.alive();
  for (var i = 0; i < orbs.length; i++) {
    var o = orbs[i];
    var dx = p.x - o.x, dy = p.y - o.y;
    var dist = Math.hypot(dx, dy) || 1;
    if (dist < xc.magnetRadius) {                 // magnet pull (arena-survivor.md)
      var spd = xc.magnetSpeed * dt;
      o.x += (dx / dist) * spd; o.y += (dy / dist) * spd;
    }
    if (dist < xc.collectRadius) {
      o.alive = false;
      p.xp = (p.xp || 0) + o.value;
      playSfx("xp");
      var sx = o.x - state.camera.x + VIEW.w / 2;
      floater("+" + o.value, sx, o.y - state.camera.y + VIEW.h / 2, { color: "#7CFC00", size: 14 });
      if (p.xp >= xpForNextLevel()) triggerLevelUp();
    }
  }
}

function xpForNextLevel() {
  var xc = CONFIG ? CONFIG.xp : { base: 20, perLevel: 15 };
  return xc.base + (state.player ? (state.player.level || 1) : 1) * xc.perLevel;
}

function triggerLevelUp() {
  if (!state.player) return;
  state.player.level = (state.player.level || 1) + 1;
  state.player.xp = 0;
  // Level-up juice (juice.md): brief hit-stop + "LEVEL UP" floater + flash burst.
  hitstop(0.12);
  screenshake(5, 0.18);
  floater(t("levelUp"), VIEW.w / 2, VIEW.h / 2 - 60, { color: COLORS.gold, size: 28, vy: -20, life: 1.1 });
  burstParticles(VIEW.w / 2, VIEW.h / 2, 24, COLORS.gold);
  state.mode = "levelup";
  state.upgradeCards = [
    { id: "speed",  nameKey: "up_speed_name", descKey: "up_speed_desc" },
    { id: "maxhp",  nameKey: "up_hp_name",    descKey: "up_hp_desc" },
    { id: "damage", nameKey: "up_dmg_name",   descKey: "up_dmg_desc" }
  ];
}

function applyUpgrade(card) {
  if (!state.player || !card) return;
  if (card.id === "speed")  state.player.speed += 30;
  if (card.id === "maxhp")  { state.player.maxHp += 5; state.player.hp += 5; }
  if (card.id === "damage") WEAPON_COOLDOWN = Math.max(0.4, WEAPON_COOLDOWN - 0.1);
  state.mode = "playing";
  state.upgradeCards = [];
}
