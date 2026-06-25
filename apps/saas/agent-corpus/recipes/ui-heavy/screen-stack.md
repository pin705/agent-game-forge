# Recipe — Screen / mode stack

Implements the spine of every ui-heavy game: a stack of screens (menu, play,
result, pause overlay) with push / pop / replace, per-screen lifecycle hooks
(`enter` / `update` / `render` / `onClick` / `onKey`), and dimmed overlays.
This is the vanilla-JS port of OpenGame's `TurnManager` phase engine,
generalized from "turn phases" to "the whole app's screens."

## When to use

- ANY ui-heavy game (card-battler, visual-novel, quiz, clicker) — this is the
  engine spine all of them sit on
- You have ≥3 screens (title → play → result) and want clean transitions
- You want overlays (pause, confirm dialog, level-up card pick) that pause and
  dim the screen underneath without destroying it

## When NOT to use

- **Single-screen toy** (one static board, no menu/result) — skip the stack,
  just run one `update`/`render` pair. Adding a stack for one screen is
  over-engineering.
- **Scrolling-level game** (side-scroll, top-down RPG) — that's `src/scene.js`
  switching levels with a camera, NOT this. Screens here have no world/camera.
- **You need true concurrent screens** (split-screen, two live panels) — the
  stack assumes one *active* screen at a time (overlays render the screen below
  but only the top receives input). Fork if you need both halves live.

## Files this affects

- `src/screens.js` — the stack + registry (this recipe, ~150-300 LOC)
- `src/state.js` — add `state.screens = []` (the stack) and `state.screenDefs`
- `data/screens.json` — IDENTITY: which screens exist, type, and the first one
- `src/game.js` — main loop calls `updateTopScreen(dt)` + `renderScreens(ctx)`
- `src/input.js` — routes click/key to the top screen's `onClick`/`onKey`

## Pattern

### 1. Screen registry (`data/screens.json`)

```json
{
  "first": "menu",
  "screens": [
    { "id": "menu",   "type": "menu",   "title": "Castle Gate" },
    { "id": "battle", "type": "battle", "enemy": "gate_guard", "bg": "assets/bg/gate.png" },
    { "id": "result", "type": "result" },
    { "id": "pause",  "type": "overlay" }
  ]
}
```

Every entry has an `id` (the editor's primary key — `common.md` §"JSON entry
contract"). `type` selects which screen object handles it. This is data so the
editor + the user can add/reorder screens without touching code.

### 2. A screen is an object with lifecycle hooks

Each screen is a plain object (or a factory returning one). Implement only the
hooks you need; the stack calls them:

```js
// src/screens.js — a screen "class" shape (no framework, plain object factory)
function makeMenuScreen(def) {
  return {
    id: def.id,
    type: "menu",
    isOverlay: false,        // true → render the screen below + dim it
    buttons: [],             // interactive regions, populated in enter()

    enter() {                // called once when pushed
      this.buttons = [
        { id: "start", rect: { x: 412, y: 360, w: 200, h: 64 }, label: "Start" },
        { id: "quit",  rect: { x: 412, y: 440, w: 200, h: 64 }, label: "Quit"  },
      ];
      playSfx("ui_open");
    },

    update(dt) {},           // per-frame (animate title, pulse button)

    render(ctx) {            // draw the screen
      ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      drawTitle(ctx, def.title);
      for (const b of this.buttons) drawButton(ctx, b.rect, b.label, hoverId === b.id);
    },

    onClick(x, y) {          // a click hit-tested against buttons
      const b = this.buttons.find(b => pointInRect({ x, y }, b.rect));
      if (!b) return;
      if (b.id === "start") replaceScreen("battle");   // menu → battle
      if (b.id === "quit")  popScreen();
    },

    onKey(key) {             // keyboard fallback
      if (key === "Enter") replaceScreen("battle");
    },

    exit() {},               // called once when popped/replaced off
  };
}
```

`battle` / `result` / `clicker` screens follow the same shape — their `update`
runs the turn FSM / accrues income, their `render` draws the board, their
`onClick` resolves card/option/upgrade hits. The card-battler + dialogue
recipes plug their logic into exactly these hooks.

### 3. The stack operations

```js
// src/screens.js
// state.screens is the stack; the LAST element is active/top.

function topScreen() {
  return state.screens[state.screens.length - 1] || null;
}

function makeScreen(id) {
  const def = state.screenDefs.find(d => d.id === id);
  if (!def) { console.warn("[screens] unknown screen:", id); return null; }
  switch (def.type) {
    case "menu":    return makeMenuScreen(def);
    case "battle":  return makeBattleScreen(def);
    case "result":  return makeResultScreen(def);
    case "clicker": return makeClickerScreen(def);
    case "overlay": return makeOverlayScreen(def);   // e.g. pause
    default:        return makeMenuScreen(def);
  }
}

function pushScreen(id) {                 // add on top (keeps what's below)
  const s = makeScreen(id);
  if (!s) return;
  state.screens.push(s);
  s.enter && s.enter();
}

function popScreen() {                    // remove top, resume the one below
  const s = state.screens.pop();
  s && s.exit && s.exit();
  const below = topScreen();
  // below keeps its state — do NOT re-enter() it (that would reset it).
}

function replaceScreen(id) {              // swap top out for a new screen
  popScreen();
  pushScreen(id);
}

function resetTo(id) {                    // wipe stack, start fresh (new run)
  while (state.screens.length) popScreen();
  pushScreen(id);
}
```

`push` for overlays (pause/confirm) — the screen below survives. `replace` for
flow transitions (menu → battle → result) where you don't want "back". `resetTo`
to start a new run.

### 4. Main loop wiring (`src/game.js`)

```js
function updateTopScreen(dt) {
  const s = topScreen();
  s && s.update && s.update(dt);
}

function renderScreens(ctx) {
  // Render from the bottom up, but only the topmost NON-overlay screen and any
  // overlays above it. Simplest correct rule: find the lowest screen we must
  // draw (the top non-overlay), then draw it + everything above.
  let base = state.screens.length - 1;
  while (base > 0 && state.screens[base].isOverlay) base--;
  for (let i = base; i < state.screens.length; i++) {
    const s = state.screens[i];
    if (s.isOverlay) { ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0,0,VIEW.w,VIEW.h); }
    s.render && s.render(ctx);
  }
}

// in the rAF loop:
//   updateTopScreen(dt);
//   ctx.clearRect(0,0,VIEW.w,VIEW.h);
//   renderScreens(ctx);
```

### 5. Input routing (`src/input.js`)

```js
canvas.addEventListener("pointerdown", (e) => {
  const { x, y } = canvasPoint(e);          // map client coords → canvas coords
  const s = topScreen();
  s && s.onClick && s.onClick(x, y);        // only the TOP screen gets clicks
});

window.addEventListener("keydown", (e) => {
  const s = topScreen();
  if (e.key === "Escape") { togglePause(); return; }   // global
  s && s.onKey && s.onKey(e.key);
});

function togglePause() {
  if (topScreen()?.type === "overlay") popScreen();     // unpause
  else if (topScreen()?.type === "battle" || topScreen()?.type === "clicker")
    pushScreen("pause");                                // pause overlay
}
```

Only the top screen receives input — overlays correctly block the screen below.

> **DOM-overlay / hybrid note**: if `render_mode` is `dom-overlay`, each screen's
> `enter()` builds its `<button>`/`<div>` elements and appends them to
> `#ui-root`; `exit()` removes them; `render()` is a no-op (or only paints the
> canvas background). Wire each button's `addEventListener('click', ...)` to the
> same handler `onClick` would call. The stack logic is identical — only the
> paint/teardown changes. Keep `#ui-root` z-index above the canvas.

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| Screen list | `data/screens.json` | Which screens exist + first screen |
| Transition style | `screens.js` push/pop | Add a fade timer in a `transition` overlay for cross-fades |
| Overlay dim | `renderScreens` | `rgba` alpha of the dim behind overlays |
| `enter`-on-resume | `popScreen` | If a screen SHOULD reset when revealed, call its `enter()` in `popScreen` (default: don't — preserve state) |

## Common mistakes

1. **`enter()`-ing the screen below on pop** — resuming from pause re-runs the
   battle's `enter`, resetting HP/hand. `popScreen` must NOT re-enter the
   revealed screen; it kept its state the whole time underneath.
2. **Routing input to all screens** — overlays must block. Send click/key only
   to `topScreen()`, never iterate the stack for input.
3. **Rendering only the top screen** — then a pause overlay shows on a black
   void instead of the dimmed battle. Render from the top non-overlay up.
4. **`replace` where you meant `push` (or vice versa)** — `replace` for flow
   (no back button); `push` for overlays (resumable). Mixing them either loses
   resume-ability or leaks screens onto the stack.
5. **Storing screen state in module globals** — two battle screens (or a
   restart) then share/clobber state. Keep per-screen state on the screen
   object; keep cross-screen data (HP between battles, flags) on `state`.
6. **Forgetting `id` on screens.json entries** — editor can't address them.

## Reference

OpenGame `src/systems/TurnManager.ts` — the phase-stack idea (start / nextPhase
/ goToPhase / enter+exit callbacks) this generalizes from turn-phases to
app-screens. Architectural shape mirrors `D:/Sengoku-Era-ogf/src/scene.js`
(switch + per-mode dispatch), minus the camera/world.
