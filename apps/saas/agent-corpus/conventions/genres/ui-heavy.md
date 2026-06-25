# Genre — UI-heavy (panel/click games)

Panel-and-click games with almost no avatar physics. There is no player sprite walking a world — the player reads panels and clicks things. The genre splits into THREE sub-modes based on `spec.ui_submode`:

| `ui_submode` | Examples | Shape |
|---|---|---|
| `card-battler` | Slay the Spire, Inscryption, Reigns | **Deck/hand/energy turn loop** — draw → play cards vs enemy → resolve → enemy turn → check end. See `recipes/ui-heavy/card-battler.md`. |
| `visual-novel` | Doki Doki, 80 Days, Ace Attorney, Choices | **Branching dialogue tree** — node text → choices → next node, with stat/flag side-effects and endings. See `recipes/ui-heavy/dialogue-tree.md`. |
| `clicker` | Cookie Clicker, Universal Paperclips, AdVenture Capitalist | **Idle/incremental** — click to earn a resource, buy upgrades that auto-earn, numbers go up. See "Clicker / idle mode" section below. |

A fourth common shape — **quiz / trivia** (Kahoot, HQ, "Who Wants to Be a Millionaire") — is `card-battler` with the deck swapped for a question bank; see "Quiz variant" below.

> ⚠️ **OGF projects do NOT use Phaser / React / Pixi** — vanilla JS + HTML5 Canvas (or DOM) only. This genre is ported from OpenGame's Phaser `ui_heavy` archetype, but the KNOWLEDGE (turn FSM, dialogue branching, deck lifecycle) is what carries over — write it as plain Canvas 2D + JSON, not Phaser scenes. There is no `BaseBattleScene` / `BaseChapterScene` here; those become your `src/screens.js` + recipe modules.
>
> ⚠️ **OGF Scene editor support for ui-heavy is LIMITED** — the UI is data-driven, not spatial. The editor edits the *catalogs* (cards, dialogue nodes, questions, upgrades) as JSON, not drag-positioned objects. See "Scene editor support" below — be honest with the user about this in spec planning.

This file assumes you've read `common.md` (data/*.json, `id` on every array entry, module architecture, config split) and `game-design.md` (the six design lenses). The universal runtime-patterns (delta time, FSM, AABB for hit-testing clicks) still apply, but there is **no gravity, no scrolling camera, no parallax** — strip all of that from your mental model.

## Canvas vs DOM — pick honestly per sub-mode (READ FIRST)

`common.md` says "the canvas IS the UI; HUD via `ctx.fillText` / `ctx.fillRect`." For action genres that's right — one `<canvas>`, everything drawn each frame. UI-heavy is the one genre where **DOM overlays are a legitimate alternative**, because the screen is mostly text + buttons that don't animate every frame. Decide once, per the table, and record it in spec §1 as `render_mode: canvas | dom-overlay | hybrid`:

| `render_mode` | What it means | Best for | Cost |
|---|---|---|---|
| `canvas` (default) | Everything drawn with `ctx.fillText` / `ctx.fillRect` / `drawImage` each frame. Clicks hit-tested against rects you store in `state`. | card-battler, clicker (animated numbers, card tweens, particles) | You write your own text wrapping, button hit-testing, hover. More code, total control, matches every other OGF genre. |
| `dom-overlay` | A `<div id="ui">` over (or instead of) the canvas holds real `<button>` / `<p>` elements; you set `.textContent` and `.style`. Canvas only used for backgrounds/portraits (or not at all). | text-heavy visual novels, dialogue-only games, quiz games | Native text wrapping, accessibility, easy CSS styling. BUT the OGF Scene editor can't see DOM, and you diverge from the canvas-everywhere norm. |
| `hybrid` | Canvas draws the scene (background, character portraits, card art, FX); a thin DOM layer holds long-form text + choice buttons. | rich visual novels with portraits + animated backgrounds | Both worlds; slightly more wiring (keep DOM z-index above canvas). |

**Honest tradeoff**: `dom-overlay` is genuinely easier for a wall-of-text VN (the browser does line-breaking and you get real focusable buttons for free), but it makes the game less inspectable in OGF's canvas-based Play/Scene tooling and is the only OGF genre that touches the DOM for gameplay. If in doubt, default to `canvas` (consistent with the rest of OGF) and only reach for `dom-overlay` when the game is ≥80% text. Whichever you pick, **all content still lives in `data/*.json`** — the render mode only changes how you paint it, never where it's stored.

Both modes share the same state machine, the same catalogs, and the same input model (a click resolves to "which interactive region was hit"). The recipes are written render-mode-agnostic with notes for each.

## Mechanics — what the player DOES

The genre has **no movement verb**. The core loop is built from these verbs only:

| Verb | Where it shows up | Rule |
|---|---|---|
| **Click / tap a region** | every sub-mode | The universal input. Hit-test pointer against `state`'s list of active interactive regions (cards, choices, buttons, the big cookie). |
| **Advance text** | visual-novel | Click / Enter / Space reveals the next chunk or, if the typewriter is mid-reveal, completes the current line instantly. |
| **Choose** | visual-novel, card pick | Pick 1 of N options; applies side-effects (stat/flag deltas) and routes to the next node/state. |
| **Play a card** | card-battler | Spend energy, apply the card's effect (damage / block / heal / draw), move it to discard. |
| **End turn** | card-battler | Hand discards, enemy acts, new hand drawn, energy refills. |
| **Buy / upgrade** | clicker, card-battler reward | Spend accumulated resource to raise a per-tick or per-click multiplier. |
| **Keyboard shortcut** | all (accessibility) | `1-9` select the N-th card/choice; `Enter`/`Space` confirm/advance; `Esc` pause. Always provide these alongside mouse — they make the game playable and testable. |

**Anti-pattern**: importing action-genre mechanics. No `gravity`, no `jump`, no `colliders[]`, no parallax `layers[]`, no `player.vx/vy`. If your spec mentions any of those, you picked the wrong genre. Cross-check against the `mechanics` table in `game-design.md` Lens 2.

## The state-machine model — a screen/mode stack

UI-heavy games are a **stack of screens**, not a scrolling level. The whole game is "which screen am I on, and what's its sub-state." Model it as an explicit FSM in `src/state.js` + a stack in `src/screens.js`:

```
                 ┌─────────────────────────────────────────┐
   boot ──▶ MENU ─┤ push                                     │ pop
                 ▼                                            ▲
               PLAY ──▶ RESOLVE ──▶ RESULT ──▶ (pop to MENU or push next)
                 │                                            │
                 └──▶ PAUSE (overlay; pop returns to PLAY) ───┘
```

- **MENU** — title / character-select / chapter-select / settings. Click "Start" → push `PLAY`.
- **PLAY** — the active game (a battle, a dialogue chapter, the clicker board). Owns a sub-mode FSM:
  - card-battler PLAY sub-states: `PLAYER_TURN → (card animations) → ENEMY_TURN → CHECK_END`
  - visual-novel PLAY sub-states: `SHOWING_TEXT → WAITING_INPUT → (CHOICE) → next node`
  - clicker PLAY is effectively one long state with a per-second tick.
- **RESOLVE** — short transition state where an action's outcome plays out (card damage numbers fly, "Correct!" flashes, win/loss is computed). Often just a timer before RESULT.
- **RESULT** — win/lose/ending screen. Click → pop back to MENU, or push the next chapter/battle.
- **PAUSE** — overlay pushed on top of PLAY; pop resumes exactly where you were.

`state.screens` is an array used as a stack; the top is the active screen. Overlays (PAUSE, a confirm dialog, the level-up card pick) are pushed *without* discarding what's underneath, so you can render the dimmed screen below them. This is the OpenGame `TurnManager` phase-engine idea generalized to the whole app. **See `recipes/ui-heavy/screen-stack.md` for the paste-ready implementation.**

Persistent cross-screen data (HP carried between battles, story flags, unlocked chapters, save data) lives in flat fields on `state` — `state.flags`, `state.stats`, `state.inventory` — NOT inside any one screen's local vars. This is the OpenGame `GameDataManager` singleton, flattened into the shared `state` object per `common.md` rule 2 ("one canonical state object").

## Data schema — content is catalogs in `data/*.json`

Everything the player reads or interacts with is a **catalog**: an array of objects, **every entry with a unique `id`** (per `common.md` §"JSON entry contract"). The runtime is generic; the catalogs are the game. This is the heart of the genre — a card-battler and a quiz game can share 90% of the engine and differ only in `data/cards.json` vs `data/questions.json`.

### Cards (`data/cards.json`) — card-battler

```json
[
  { "id": "strike",   "name": "Strike",   "type": "attack", "cost": 1, "value": 6,
    "art": "assets/cards/strike.png",   "text": "Deal 6 damage." },
  { "id": "defend",   "name": "Defend",   "type": "block",  "cost": 1, "value": 5,
    "art": "assets/cards/defend.png",   "text": "Gain 5 block." },
  { "id": "bash",     "name": "Bash",     "type": "attack", "cost": 2, "value": 8,
    "art": "assets/cards/bash.png",     "text": "Deal 8 damage. Apply 2 Vulnerable.",
    "status": { "vulnerable": 2 } },
  { "id": "first_aid","name": "First Aid","type": "heal",   "cost": 1, "value": 7,
    "art": "assets/cards/first_aid.png","text": "Heal 7 HP." }
]
```

`type` ∈ `attack | block | heal | special` (mirrors OpenGame's `CardType`). `cost` = energy to play. `value` = damage/block/heal magnitude. Optional `status`/`draw`/`effect` fields carry extra behavior the resolver dispatches on. The starting *deck* (which card ids, with duplicates) is a list of ids in `data/run-config.json` — keep the deck composition separate from the card definitions so the same `strike` card can appear ×5.

### Dialogue nodes (`data/dialogue/<chapter>.json`) — visual-novel

```json
{
  "start": "n_intro",
  "nodes": [
    { "id": "n_intro", "speaker": "Mara", "portrait": "mara_neutral",
      "text": "You finally made it. We don't have much time.",
      "next": "n_choice1" },
    { "id": "n_choice1", "speaker": "Mara", "portrait": "mara_worried",
      "text": "Do we run, or do we fight?",
      "choices": [
        { "id": "c_run",   "text": "We run.",   "next": "n_run",   "effects": { "courage": -1 } },
        { "id": "c_fight", "text": "We fight.",  "next": "n_fight", "effects": { "courage": 1 },
          "requires": { "flag": "has_sword" } }
      ] },
    { "id": "n_fight", "speaker": "Mara", "portrait": "mara_resolute",
      "text": "Then draw your blade.", "set": { "flag": "chose_fight" }, "next": "n_battle" },
    { "id": "n_battle", "speaker": "", "text": "", "goto_screen": "battle_castle_gate" }
  ]
}
```

This is OpenGame's `DialogueEntry`/`ChoiceOption` model, but **node-addressed by `id` rather than array index** — required by the chassis (every entry has an `id`, and `next`/`choices[].next` reference those ids). A node has `text` + optional `speaker`/`portrait`, then exactly one of: `next` (linear), `choices[]` (branch), `goto_screen` (hand control to another screen, e.g. a battle), or neither (end of chapter). `effects` apply numeric deltas to `state.stats`; `set` writes a `state.flags` boolean; `requires` gates a choice's visibility on a flag/stat threshold. **See `recipes/ui-heavy/dialogue-tree.md`.**

### Questions (`data/questions.json`) — quiz variant

```json
[
  { "id": "q_capital_fr", "subject": "geo", "difficulty": 1,
    "question": "What is the capital of France?",
    "options": ["Paris", "Lyon", "Marseille", "Nice"],
    "correctIndex": 0,
    "explanation": "Paris has been France's capital since 508 AD." },
  { "id": "q_h2o", "subject": "science", "difficulty": 1,
    "question": "Water is made of hydrogen and …?",
    "options": ["Helium", "Oxygen", "Nitrogen", "Carbon"],
    "correctIndex": 1, "explanation": "H₂O = 2 hydrogen + 1 oxygen." }
]
```

Mirrors OpenGame's `QuizQuestion`. `correctIndex` is 0-based into `options`. The runtime picks questions without repeats (track used ids in `state`), exactly like OpenGame's `QuizManager`.

### Upgrades (`data/upgrades.json`) — clicker, and card-battler rewards

```json
[
  { "id": "cursor",  "name": "Cursor",     "baseCost": 15,  "costScale": 1.15,
    "perTick": 0.1,  "icon": "assets/upgrades/cursor.png",
    "text": "Auto-clicks 0.1/sec." },
  { "id": "grandma", "name": "Grandma",    "baseCost": 100, "costScale": 1.15,
    "perTick": 1,    "icon": "assets/upgrades/grandma.png",
    "text": "Bakes 1/sec." },
  { "id": "click_x2","name": "Reinforced Finger", "baseCost": 50, "costScale": 2.0,
    "perClick": 1,   "text": "+1 per manual click." }
]
```

`baseCost` × `costScale^owned` = next purchase price (the canonical incremental-game cost curve). `perTick` adds to passive income/sec; `perClick` adds to the manual-click yield. Owned counts live in `state.upgrades` (`{ cursor: 3, grandma: 1 }`), NOT in this file — the catalog defines what *exists*, state tracks what's *owned*.

### Config split (tuning vs identity)

Per `common.md` rule 3 + `game-design.md` Lens 4 — and note OGF config is **flat plain JSON, no `{ "value": X }` wrapper** (OpenGame's `gameConfig.json` wraps every value; we do NOT — that wrapper is a Phaser-template artifact, strip it):

| File | Holds (tuning) |
|---|---|
| `data/battle-config.json` | `startingEnergy`, `handSize`, `playerMaxHp`, `enemyMaxHp`, `comboTiers[]`, turn/animation delays |
| `data/dialogue-config.json` | `textSpeed` (ms/char for typewriter), `autoAdvanceDelay`, box dimensions |
| `data/clicker-config.json` | `tickRate`, save interval, number-format thresholds |
| `data/audio-config.json` | per-cue WebAudio tone freq + gain (`click`, `correct`, `wrong`, `damage`, `victory`) |

Identity catalogs (above): `cards.json`, `dialogue/*.json`, `questions.json`, `upgrades.json`, plus `data/screens.json` (the screen registry — which screens exist, their type, and first screen) and `data/enemies.json` (battle enemy stats: `id`, `name`, `maxHp`, `portrait`, `damageRange`, `actions[]` — OpenGame's `EnemyBattleConfig`).

Audio is **WebAudio tones in `src/audio.js` driven by `audio-config.json`**, not `.mp3` files (per `game-design.md` Lens 3) — `click`, `correct`, `wrong`, `damage`, `victory` are event names, not assets.

## Recommended module split (ui-heavy)

Per `common.md` §"Module architecture (universal)", every project gets the universal modules (`constants / config / catalogs / dom / state / assets / audio / input / render / game.js`). Note: `collision.js` is reduced to **point-in-rect hit-testing** (clicks vs regions), not AABB body physics; there is **no `physics.js`, no `camera.js`, no `parallax.js`, no `scene.js` (scrolling-level switcher)** — `screens.js` replaces the scene switcher.

UI-heavy adds these on top:

| Module | Responsibility | Approx LOC |
|---|---|---|
| `src/screens.js` | The screen/mode stack: `push` / `pop` / `replace` / `top`, per-screen `enter`/`update`/`render`/`onClick`/`onKey`, transitions. The engine spine. | 150-300 |
| `src/content.js` | Catalog loaders + lookups: `cardById`, `nodeById`, `questionById`, deck builder, no-repeat question picker. (OpenGame's `GameDataManager` data side, flattened.) | 100-200 |
| `src/ui.js` | Reusable interactive widgets: `button(rect,label)`, `drawCard(card,rect,hover)`, `drawPanel`, `wrapText`, hit-test helpers, hover state. (OpenGame's `Card`/`ModalOverlay`/`StatusBar` UI prefabs.) | 200-400 |
| `src/typewriter.js` | Character-by-character text reveal + skip-to-full + per-char tick sfx. (Powers VN + any narrative box.) | 40-80 |
| **card-battler** | | |
| `src/battle.js` | Turn FSM, energy, play-card resolution, enemy AI, win/loss check. (OpenGame `BaseBattleScene` + `TurnManager`.) | 300-500 |
| `src/deck.js` | Deck/hand/discard lifecycle: shuffle, draw-to-hand, play, discard, reshuffle-when-empty. (OpenGame `CardManager`.) | 100-180 |
| `src/combo.js` | Streak → multiplier tiers (quiz/card crit feel). (OpenGame `ComboManager`.) | 40-80 |
| **visual-novel** | | |
| `src/dialogue.js` | Node walker: process node, advance, resolve choice, apply effects/flags, branch, hand-off to screens. (OpenGame `DialogueManager`.) | 150-300 |
| `src/portraits.js` | Character portrait register + position (left/center/right) + expression swap + enter/exit slide. | 80-150 |
| **clicker** | | |
| `src/clicker.js` | Resource accumulation, per-tick passive income, upgrade purchase + cost-curve, big-number formatting. | 150-300 |

Pick only the sub-mode block your `ui_submode` needs. A pure VN ships `screens + content + ui + typewriter + dialogue + portraits` (no battle/deck). A quiz game ships `screens + content + ui + battle (question-driven) + combo`. Most ui-heavy projects land at **12-18 src files, 1,200-2,500 LOC**.

## Scene editor support

UI-heavy is **limited** in the OGF Scene tab (per `common.md` §"OGF Scene editor support level by genre"). There is no spatial level to drag — the "level" is a stack of screens and a pile of catalogs. What the editor edits is the **catalogs themselves, as JSON**:

| Editable in editor | How |
|---|---|
| Card definitions (`cards.json`) | Edit JSON: tweak `cost`/`value`/`text`, add/remove cards. Each card's `id` is the editor's primary key. |
| Dialogue nodes (`dialogue/*.json`) | Edit JSON: rewrite `text`, re-wire `next`/`choices[].next`, add nodes. Node `id` is the key. |
| Questions (`questions.json`) | Edit JSON: fix wording, change `correctIndex`, add questions. |
| Upgrades (`upgrades.json`) | Edit JSON: retune `baseCost`/`perTick`. |
| Tuning (`*-config.json`) | Edit JSON: `handSize`, `textSpeed`, `startingEnergy`, combo tiers. |
| Backgrounds / portraits / card art | Replace via Regenerate on the asset file. |

Not drag-editable (chat the user, or they edit JSON directly): screen layout, button positions, dialogue branching graph (no visual node-graph editor in V1 — it's a JSON tree). **Be explicit in spec planning**: tell the user "this genre is authored as JSON catalogs you can edit in the editor; there's no drag-positioned scene, because the screen IS the UI and it's laid out by code from the catalog data." This is the honest framing — don't promise drag-edit power the genre doesn't have.

Because `id` is the editor's primary key for *every* catalog entry (cards, nodes, questions, upgrades, screens, enemies), forgetting `id` here is even more costly than in spatial genres — the editor can't address the entry to patch it. Author `id` on every entry, first time.

## Spec phase-plan expansion

> ⚠️ Recurring failure (general OGF): spec writer compresses a whole sub-system into one mega-phase ("build the battle: deck + hand + energy + enemy AI + win/loss + reward screen"). Per `common.md` §"split character + system phases", each system is its own phase with a ≤30-second VERIFY gate. UI-heavy is *especially* prone to this because there are no sprite-gen phases forcing natural breaks — it's almost all systems + content.

UI-heavy has a different phase shape from action genres: **few asset phases, many content + system phases.** Assets are backgrounds, character portraits (one image per expression — OpenGame uses `type: "image"` front-view bust shots, NOT animation sheets), card art, and upgrade icons. The bulk of the work is wiring the screen stack + authoring catalogs.

**Expand the plan as `1 anchor + asset phases + engine phases + content phases + per-screen phases`.** Keep one screen/system per phase. Concrete templates per sub-mode:

### card-battler phase plan

```
Phase 1:  Visual anchor — .ogf/style-anchor.png (the card/UI art identity)
Phase 2:  Backgrounds + card frame art (menu bg, battle bg, card frame template)
Phase 3:  Enemy portraits (one image per enemy; bust shots)
Phase 4:  Screen stack — src/screens.js push/pop + MENU screen + start button   [VERIFY: title shows, Start enters a blank PLAY]
Phase 5:  Deck/hand — src/deck.js: shuffle, draw hand of N, render hand, click a card  [VERIFY: 5 cards draw, clicking discards one]
Phase 6:  Energy + play-card resolution — spend energy, apply damage/block/heal to HP  [VERIFY: playing Strike drops enemy HP by 6, costs 1 energy]
Phase 7:  Turn FSM — End Turn → enemy acts → redraw → energy refill  [VERIFY: End Turn triggers enemy attack, new hand]
Phase 8:  Win/loss check + RESULT screen  [VERIFY: enemy to 0 HP → victory screen; player to 0 → defeat]
Phase 9:  cards.json catalog — author the full card set + starting deck composition
Phase 10: Combo/status effects (vulnerable, block carry-over) + juice (damage numbers, screenshake)
Phase 11: Audio (WebAudio click/damage/victory) + pause overlay
```

### visual-novel phase plan

```
Phase 1:  Visual anchor — .ogf/style-anchor.png (art identity for portraits + bg)
Phase 2:  Scene backgrounds (one per location)
Phase 3:  Character portraits — one image per character × expression (neutral/happy/angry…)
Phase 4:  Screen stack + MENU + render_mode decision wired  [VERIFY: title → chapter starts]
Phase 5:  Dialogue node walker — src/dialogue.js: linear next, render text box + speaker  [VERIFY: clicking advances through 3 linear nodes]
Phase 6:  Typewriter reveal — src/typewriter.js: per-char reveal + click-to-complete  [VERIFY: text types out; click mid-reveal fills instantly]
Phase 7:  Portraits — enter/exit/position/expression swap driven by nodes  [VERIFY: Mara slides in on the left, swaps to "worried"]
Phase 8:  Choices + effects/flags — branch on choice, apply stat/flag deltas, gate with requires  [VERIFY: choosing "fight" routes to n_fight and sets chose_fight]
Phase 9:  Endings — determine ending from flags/stats → RESULT screen (OpenGame determineEnding rules)  [VERIFY: high-courage path reaches the "brave" ending]
Phase 10: dialogue/*.json — author the full chapter(s)
Phase 11: Save/load (localStorage) + audio + auto-advance option
```

### clicker phase plan

```
Phase 1:  Visual anchor — the clickable subject + upgrade icons identity
Phase 2:  The big clickable art + upgrade icons
Phase 3:  Screen stack + MENU + clicker board  [VERIFY: board shows, resource = 0]
Phase 4:  Click-to-earn — click the subject, resource ticks up, click feedback  [VERIFY: clicking adds 1, floating "+1"]
Phase 5:  Upgrades panel — render buyable upgrades from catalog, disable when unaffordable  [VERIFY: upgrades list with costs]
Phase 6:  Purchase + cost curve — buy raises owned count, recomputes next cost  [VERIFY: buying Cursor costs 15, next costs ~17]
Phase 7:  Passive income tick — perTick income accrues per second from owned upgrades  [VERIFY: own 1 Grandma → +1/sec without clicking]
Phase 8:  Big-number formatting + save/load (localStorage)
Phase 9:  Audio + polish (number pop, milestone flashes)
```

Each "+" you'd be tempted to write in a phase title (e.g. "deck + energy + turn + win/loss") is a phase boundary you're missing — split it. A run that completes 11 small phases beats one that dies on phase 5 of 6 with a half-wired battle.

### Quiz variant

A quiz game is `card-battler` with the deck replaced by a question bank: PLAY shows a question + 4 option buttons; correct → damage enemy (or +score) and bump the combo; wrong → take damage (or lose a life) and reset combo. Reuse the card-battler phase plan but swap Phases 5-6 for: "render question + 4 options from `questions.json` (no-repeat picker)" and "answer resolution + combo multiplier". `correctIndex` validation + no-repeat selection come straight from OpenGame's `QuizManager`. PVP buzzer mode (two players race to answer) lives in `dualPlayerConfig`-style fields in `battle-config.json` — sequential or simultaneous answer, score-to-win.

### Clicker / idle mode (detail)

The clicker loop is the simplest FSM (essentially one PLAY state) but the most numerically driven. Core: `resource += perClick` on click; once per `tickRate` seconds `resource += Σ(owned[u] × upgrade.perTick)`; buying upgrade `u` costs `floor(baseCost × costScale^owned[u])` and increments `owned[u]`. The whole "game" is the upgrade catalog + the cost/income curves in `clicker-config.json`. Numbers grow exponentially, so format them (`1.0K`, `1.0M`, `1.0B`) once they exceed thresholds. Save to `localStorage` on an interval + on unload (idle games are expected to persist). There's no recipe file for clicker — it's small enough to write from the schema above + the screen-stack recipe; if you need a deck-like reward draw on milestones, borrow from the card-battler recipe.

## Common pitfalls (don't repeat these)

1. **Treating it like an action genre** — adding `physics.js`, `camera.js`, gravity, or `colliders[]`. UI-heavy has none. Clicks are point-in-rect hit-tests, not body collisions.
2. **Dialogue addressed by array index instead of `id`** — OpenGame walks `dialogues[currentIndex]`; the chassis requires `id` on every node and `next`/`choices[].next` to reference ids. Index-addressing breaks the editor and any insert/reorder. Always node-id.
3. **Keeping the `{ "value": X, "type": ... }` config wrapper** from OpenGame's `gameConfig.json`. OGF config is flat plain JSON read as `CONFIG.handSize`. Strip the wrapper.
4. **Content baked into code** — a `const CARDS = [...]` or a dialogue string array in a `.js` file. All of it goes in `data/*.json` so the editor can read it (per `common.md` rule 1). Code is the generic engine; JSON is the game.
5. **Manual-advance racing the typewriter / auto-advance timer** — clicking while a character-enter animation or `wait` node is mid-flight double-advances and skips a line. Guard with an `isBusy` flag (OpenGame's `DialogueManager.isAutoAdvancing`). The dialogue recipe covers this.
6. **Same question/card repeating immediately** — track used ids in `state` and exclude them until the pool is exhausted, then reset (OpenGame's `QuizManager` no-repeat logic). Same for shuffling a deck — reshuffle the discard only when the draw pile is empty.
7. **DOM overlay + canvas z-fighting** — if you go `hybrid`/`dom-overlay`, the DOM UI layer must sit above the canvas (`z-index`) and the canvas must not also be drawing the same buttons. Pick one owner per widget.
8. **No keyboard fallback** — mouse-only UI is hard to test headless and inaccessible. Always wire `1-9` / `Enter` / `Esc`.

## Reference implementation + recipes

OGF does not yet ship a ui-heavy foundation seed. Build from the **Module architecture** rules + the schemas above. For architectural shape (state.js + config split + thin game.js + per-subsystem modules), use `D:/Sengoku-Era-ogf` as the baseline and translate:

| Sengoku-Era-ogf module | ui-heavy equivalent |
|---|---|
| `src/scene.js` (scrolling-level switcher) | `src/screens.js` (screen/mode stack) — replace, don't adapt |
| `src/battle.js` (turn-based combat) | `src/battle.js` (card/quiz turn FSM) — closest direct analog |
| `src/menu.js` | MENU + RESULT screens in `screens.js` |
| `src/dialogue.js` (text box) | `src/dialogue.js` (full node walker) + `src/typewriter.js` |
| `data/battle-config.json` | `data/battle-config.json` (energy, handSize, comboTiers) |

**Read these recipes at phase-execute time:**

| Implementing | Read recipe FIRST |
|---|---|
| `src/screens.js` (the push/pop screen FSM — needed by every sub-mode) | `recipes/ui-heavy/screen-stack.md` |
| `src/battle.js` + `src/deck.js` (card battler / quiz turn loop) | `recipes/ui-heavy/card-battler.md` |
| `src/dialogue.js` + `src/typewriter.js` (VN node tree + reveal) | `recipes/ui-heavy/dialogue-tree.md` |
| Clicker board (no recipe — use schema + screen-stack) | `recipes/ui-heavy/screen-stack.md` + "Clicker / idle mode" above |

Each recipe has a "When NOT to use" section — if your mechanic differs (deckless roguelike, fully-voiced VN with no typewriter, real-time clicker with no upgrades), the recipe tells you to fork rather than force-fit.

## Reference repos to learn from

- [Slay the Spire community design breakdowns](https://www.gamedeveloper.com/design/the-design-of-slay-the-spire) — card-battler turn/energy/intent loop (the canonical mental model)
- [Ren'Py](https://www.renpy.org/) — the reference VN engine; its script model (labels, jumps, menus) maps onto our node-id + choices schema
- [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) + [Universal Paperclips](https://www.decisionproblem.com/paperclips/) — incremental cost/income curve design
- [OpenGame `ui_heavy` module](../../../../OpenGame/agent-test/templates/modules/ui_heavy/) — the Phaser source this genre's knowledge was ported from (read for the mechanics, not the framework)
