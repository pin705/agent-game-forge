// Card definitions (also loaded from data/cards.json at runtime)
const BUILTIN_CARDS = [
  { id: "strike",    name: "Strike",    type: "attack", cost: 1, value: 6,   text: "Deal 6 damage." },
  { id: "defend",    name: "Defend",    type: "block",  cost: 1, value: 5,   text: "Gain 5 block." },
  { id: "bash",      name: "Bash",      type: "attack", cost: 2, value: 8,   text: "Deal 8 damage. Stun." },
  { id: "first_aid", name: "First Aid", type: "heal",   cost: 1, value: 5,   text: "Heal 5 HP." },
  { id: "whirlwind", name: "Whirlwind", type: "attack", cost: 2, value: 4,   text: "Deal 4x2 hits." },
  { id: "armor",     name: "Iron Shell",type: "block",  cost: 1, value: 8,   text: "Gain 8 block." }
];

// Build starting deck: 4× strike + 4× defend + 1× first_aid
function buildStarterDeck() {
  return ["strike","strike","strike","strike","defend","defend","defend","defend","first_aid"];
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

function drawCards(n) {
  for (let i = 0; i < n; i++) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break;
      state.deck.push.apply(state.deck, state.discard.splice(0));
      shuffleDeck(state.deck);
    }
    const id = state.deck.pop();
    const def = getCardDef(id);
    if (def) state.hand.push({ id: def.id, name: def.name, type: def.type, cost: def.cost, value: def.value, text: def.text, uid: id + '_' + state.time.toFixed(3) });
  }
}

function getCardDef(id) {
  const fromData = (state.cardDefs || []).find(function(c) { return c.id === id; });
  return fromData || BUILTIN_CARDS.find(function(c) { return c.id === id; }) || null;
}

function discardHand() {
  for (let i = 0; i < state.hand.length; i++) {
    state.discard.push(state.hand[i].id);
  }
  state.hand.length = 0;
}

function cardColor(type) {
  if (type === "attack") return COLORS.cardAttack;
  if (type === "block") return COLORS.cardBlock;
  if (type === "heal") return COLORS.cardHeal;
  return COLORS.cardEdge;
}

// Card rect for hit-testing
function cardRect(index, total) {
  const spacing = Math.min(CARD_W + 12, (VIEW.w - 80) / Math.max(1, total));
  const totalW = (total - 1) * spacing + CARD_W;
  const startX = (VIEW.w - totalW) / 2;
  return { x: startX + index * spacing, y: HAND_Y, w: CARD_W, h: CARD_H };
}
