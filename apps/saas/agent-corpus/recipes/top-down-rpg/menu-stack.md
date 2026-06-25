# Recipe — Stack-based menu navigation

Modal menu system for "press M to open party / inventory / dex / save / settings". Stack-based so submenus can push (item detail view, switch confirm) and pop back cleanly.

## When to use

- Player needs to view roster, swap active partner, check stats, use field items
- Battle has a "switch partner" submenu that pushes onto the stack
- Game has a save/load entry from the menu
- Genre is RPG / monster-tamer / sim — anything with rich state to inspect

## When NOT to use

- Action games where pause = "press P, show big PAUSED text" — just an overlay, no nav
- Roguelike with hotkey-driven inventory (`i`/`d`/`u`) — no menu, direct keys
- Mobile-first game where you can rely on always-visible HUD instead of modal

## Files this affects

- `src/menu.js` — main implementation (~450 LOC reference; can shrink to ~200 for simpler games)
- `src/dom.js` — DOM refs to menu HTML elements
- `src/input.js` — routes Up/Down/Enter/Escape to menu when `state.mode === "menu"`
- `index.html` — menu container HTML structure
- `styles.css` — menu styling (panels, list items, focus state)

## Dependencies on foundation

```js
state.mode === "menu"   // main loop dispatches menu update + render
state.menuIndex          // current item in current menu
state.menuSubIndex       // current item in submenu (when pushed)
state.menuDetail         // payload for detail view (e.g. selected mitama id)
state.menuMessage        // bottom-of-menu transient feedback ("HP restored.")
```

`dialogue.setPanels()` toggles which DOM panel is visible per state.mode.

## Pattern — menu stack

Conceptually a stack of menu screens. Real implementation uses a discriminated union via `state.menu*` fields:

```
[menu opened]                    state.menuIndex selects top-level entry
  ↓ Enter on "御魂編成"
[party screen]                   state.menuSubIndex picks a partner
  ↓ Enter on a partner
[partner detail]                 state.menuDetail = partnerId
  ↓ Enter on "切換為出戰御魂"
{action} → state.partnerId = X, refresh menu
  ↓ Esc / Back
[party screen]
  ↓ Esc
[menu opened]
  ↓ Esc
[overworld]   state.mode = "overworld"
```

Don't actually maintain a stack array — just track `menuIndex / menuSubIndex / menuDetail` and let `renderMenu()` dispatch on which is set.

## Top-level menu entries (typical)

```js
const MAIN_ENTRIES = [
  { id: "party",     label: "御魂編成",    handler: openParty },
  { id: "inventory", label: "道具",        handler: openInventory },
  { id: "dex",       label: "圖鑑",        handler: openDex },
  { id: "save",      label: "存檔",        handler: () => { saveGame(); flash("已存檔"); } },
  { id: "settings",  label: "設定",        handler: openSettings },
  { id: "close",     label: "關閉選單",    handler: closeMenu },
];
```

Add/remove entries per genre. A pure-exploration sandbox might drop "御魂編成" entirely.

## Battle-internal switch (special case)

When player picks "換御魂" mid-battle, push a transient "switch list" sub-menu over the battle screen. Vanilla Sengoku pattern:

```js
// In battle.js
function openBattleSwitch(force = false, message = "") {
  state.battle.switching = true;
  state.battle.forceSwitch = force;        // true = ally fainted, must switch
  state.battle.switchMessage = message;
  state.battleSwitchIndex = 0;
}

function switchBattlePartner() {
  // Selected from battleSwitchIndex
  // Save outgoing partner's HP back to state.partnerHp
  // Update state.partnerId, state.battle.ally
  // Spawn FX, play sfx, queue enemy turn (unless force-switched)
}

function cancelBattleSwitch() {
  if (state.battle.forceSwitch) return; // can't cancel a forced switch
  state.battle.switching = false;
}
```

## Adaptation knobs

| Behavior | Where | Default |
|---|---|---|
| Menu key | input.js | `M` or `Esc` |
| Open animation | dialogue.js setPanels | hide HUD, show menu panel |
| Item categorization | items.json `use` field | `"field"` shown here, `"battle"` shown in battle |
| Sort order in dex | menu.js `enemyKnown()` | seen / owned / boss-defeated triggers visibility |
| Save key shortcut | input.js | `Q` for quick-save |

## Common mistakes

- ❌ Multiple modal layers without a stack — clicking Esc jumps you 3 levels back unexpectedly
- ❌ Deep prop drilling instead of using `state.menu*` — every onClick handler re-passes context
- ❌ Forgetting to call `setPanels()` on mode change — overworld HUD shows over menu
- ❌ Inventory list shows items with count 0 — filter out via `inventoryCount(id) > 0`
- ❌ Dex showing all monsters from start instead of unlocked-by-encounter
- ❌ Save UI rendering "Save" as a Function-call without confirming completion (race with localStorage write)

## Reference

`D:/Sengoku-Era-ogf/src/menu.js` (454 LOC, MIT-style permissive).

Key functions:
- `openMenu()` / `closeMenu()` — mode entry/exit
- `renderMenu()` — top-level dispatch on menuIndex/menuSubIndex/menuDetail
- `enemyKnown(enemy)` — dex visibility logic (seenDex / ownedMitama / boss flags)
- `useSelectedItem()` — applies field item effect, refreshes UI

Lines worth reading top-to-bottom:
- 1-50 (entry shape + close)
- 100-180 (party list + partner detail)
- 200-260 (inventory + use item)
- 280-360 (dex with form/stage gating)

## Files NOT in this recipe

- Save persistence → `recipe-save-load.md`
- XP / level / evolution rules → `recipe-progression.md`
- Battle FSM (switch partner is wired here, but battle loop is) → `recipe-battle-turn-based.md`
