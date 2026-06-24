# Ink & Iron — UI-Heavy Card Battler Seed

A Slay-the-Spire-lite card battler that boots straight to a playable, juicy loop with zero external assets (everything is Canvas2D primitives — cards are rounded rects, HP/energy are bars). Title → battle: spend energy to play attack/block/heal cards against one enemy, end your turn, watch the enemy's telegraphed intent resolve, and fight until someone hits 0 HP. Tween/floater/hit-stop/screenshake/particle juice fires on every play, hit, and death.

## Controls (mouse-driven)
- **Click a card** in hand to play it (if you can afford its energy cost)
- **Click "End Turn"** (gold button, bottom-right) to pass to the enemy
- **Hover a card** to lift it for a readable preview
- **Click anywhere** on the title / victory / defeat screens to continue
- Keyboard fallback: **Enter** starts / advances screens, **Esc/P** pauses

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
3. Enemy resolves its **telegraphed intent** — a scripted move list (`encounter.json`) is cycled, so the upcoming Attack/Block intent is shown above the enemy before it acts (plan your blocks)
4. Player block resets, next intent telegraphed, new hand drawn, energy restored

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
6. particles.js — spark/burst system + screenshake (copied from side-scroll seed)
7. juice.js — tweens, floaters, hitstop, combo, trails (verbatim from side-scroll seed)
8. draw.js — shared canvas-polish primitives (softShape, gradientBar, glowDot, crispText)
9. i18n.js — data-driven string table (en + vi), browser-language default
10. cards.js — card defs, deck/hand management, encounter fallback
11. battle.js — turn FSM, card effects, scripted enemy intent + resolution
12. screens.js — click-region registry + card hover hit-testing
13. hud.js — player HP/block bar, energy, deck counts
14. render.js — all drawing (title/battle/result/gameover) + screen-shake transform
15. game.js — boot, frame loop (hit-stop dt gate), error overlay, global input

## Data Files
- `data/cards.json` — card definitions (loaded at boot, falls back to BUILTIN_CARDS)
- `data/encounter.json` — player HP/energy/hand size, starting deck, enemy moves (intent scripts); falls back to BUILTIN_ENCOUNTER
- `data/enemies.json` — legacy enemy stat catalog (still loaded; encounter.json is the source of truth)
- `data/strings.json` — UI chrome strings (en/vi)
