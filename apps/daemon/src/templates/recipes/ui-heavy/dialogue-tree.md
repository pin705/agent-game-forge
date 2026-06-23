# Recipe — Dialogue tree (visual novel / branching dialogue)

Implements a branching narrative: dialogue nodes addressed by `id`, each with
speaker + text + a portrait, flowing via `next` (linear), `choices[]` (branch),
or `goto_screen` (hand off to a battle/minigame). Choices apply stat/flag
side-effects and can be gated by requirements; a typewriter reveals text
character-by-character with click-to-complete. This is the vanilla-JS port of
OpenGame's `DialogueManager` + `BaseChapterScene` (+ `GameDataManager` for
flags/endings).

## When to use

- Visual novel / galge / interactive fiction (Doki Doki, 80 Days, Choices)
- Branching dialogue with choices that change stats/flags and route the story
- Story beats / cutscenes / tutorials between other gameplay (a dialogue node
  can `goto_screen` into a card battle, then the battle returns to a node)
- Ace-Attorney-style "talk then act" loops (dialogue drives, minigame resolves)

## When NOT to use

- **Fully linear, no choices** (a pure cutscene) — you only need the typewriter +
  `next`; skip the choice/branch/flag machinery (but the node walker still works,
  just author every node with a `next`).
- **Voice-acted VN with no on-screen text reveal** — drop `typewriter.js`; show
  full text immediately and gate advance on audio-end instead.
- **Dialogue that's just a label over an NPC** (top-down RPG bark) — that's a
  one-shot text box, use the `top-down-rpg` dialogue-box recipe, not a whole
  node tree.
- **Dynamic/generated conversation** (LLM-driven chat) — this is an authored,
  fixed graph; fork if dialogue is generated at runtime.

## Files this affects

- `src/dialogue.js` — node walker (~150-300 LOC; OpenGame `DialogueManager`)
- `src/typewriter.js` — char-by-char reveal + skip (~40-80 LOC)
- `src/portraits.js` — character portrait register / position / expression (optional)
- `data/dialogue/<chapter>.json` — IDENTITY: the node graph
- `data/dialogue-config.json` — TUNING: `textSpeed` (ms/char), box dimensions, autoAdvanceDelay
- `state.stats` / `state.flags` — cross-node persistence (OpenGame `GameDataManager`)
- Runs inside a `dialogue`/`chapter` screen from `recipes/ui-heavy/screen-stack.md`

## Pattern

### 1. The node graph (`data/dialogue/<chapter>.json`)

Node-addressed by `id` (NOT array index — the chassis requires `id` on every
entry and `next`/`choices[].next` to reference ids):

```json
{
  "start": "n_intro",
  "nodes": [
    { "id": "n_intro", "speaker": "Mara", "portrait": "mara_neutral",
      "text": "You finally made it. We don't have much time.", "next": "n_choice1" },

    { "id": "n_enter_mara", "char": { "id": "mara", "action": "enter", "position": "left" }, "next": "n_intro" },

    { "id": "n_choice1", "speaker": "Mara", "portrait": "mara_worried",
      "text": "Do we run, or do we fight?",
      "choices": [
        { "id": "c_run",   "text": "We run.",  "next": "n_run",   "effects": { "courage": -1 } },
        { "id": "c_fight", "text": "We fight.", "next": "n_fight", "effects": { "courage": 1 },
          "requires": { "flag": "has_sword" } }
      ] },

    { "id": "n_fight", "speaker": "Mara", "portrait": "mara_resolute",
      "text": "Then draw your blade.", "set": { "flag": "chose_fight" }, "next": "n_battle" },

    { "id": "n_battle", "goto_screen": "battle_castle_gate" },

    { "id": "n_run", "speaker": "Mara", "portrait": "mara_sad",
      "text": "...Maybe that's wiser.", "next": null }
  ]
}
```

A node has optional `speaker`/`portrait`/`text`, plus exactly one flow field:
`next` (linear; `null` = chapter end), `choices[]` (branch), or `goto_screen`
(replace this screen with another). `char` nodes drive portrait enter/exit/swap
and auto-advance. `effects` = numeric deltas to `state.stats`; `set` = a
`state.flags` boolean; `requires` gates a choice's visibility.

### 2. The node walker (`src/dialogue.js`)

Port of OpenGame `DialogueManager`, addressed by id:

```js
function startDialogue(chapterId) {
  const data = catalogs.dialogue[chapterId];
  state.dlg = {
    nodes: data.nodes, byId: indexById(data.nodes),
    currentId: data.start, busy: false, choiceActive: false,
  };
  processNode(state.dlg.currentId);
}

function nodeById(id) { return state.dlg.byId[id]; }

function processNode(id) {
  const n = nodeById(id);
  if (!n) { endChapter(); return; }
  state.dlg.currentId = id;

  // 1. Portrait action node (enter/exit/expression) — auto-advances.
  if (n.char) {
    applyCharAction(n.char);                 // portraits.js
    autoAdvanceAfter(n.char.action === "enter" ? 300 : 50, n.next);
    return;
  }
  // 2. Hand off to another screen (battle, minigame).
  if (n.goto_screen) { replaceScreen(n.goto_screen); return; }
  // 3. Apply node side-effects, then show text.
  if (n.set)     applyFlags(n.set);
  if (n.portrait && n.speaker) setExpression(n.speaker, n.portrait);
  if (n.choices) { showText(n.speaker, n.text); presentChoices(n); return; }

  showText(n.speaker, n.text);               // starts typewriter
  // waits for player advance() (no next field action needed; advance reads n.next)
}

function advance() {                          // click / Enter / Space
  const d = state.dlg;
  if (d.busy || d.choiceActive) return;       // guard: don't race auto-advance/choice
  if (typewriterActive()) { typewriterComplete(); return; }  // 1st click fills text
  const n = nodeById(d.currentId);
  if (n.next === undefined && n.choices) return;   // a choice node waits for a pick
  if (n.next == null) { endChapter(); return; }    // null/undefined next → end
  processNode(n.next);
}

function autoAdvanceAfter(ms, nextId) {       // OpenGame isAutoAdvancing guard
  state.dlg.busy = true;
  setTimer(ms, () => { state.dlg.busy = false; processNode(nextId); });
}
```

### 3. Choices + effects + requirements

```js
function presentChoices(node) {
  const d = state.dlg;
  d.choiceActive = true;
  // Filter by requires (flag/stat gate) — OpenGame's condition() filter.
  d.visibleChoices = node.choices.filter(c => meetsRequirement(c.requires));
  if (d.visibleChoices.length === 0) {        // guard: all gated out → don't softlock
    d.choiceActive = false; processNode(node.next ?? null); return;
  }
  // The screen's render() draws d.visibleChoices as buttons (store rects for hit-test).
}

function selectChoice(index) {                // click on choice button / 1-9 key
  const d = state.dlg;
  if (!d.choiceActive) return;
  const choice = d.visibleChoices[index];
  if (!choice) return;
  d.choiceActive = false;
  if (choice.effects) applyEffects(choice.effects);     // stat deltas
  recordChoice(d.currentId, choice.id);                 // for ending logic / history
  processNode(choice.next);
}

function meetsRequirement(req) {
  if (!req) return true;
  if (req.flag && !state.flags[req.flag]) return false;
  if (req.stat && (state.stats[req.stat.key] ?? 0) < req.stat.min) return false;
  return true;
}
function applyEffects(eff) { for (const k in eff) state.stats[k] = (state.stats[k] ?? 0) + eff[k]; }
function applyFlags(set)   { if (set.flag) state.flags[set.flag] = true; }
```

`state.stats` / `state.flags` are flat fields on the shared state object
(OpenGame's `GameDataManager` singleton, flattened per `common.md` rule 2) so
they persist across nodes, chapters, AND screens (a flag set in chapter 1 gates
a choice in chapter 3).

### 4. Typewriter reveal (`src/typewriter.js`)

```js
function showText(speaker, text) {
  state.tw = { speaker: speaker ?? "", full: text ?? "", shown: 0, acc: 0, done: (text ?? "").length === 0 };
}
function updateTypewriter(dt) {
  const tw = state.tw; if (!tw || tw.done) return;
  tw.acc += dt * 1000;                          // dt in seconds → ms
  const perChar = CONFIG.textSpeed ?? 30;       // dialogue-config.json
  while (tw.acc >= perChar && tw.shown < tw.full.length) {
    tw.acc -= perChar; tw.shown++;
    if (tw.full[tw.shown - 1] !== " ") playSfx("tick");  // soft per-char blip
  }
  if (tw.shown >= tw.full.length) tw.done = true;
}
function typewriterActive() { return state.tw && !state.tw.done; }
function typewriterComplete() { if (state.tw) { state.tw.shown = state.tw.full.length; state.tw.done = true; } }
// render: ctx.fillText of tw.full.slice(0, tw.shown), wrapped to the box width via wrapText().
```

First click on a mid-reveal line **completes it instantly** (don't skip to the
next node); the second click advances. This is the expected VN feel and the
fix for the #1 dialogue pitfall.

### 5. Endings (OpenGame `determineEnding`)

At chapter end, pick an ending screen from `state.flags`/`state.stats` via a
priority-ordered rule list, then `replaceScreen` to a RESULT screen:

```js
function endChapter() {
  const rules = catalogs.dialogue.endings ?? [];      // [{ id, screen, requires, priority }]
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const hit = sorted.find(r => meetsRequirement(r.requires));
  state.result = hit?.id ?? "neutral";
  replaceScreen(hit?.screen ?? "ending_neutral");
}
```

First matching (highest-priority) rule wins — e.g. `courage >= 3` → brave
ending, else neutral.

> **DOM-overlay / hybrid note**: in `dom-overlay` mode, `showText` sets
> `#dlg-text`'s content and you animate the reveal by growing `.textContent`
> (or use a CSS typing effect); choices are real `<button>`s appended on
> `presentChoices` and removed on `selectChoice`. The walker, effects, flags,
> and ending logic are identical — only text paint + choice rendering differ.

## Adaptation knobs

| Knob | Where | Default | Effect |
|---|---|---|---|
| `textSpeed` | dialogue-config.json | 30 | ms per character (lower = faster) |
| `autoAdvanceDelay` | dialogue-config.json | 0 | >0 → auto-advance text after delay (kiosk/auto mode) |
| Box dimensions | dialogue-config.json | — | Text box size/position |
| `requires` shape | dialogue/*.json | flag/stat | Gate choices on story state |
| Portrait positions | portraits.js | left/center/right | Where characters stand |
| Ending rules | dialogue/*.json `endings` | — | Map final state → ending screen |

## Common mistakes

1. **Index-addressed nodes** — OpenGame walks `dialogues[currentIndex]`; the
   chassis requires `id` + `next`. Index-addressing breaks the moment you
   insert/reorder a node and is uneditable in the OGF editor. Always node-id.
2. **Manual advance racing auto-advance** — clicking while a character-enter
   (300ms) or `wait` timer is pending double-advances and skips a line. Guard
   with `state.dlg.busy` (OpenGame's `isAutoAdvancing`) and bail out of
   `advance()` while it's set.
3. **First click skips the whole line** — without the typewriter-complete
   branch, an impatient click jumps to the next node and the player never reads
   the text. First click completes the reveal; second advances.
4. **All choices gated out → softlock** — if every `choices[]` entry fails its
   `requires`, the node waits forever. Filter, and if empty, fall through to
   `node.next` (or end). OpenGame guards this exact case.
5. **Effects/flags in code instead of data** — hard-coding "if chose_fight then
   ..." in JS. Put the gate in the node's `requires` so writers (and the editor)
   can re-wire branches without code.
6. **Flags stored per-screen** — a flag set in chapter 1's screen is lost when
   that screen pops. Keep `state.flags`/`state.stats` on the shared state object
   so they survive screen transitions and reach the ending logic.
7. **`goto_screen` without a return path** — if a node hands off to a battle,
   decide how the battle returns (e.g. the battle's RESULT `replaceScreen`s back
   to a dialogue screen that resumes at a specific node id). Plan the round-trip.
8. **Wrapping text manually with `\n` in the JSON** — let `wrapText()` break to
   the box width at render time; hard newlines in content break on different box
   sizes.

## Reference

OpenGame `src/systems/DialogueManager.ts` (entry processing, advance, choice
resolution, branch splicing, the `isAutoAdvancing` guard), `src/scenes/BaseChapterScene.ts`
(the chapter lifecycle + showDialogueText/showChoiceUI hooks + typewriter via
`textSpeed`), `src/systems/GameDataManager.ts` (flags/stats/choice-history +
`determineEnding` priority rules). All ported to vanilla Canvas 2D (or DOM
overlay) + `data/dialogue/*.json` node graphs addressed by `id`.
