# Recipe — Dialogue queue + auto-advance

Modal text box for NPC speech, post-battle results, scene-change flavor, tutorial intros. Queue-based: subsystems push lines, the box drains one-at-a-time, advance with Space/Enter.

## When to use

- NPC interactions need flavor text (more than just "talk to Aoi")
- Post-battle results show prose ("Nobunaga falls. Gain 96 XP.")
- Scene transitions need narration
- Tutorial / intro on first scene entry
- Branching choices (limited — see "When NOT to use" for full VN)

## When NOT to use

- Full visual novel branching trees with character portraits, animations — use a real VN engine (Ren'Py-style); this dialogue box is too thin
- Pure mechanical games with no narrative (puzzle / arcade) — drop dialogue.js entirely
- Real-time games where pausing for text breaks flow — use floating text bubbles instead

## Files this affects

- `src/dialogue.js` — queue + display + advance (~190 LOC reference)
- `src/dom.js` — refs to dialogue HTML elements
- `src/input.js` — Space/Enter routes to `advanceDialogue()`
- `src/interaction.js` — NPC handlers push lines into the queue
- `src/battle.js` — finishBattle pushes result line
- `index.html` — `<div id="dialogue">` panel structure
- `styles.css` — dialogue panel chrome + blink/pulse hint

## Dependencies on foundation

```js
state.dialogueQueue = [];   // Array<string | string[]> of pending lines
state.mode === "overworld"; // dialogue overlays overworld; battle has its own log line
```

`setPanels()` from dialogue.js itself toggles which DOM is visible per mode.

## Pattern — push + drain

```js
// Subsystem pushes (interaction.js, battle.js, scene.js):
state.dialogueQueue.push(
  "葵：歡迎來到晴嵐神社。",
  "葵：右側的演武場有黑鎧怨靈守著山道封印。",
);

// Main loop in overworld.js drains one per "show":
function drainDialogueQueue() {
  if (currentDialogueShown) return;       // already showing one
  if (!state.dialogueQueue.length) return;
  const next = state.dialogueQueue.shift();
  showDialogue(next);                      // sets DOM text + reveals box
}

// Player advances:
function advanceDialogue() {
  if (!currentDialogueShown) return;
  if (state.dialogueQueue.length) {
    showDialogue(state.dialogueQueue.shift());
  } else {
    hideDialogue();
  }
}
```

## Multi-line entries

A single push can be `string` (one box) or `string[]` (multiple boxes shown sequentially):

```js
state.dialogueQueue.push([
  "黑鎧怨靈倒下。",                    // box 1
  "山道封印碎成金光。葵遠遠點頭。",     // box 2
]);
```

Implementation: when shift() returns an array, expand inline:
```js
if (Array.isArray(next)) {
  state.dialogueQueue.unshift(...next);  // re-push as separate strings
  next = state.dialogueQueue.shift();
}
```

## Branching choices (lite)

For yes/no or 2-3 option choices (not full VN trees):

```js
state.dialogueChoice = {
  prompt: "要進入演武場嗎？",
  options: [
    { label: "前進", onPick: () => state.pendingBattle = "gate" },
    { label: "退回", onPick: () => {} },
  ],
};
```

Render two buttons + handle Enter on selected option. Stop draining queue while choice active.

## Adaptation knobs

| Behavior | Where | Default |
|---|---|---|
| Advance keys | input.js | Space / Enter / E |
| Text reveal speed | dialogue.js (typewriter optional) | instant |
| Box position | styles.css | bottom 20% of screen |
| Auto-dismiss timeout | dialogue.js (optional) | none — wait for input |
| Skip-all key | input.js (optional) | Shift+Esc |

## NPC interact flow

Typical pattern in `interaction.js`:

```js
function handleInteract() {
  // If dialogue showing, advance it instead of triggering new interaction
  if (dialogueVisible()) { advanceDialogue(); return; }

  const npc = nearestNpc();
  if (npc) {
    state.dialogueQueue.push(...lookupNpcLines(npc));
    return;
  }

  const exit = nearestSceneExit();
  if (exit) trySceneExit();

  const rest = atRestPoint();
  if (rest) { healPartner(); state.dialogueQueue.push("..."); }
}
```

## Common mistakes

- ❌ Pushing dialogue from a tight loop (e.g. every collision) — queue overflows + game freezes on ESC spam
- ❌ Forgetting to check `dialogueVisible()` before triggering new interaction — overlapping boxes
- ❌ Hardcoding NPC lines in interaction.js — use `data/npc-strings.json` for localizability
- ❌ Pushing post-battle dialogue THEN starting transition — order means dialogue shows during fade, looks broken
- ❌ Long string with `\n` instead of array — text box doesn't auto-page properly

## Reference

`D:/Sengoku-Era-ogf/src/dialogue.js` (194 LOC).

Key functions:
- `showDialogue(text)` — set DOM text + reveal panel
- `advanceDialogue()` — pop next or hide
- `dialogueVisible()` — current state check
- `setPanels()` — toggle DOM visibility per state.mode

Plus `interaction.js` (160 LOC) for the NPC-interact integration.

## Files NOT in this recipe

- Bigger menu navigation → `recipe-menu-stack.md`
- In-battle commands → `recipe-battle-turn-based.md`
- Save UI confirmation → `recipe-save-load.md`
