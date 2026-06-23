function startBattle(enemyId) {
  resetBattle();
  state.player = { hp: 30, maxHp: 30, block: 0, color: COLORS.playerColor };
  const enemyDef = (state.enemies || []).find(function(e) { return e.id === enemyId; }) || { id: "slime", name: "Slime", hp: 20, maxHp: 20, damage: 5, color: COLORS.enemyColor };
  state.enemy = { id: enemyDef.id, name: enemyDef.name, hp: enemyDef.hp, maxHp: enemyDef.maxHp, damage: enemyDef.damage, color: enemyDef.color, block: 0, intent: computeIntent(enemyDef) };
  state.deck = shuffleDeck(buildStarterDeck());
  drawCards(5);
  state.energy = state.maxEnergy;
  state.turn = "player";
  state.battleOver = false;
  state.screen = "battle";
}

function computeIntent(enemyDef) {
  return { action: "attack", value: enemyDef.damage || 5 };
}

function playCard(card) {
  if (!card || state.turn !== "player") return;
  if (card.cost > state.energy) {
    tween(state.camera, { shake: 2 }, 0.06);
    return;
  }
  state.energy -= card.cost;
  // Remove from hand
  const idx = state.hand.indexOf(card);
  if (idx !== -1) state.hand.splice(idx, 1);
  state.discard.push(card.id);

  const e = state.enemy;
  const p = state.player;

  // Apply effect
  if (card.type === "attack") {
    const dmg = Math.max(0, card.value - (e.block || 0));
    e.block = Math.max(0, (e.block || 0) - card.value);
    e.hp -= dmg;
    hitstop(0.06);
    bumpCombo();
    floater('-' + dmg, 860, 280, { color: '#ffd23f', size: 22 });
    screenshake(4 * comboMul(), 0.1);
    burstParticles(860, 300, 6, COLORS.enemyColor);
    playSfx("hit");
    if (e.hp <= 0) {
      state.battleOver = true;
      state.mode = "result";
      tween(state, { runScore: state.runScore + 100 }, 0.5, "outBack");
      return;
    }
  } else if (card.type === "block") {
    p.block = (p.block || 0) + card.value;
    floater('+' + card.value + ' block', 400, 280, { color: COLORS.block, size: 18 });
    tween(state.camera, { shake: 1 }, 0.05);
    playSfx("block");
  } else if (card.type === "heal") {
    const healed = Math.min(card.value, p.maxHp - p.hp);
    p.hp = Math.min(p.maxHp, p.hp + card.value);
    floater('+' + healed + ' HP', 400, 280, { color: '#7CFC00', size: 20 });
    playSfx("heal");
  }
  state.selectedCard = null;
}

function endPlayerTurn() {
  if (state.turn !== "player" || state.battleOver) return;
  discardHand();
  state.turn = "enemy";
  // Enemy acts after a short delay (we resolve immediately in this seed)
  resolveEnemyTurn();
}

function resolveEnemyTurn() {
  const e = state.enemy;
  const p = state.player;
  const intent = e.intent;

  if (intent.action === "attack") {
    const dmg = Math.max(0, intent.value - (p.block || 0));
    p.block = Math.max(0, (p.block || 0) - intent.value);
    p.hp -= dmg;
    hitstop(0.08);
    screenshake(5, 0.12);
    floater('-' + dmg, 400, 260, { color: COLORS.hp, size: 22 });
    burstParticles(400, 300, 5, COLORS.hp);
    if (p.hp <= 0) {
      state.mode = "gameover";
      state.screen = "gameover";
      state.battleOver = true;
      return;
    }
  }

  // Reset block, draw new hand, restore energy
  p.block = 0;
  e.block = 0;
  e.intent = computeIntent(e);
  state.energy = state.maxEnergy;
  drawCards(5);
  state.turn = "player";
}
