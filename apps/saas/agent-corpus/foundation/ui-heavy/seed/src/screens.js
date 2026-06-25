const _clickRegions = [];

function registerClickRegion(id, x, y, w, h, callback) {
  _clickRegions.push({ id: id, x: x, y: y, w: w, h: h, callback: callback });
}

function clearClickRegions() { _clickRegions.length = 0; }

function handleCanvasClick(mx, my) {
  for (let i = 0; i < _clickRegions.length; i++) {
    const r = _clickRegions[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      r.callback();
      return;
    }
  }
  // Fallback: clicked on a card?
  if (state.turn === "player" && state.screen === "battle") {
    for (let i = 0; i < state.hand.length; i++) {
      const r = cardRect(i, state.hand.length);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        playCard(state.hand[i]);
        return;
      }
    }
  }
}

function handleCanvasHover(mx, my) {
  state.hoveredCard = null;
  if (state.screen !== "battle") return;
  for (let i = 0; i < state.hand.length; i++) {
    const r = cardRect(i, state.hand.length);
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      state.hoveredCard = i;
      return;
    }
  }
}
