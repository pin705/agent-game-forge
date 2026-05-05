# Genre Support Matrix

Living doc — updated as we run each genre through the demo gauntlet.

## Status legend

- ✅ — works end-to-end, considered shippable
- ⚠️ — partial; explained in notes
- ❌ — not yet supported
- 🚧 — actively being worked on
- — — out of scope / agent-only

Columns:
- **Spec** — agent can write a coherent `.ogf/spec.md` for this genre
- **Assets** — `generate2dsprite` + `generate2dmap` produce usable art
- **Editor render** — OGF Scenes tab can display the level
- **Drag edit** — user can move / rotate / resize objects on the canvas
- **Play** — game runs in OGF's Play tab (web) or via Godot launcher
- **Export** — standalone HTML / Steam / itch.io build
- **Notes** — gotchas and what's blocking the next ✅

---

## Tier A — Primary demo genres

Aim: every row green by end of Phase 2.

| Genre | Spec | Assets | Render | Drag | Play | Export | Notes |
|-------|------|--------|--------|------|------|--------|-------|
| **Tower Defense** | ✅ | ✅ | ✅ | ✅ | ✅ | 🚧 | OGF's home turf. Schema fits perfectly. Export still WIP. Sample: `samples/td-mvp/` (TBD) |
| **Top-down arena** | ✅ | ✅ | ✅ | ⚠️ | ✅ | 🚧 | Vampire Survivors-like. Wave timeline editor partial. |
| **Side-scrolling platformer** | ✅ | ⚠️ | ❌ | ⚠️ | ✅ | 🚧 | Parallax layers don't render in editor (single bg only). Agent generates layered art but OGF compresses to one. **Top blocker for this genre.** |

---

## Tier B — Stretch genres

Aim: green by end of Phase 3.

| Genre | Spec | Assets | Render | Drag | Play | Export | Notes |
|-------|------|--------|--------|------|------|--------|-------|
| **Top-down RPG** | ✅ | ✅ | ⚠️ | ❌ | ✅ | 🚧 | Tilemap renders as preview only, not editable. NPC dialog has no UI. |
| **Roguelike (room-based)** | ✅ | ✅ | ❌ | ❌ | ✅ | 🚧 | No multi-scene navigation. Each room would show up as separate file in tree but OGF has no concept of "this room connects to that room". |
| **Puzzle / match-3** | ✅ | ✅ | ❌ | ❌ | ✅ | 🚧 | Board state has no native editor. Agent can author the JSON but user can't drag-edit the grid. |

---

## Tier C — Long tail

Aim: agent-supported, editor support best-effort.

| Genre | Spec | Assets | Render | Drag | Play | Export | Notes |
|-------|------|--------|--------|------|------|--------|-------|
| **Bullet hell** | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | 🚧 | Spawn patterns are timeline-data-heavy. JS perf may struggle at 1000+ entities. |
| **Visual novel / point-and-click** | ✅ | ✅ | ⚠️ | ❌ | ✅ | 🚧 | Mostly single-bg + click hotspots, schema fits but no hotspot editor yet. |
| **Fighting** | ⚠️ | ⚠️ | ❌ | — | ⚠️ | ❌ | Frame data + per-frame hitboxes is its own animator. Probably agent-only forever. |
| **Tactical / grid RPG** | ⚠️ | ⚠️ | ❌ | — | ❌ | ❌ | Range / threat overlays + grid model is its own editor. Probably agent-only initially. |
| **Idle / clicker** | ✅ | ⚠️ | — | — | ✅ | 🚧 | UI-heavy, almost no spatial. Editor not really applicable; agent-only is fine. |
| **Rhythm / music** | ⚠️ | ⚠️ | ❌ | — | ❌ | ❌ | Timing precision out of OGF's wheelhouse. Agent-only. |

---

## How this doc gets updated

Every time we run a genre demo gauntlet:
1. Pick a genre
2. Run agent end-to-end
3. Test each column for that genre
4. Update the row, add notes for any ❌/⚠️
5. File issues for the blocking gaps

Don't update preemptively. Only update from real demos.

## Adding a new genre

If a user requests a genre not in the matrix:
1. Add a row in Tier C with all ❌
2. Run the agent on it once
3. Bump up to Tier B if the editor is reasonably close to working
4. Stay in Tier C if it would need a custom sub-editor

Genres can move between tiers as priorities shift.
