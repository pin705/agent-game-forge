// economy.js — gold / lives / win-loss. Single source of truth for the meta
// loop. (recipes/economy.md). Shares global `state`.
function initEconomy(cfg) {
  state.gold = cfg.startingGold;
  state.lives = cfg.startingLives;
  state.outcome = null;
}

function canAfford(cost) { return state.gold >= cost; }

function spendGold(amount) {
  if (amount <= 0) return true;
  if (state.gold < amount) return false; // caller must respect this
  state.gold -= amount;
  return true;
}

function earnGold(amount) {
  if (amount <= 0) return;
  state.gold += amount;
}

function loseLives(n) {
  if (state.outcome) return;
  state.lives -= n;
  // JUICE: life lost → shake + red flash
  screenshake(8, 0.18);
  state.flash = 1;
  if (state.lives <= 0) {
    state.lives = 0;
    loseGame();
  }
}

function loseGame() {
  if (state.outcome) return;
  state.outcome = "lose";
  state.mode = "gameover";
}

function winGame() {
  if (state.outcome) return; // a leak on the final enemy could lose first
  state.outcome = "win";
  state.mode = "win";
}
