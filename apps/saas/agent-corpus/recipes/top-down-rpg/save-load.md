# Recipe — localStorage save with version migration

Auto-save on state changes, load on game boot, migrate old save shapes via per-version migrator functions.

## When to use

- Single-player game with persistent progress (party, inventory, story flags)
- Local-only (no cloud sync) — fits indie / browser-game scope
- Save schema will evolve over time (you'll add new state fields)
- One save slot is enough (multi-slot adds complexity not covered here)

## When NOT to use

- Multiplayer (use server-side persistence)
- Pure arcade games with no progress (high-score-only is a different recipe)
- Game expected to outlive multiple browser cache clears (use IndexedDB or backend)

## Files this affects

- `src/progression.js` — `saveGame()` + `loadSave()` + `migrateSave()` + `MIGRATIONS` table
- `src/config.js` / `runtime.json` — save key constants (`saveKeys.current` / `.previous` / `.old`)
- `src/state.js` — fields that get serialized
- `src/dialogue.js` — reset state on "new game" wipes localStorage

## Dependencies on foundation

```js
state.partnerId, state.scene, state.flags, state.player.x/y,
state.partnerProgress, state.partnerHp, state.ownedMitama,
state.inventory, state.seenDex
```

`SAVE_KEY` / `PREVIOUS_SAVE_KEY` / `OLD_SAVE_KEY` constants from `config.js`, populated from `runtime.json::saveKeys`.

## Pattern — save shape + version

```js
const SAVE_VERSION = 5;

function saveGame() {
  if (!state.partnerId) return; // don't save before player picks starter
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    version: SAVE_VERSION,
    partnerId: state.partnerId,
    scene: state.scene,
    flags: state.flags || {},
    x: state.player.x, y: state.player.y,
    progress: state.partnerProgress,
    hp: state.partnerHp,
    ownedMitama: state.ownedMitama,
    inventory: state.inventory,
    seenDex: state.seenDex,
  }));
  state.lastSavedAt = performance.now();
  updateHud();   // optional "saved" indicator flash
}
```

## Pattern — migration chain

When you change save shape, bump SAVE_VERSION and add a migrator:

```js
function migrateSave(data) {
  let v = Number.isInteger(data.version) ? data.version : 3;
  let out = { ...data };
  while (v < SAVE_VERSION) {
    const migrator = MIGRATIONS[v];
    if (!migrator) break;
    out = migrator(out);
    v += 1;
  }
  out.version = SAVE_VERSION;
  return out;
}

const MIGRATIONS = {
  3: (data) => ({ ...data }),                           // no shape change
  4: (data) => {                                         // collapse 8 booleans into flags{}
    if (data.flags && typeof data.flags === "object") return data;
    const flags = {};
    const legacy = [
      ["defeatedGate", "gate"],
      ["defeatedBoss", "boss"],
      // ...
    ];
    for (const [oldKey, newKey] of legacy) {
      if (data[oldKey]) flags[newKey] = true;
    }
    const out = { ...data, flags };
    for (const [oldKey] of legacy) delete out[oldKey];
    return out;
  },
  // 5: (data) => { ... future migration ... }
};
```

## Pattern — load with fallback + migration

```js
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
      || localStorage.getItem(PREVIOUS_SAVE_KEY)
      || localStorage.getItem(OLD_SAVE_KEY);
    if (!raw) return false;
    const data = migrateSave(JSON.parse(raw));
    if (!data || !mitamaById(data.partnerId)) return false; // sanity check
    // ... copy data.* into state.*
    return true;
  } catch {
    return false; // corrupt save = treat as no save
  }
}
```

## Auto-save triggers

Call `saveGame()` from points where state meaningfully changes:

| Trigger | Where |
|---|---|
| After battle ends (any result) | battle.js finishBattle |
| After scene transition | scene.js setScene |
| After picking starter | dialogue.js chooseStarter |
| After resting (HP heal) | interaction.js healPartner |
| After picking up an item | overworld.js / interaction.js |
| Manual quick-save | input.js Q key |
| After menu actions (use item, switch partner) | menu.js |

Don't call `saveGame()` every frame or every step — localStorage writes are not free, and a tab-close should still work via the most recent meaningful event.

## Adaptation knobs

| Knob | Where | Notes |
|---|---|---|
| Save key string | `runtime.json::saveKeys.current` | Bump suffix on schema reset |
| Auto-save HUD indicator | dialogue.js updateHud | Optional flash text |
| Quick-save key | input.js | `Q` default |
| Multi-slot support | NOT in this recipe | Would need slot picker UI + per-slot key |

## Common mistakes

- ❌ Saving before partnerId is set — load tries to look up undefined partner, fails silently
- ❌ Calling saveGame() inside requestAnimationFrame — write thrashing
- ❌ No try/catch around JSON.parse — corrupt save crashes the game
- ❌ Storing huge state (every NPC's per-frame mood) — localStorage has 5-10MB cap; keep save under 100KB
- ❌ Migration that throws on missing fields — always default-coalesce: `data.foo ?? defaultValue`
- ❌ Renaming SAVE_KEY without migration path — players lose all progress
- ❌ Storing computed values (current XP-to-next-level) — recompute from base on load instead

## Reference

`D:/Sengoku-Era-ogf/src/progression.js` lines 224-306.

Key items:
- `SAVE_VERSION` constant (line 254)
- `MIGRATIONS` table (line 277-303)
- `migrateSave()` chain runner (line 256-273)
- `saveGame()` shape (line 231-250)
- `loadSave()` with fallback chain + migration (line 305+)

## Files NOT in this recipe

- State shape itself → `src/state.js` is the source of truth
- Save UI / "saved!" flash → `recipe-menu-stack.md` (settings panel) + `recipe-dialogue-box.md` (toast)
- Cloud sync / multi-device → not in OGF scope
