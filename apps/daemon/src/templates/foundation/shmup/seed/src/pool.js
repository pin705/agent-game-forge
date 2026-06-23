function makePool(size, factory) {
  var items = [];
  for (var i = 0; i < size; i++) items.push(factory());
  return {
    items: items,
    get: function() { for (var i = 0; i < items.length; i++) { if (!items[i].alive) return items[i]; } return null; },
    alive: function() { return items.filter(function(x) { return x.alive; }); }
  };
}
var _playerBullets = null;
var _enemyBullets  = null;
function initPools() {
  _playerBullets = makePool(200, function() { return { alive: false, x: 0, y: 0, vy: -600, dmg: 1, w: 6, h: 14 }; });
  _enemyBullets  = makePool(400, function() { return { alive: false, x: 0, y: 0, vx: 0, vy: 220, dmg: 1, w: 8, h: 8 }; });
}
