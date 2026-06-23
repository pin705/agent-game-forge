function updateXp(dt) {
  if (!xpPool || !state.player) return;
  var p = state.player;
  var orbs = xpPool.alive();
  for (var i = 0; i < orbs.length; i++) {
    var o = orbs[i];
    var dx = p.x - o.x, dy = p.y - o.y;
    var dist = Math.hypot(dx, dy);
    if (dist < 180) {
      var spd = 500 * dt;
      o.x += (dx / dist) * spd; o.y += (dy / dist) * spd;
    }
    if (dist < 20) {
      o.alive = false;
      p.xp = (p.xp || 0) + o.value;
      if (p.xp >= xpForNextLevel()) triggerLevelUp();
    }
  }
}

function xpForNextLevel() {
  return 20 + (state.player ? (state.player.level || 1) : 1) * 15;
}

function triggerLevelUp() {
  if (!state.player) return;
  state.player.level = (state.player.level || 1) + 1;
  state.player.xp = 0;
  state.mode = "levelup";
  state.upgradeCards = [
    { id: "speed",  nameKey: "up_speed_name", descKey: "up_speed_desc" },
    { id: "maxhp",  nameKey: "up_hp_name",    descKey: "up_hp_desc" },
    { id: "damage", nameKey: "up_dmg_name",   descKey: "up_dmg_desc" }
  ];
  tween(state, {}, 0.1, "outBack");
}

function applyUpgrade(card) {
  if (!state.player || !card) return;
  if (card.id === "speed")  state.player.speed += 30;
  if (card.id === "maxhp")  { state.player.maxHp += 5; state.player.hp += 5; }
  if (card.id === "damage") WEAPON_COOLDOWN = Math.max(0.4, WEAPON_COOLDOWN - 0.1);
  state.mode = "playing";
  state.upgradeCards = [];
}
