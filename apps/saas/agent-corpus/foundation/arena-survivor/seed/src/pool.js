function makePool(size, factory) {
  const items = Array.from({ length: size }, factory);
  return {
    items: items,
    get: function() { for (var i = 0; i < items.length; i++) { if (!items[i].alive) return items[i]; } return null; },
    alive: function() { return items.filter(function(i) { return i.alive; }); }
  };
}
var enemyPool = null;
var projectilePool = null;
var xpPool = null;
function initPools() {
  enemyPool = makePool(300, function() { return { alive: false, x: 0, y: 0, w: 28, h: 28, hp: 1, maxHp: 1, speed: 80, color: "#c44", kind: "bat", hurtTimer: 0 }; });
  projectilePool = makePool(200, function() { return { alive: false, x: 0, y: 0, vx: 0, vy: 0, damage: 5, ttl: 2, w: 8, h: 8, color: "#4af" }; });
  xpPool = makePool(200, function() { return { alive: false, x: 0, y: 0, value: 1, w: 10, h: 10 }; });
}
