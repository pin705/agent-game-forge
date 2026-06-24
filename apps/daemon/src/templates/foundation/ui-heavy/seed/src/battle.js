function startBattle(enemyId) {
  resetBattle();
  const enc = getEncounter();
  const ps = enc.player || { hp: 30, maxHp: 30, startingEnergy: 3, handSize: 5 };
  state.maxEnergy = ps.startingEnergy || 3;
  state.handSize = ps.handSize || 5;
  state.player = { hp: ps.hp, maxHp: ps.maxHp, block: 0, color: COLORS.playerColor };
  const def = findEnemyDef(enemyId);
  state.enemy = {
    id: def.id, name: def.name, hp: def.hp, maxHp: def.maxHp,
    color: def.color || COLORS.enemyColor, block: 0,
    moves: (def.moves && def.moves.length) ? def.moves : [{ action: "attack", value: 5 }],
    moveIdx: 0,
    intent: null
  };
  state.enemy.intent = computeIntent(state.enemy);
  state.deck = shuffleDeck(buildStarterDeck());
  drawCards(state.handSize);
  state.energy = state.maxEnergy;
  state.turn = "player";
  state.battleOver = false;
  state.screen = "battle";
}

// Scripted-intent telegraph: cycle through the enemy's move list (OpenGame
// EnemyBattleConfig pattern) so the player can SEE the next action and plan blocks.
function computeIntent(enemy) {
  const moves = enemy.moves || [{ action: "attack", value: 5 }];
  return moves[enemy.moveIdx % moves.length];
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
  // Play flourish: the card name rises + fades from where the card sat (juice.md).
  if (idx !== -1) {
    const r = cardRect(idx, state.hand.length);
    floater(card.name, r.x + CARD_W / 2, r.y, { color: cardColor(card.type), size: 16, vy: -70, life: 0.7 });
    burstParticles(r.x + CARD_W / 2, r.y + 20, 6, cardColor(card.type));
  }
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
      e.hp = 0;
      // Death juice: a big burst + heavier freeze-frame on the kill.
      hitstop(0.14);
      screenshake(10, 0.25);
      burstParticles(850, 270, 28, e.color || COLORS.enemyColor);
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
  const intent = e.intent || { action: "attack", value: 5 };

  if (intent.action === "attack") {
    const dmg = Math.max(0, intent.value - (p.block || 0));
    p.block = Math.max(0, (p.block || 0) - intent.value);
    p.hp -= dmg;
    hitstop(0.08);
    screenshake(5, 0.12);
    floater('-' + dmg, 400, 260, { color: COLORS.hp, size: 22 });
    burstParticles(400, 300, 5, COLORS.hp);
    playSfx("hit");
    if (p.hp <= 0) {
      p.hp = 0;
      hitstop(0.14);
      screenshake(10, 0.25);
      burstParticles(400, 240, 28, COLORS.hp);
      state.mode = "gameover";
      state.screen = "gameover";
      state.battleOver = true;
      return;
    }
  } else if (intent.action === "block") {
    e.block = (e.block || 0) + intent.value;
    floater('+' + intent.value + ' block', 850, 260, { color: COLORS.block, size: 18 });
    playSfx("block");
  }

  // Advance to next scripted move + telegraph it; reset player block, refill, redraw.
  e.moveIdx = (e.moveIdx || 0) + 1;
  e.intent = computeIntent(e);
  p.block = 0;
  state.energy = state.maxEnergy;
  drawCards(state.handSize || 5);
  state.turn = "player";
}
