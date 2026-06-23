# Ink & Iron — UI-Heavy Card Battler Seed

A Slay-the-Spire-style card battler foundation for the OGF game studio.

## Architecture

- Vanilla Canvas 2D, no framework, no ES modules
- Global-script style: all files share one scope, loaded via `<script src>` in order
- Canvas 1280x720, everything drawn with `ctx` — no DOM gameplay manipulation

## Game Systems

### Deck / Hand / Discard Cycle
Cards begin in `state.deck` (shuffled). Each turn, 5 cards are drawn to `state.hand`. Played cards go to `state.discard`. When the deck is empty, the discard is reshuffled into the draw pile.

### Energy System
Player has `state.energy` (default 3) per turn. Each card costs energy to play. Energy resets at the start of each turn.

### Turn Order
1. Player draws 5 cards, spends energy to play them
2. Player clicks "End Turn"
3. Enemy attacks (resolved immediately in this seed)
4. Player block resets, new hand drawn, energy restored

### Card Types
- `attack` — deals damage to enemy, reduced by enemy block
- `block` — adds shield to player (absorbs incoming damage)
- `heal` — restores player HP

### Battle Result
- Enemy HP reaches 0 → Victory screen, score +100
- Player HP reaches 0 → Defeat screen

## File Load Order
1. constants.js — VIEW, GAME, COLORS, CARD_W/H
2. dom.js — canvas/ctx refs
3. state.js — global mutable state
4. input.js — keyboard + gamepad
5. audio.js — Web Audio tone synth
6. particles.js — spark system + screenshake
7. juice.js — tweens, floaters, hitstop, combo, trails
8. cards.js — card defs, deck management
9. battle.js — turn logic, card effects
10. screens.js — click region registry, hover detection
11. hud.js — HP bar, energy, deck counts
12. render.js — all drawing functions
13. game.js — boot, frame loop, global input

## Data Files
- `data/cards.json` — card definitions (loaded at boot, falls back to BUILTIN_CARDS)
- `data/enemies.json` — enemy definitions (loaded at boot, falls back to inline defaults)
