// OGF project conventions — written verbatim into <project>/.ogf/conventions.md
// at New-Project scaffold time. Read by composePrompt every turn so Codex
// stays consistent with the structure OGF can edit visually.
//
// One template per engine. Cross-engine rules at the top, engine-specific
// section underneath.

const COMMON = `# OGF project conventions

This file is the contract between Codex and the in-app editor. The editor
shows / edits things in this layout; Codex must keep producing them in this
layout so the visual editor stays useful.

## The contract — short version

1. **Data and code are separate.** Numbers (HP, damage, prices, wave counts,
   anchor positions, prop layouts) live in JSON under \`data/\`. Never inline
   gameplay data into source files.
2. **Spatial data uses canonical shapes.** Each shape has a fixed schema:
   - point: \`{ "x": <num>, "y": <num> }\`
   - rect:  \`{ "x", "y", "w", "h" }\`  (top-left + size)
   - circle: \`{ "x", "y", "radius" }\`
   - polygon: \`{ "points": [[x,y], [x,y], ...] }\`
   Always use these field names; do not invent variants.
3. **One level / one screen → one data file.** Every editable level has its
   own JSON in \`data/\` so the user can open and tweak it independently.
4. **assets/ is for raw files**, **data/ is for structured files**. Generated
   sprites land under \`assets/\`. Their per-asset metadata (slicing,
   anchors) goes in \`data/\` if it needs editing, or as sidecar JSON next to
   the asset if it's purely build-time.
5. **One source of truth.** Don't store the same fact in two places (e.g.
   prop position both in a .tscn and a JSON). Pick one.

## Catalogs

Catalogs are arrays-of-objects. Use them for: enemy types, hero types, tower
types, items, abilities, dialogue lines.

\`\`\`json
[
  { "id": "scout", "hp": 42, "speed": 128, "sprite": "assets/enemies/scout/sheet.png" },
  { "id": "grunt", "hp": 82, "speed": 92, "sprite": "assets/enemies/grunt/sheet.png" }
]
\`\`\`

Top-level array OR wrapped in \`{ "<plural>": [...] }\` are both fine; OGF
detects either.

## Wave / event timelines

If your game has wave-based or time-based events, store them as
array-of-objects with a \`delay\` (or \`time\`) field per entry:

\`\`\`json
{
  "waves": [
    { "delay": 1.0, "groups": [{ "type": "scout", "count": 8, "interval": 0.6 }] },
    { "delay": 5.0, "groups": [...] }
  ]
}
\`\`\`

Object form (not array of arrays). OGF will offer a timeline editor for any
array-of-objects with a recognized time field.

## Image generation skill (Codex)

For sprite / animation assets, USE the **\`generate2dsprite\`** Codex skill.
It handles image_gen + chroma key + frame slicing. Don't roll your own.

For maps and tiles / props, USE the **\`generate2dmap\`** skill. It picks the
right pipeline (baked / layered / tilemap) and emits OGF-compatible JSON.

When the user asks "make me a slime", reach for these skills before writing
custom image_gen prompts.

## Read the live state before answering spatial questions

OGF writes the user's current scene state to \`.ogf/scene-context.json\` on
every drag / select / scene change. When the user asks "this prop", "the
selected zone", or refers to anything by visual position, read that file
first.
`;

const GODOT = `## Godot 4 specifics

### File layout
\`\`\`
project.godot
scenes/
  Main.tscn                 ← run/main_scene; the runtime entry
  prefabs/
    Enemy.tscn
    Hero.tscn
    Tower.tscn
scripts/
  Main.gd
  Enemy.gd
  ...
data/
  enemies.json              ← catalog
  heroes.json
  towers.json
  waves.json
  <level>/
    collision.json          ← { blockers, buildZones, enemyPaths, entrances, goals, heroSpawn }
    props.json              ← array of { id, image, x, y, w, h, sortY }
assets/
  map/
  props/
  enemies/
  ui/
\`\`\`

### Scene patterns — use Godot's built-in node types

| Need | USE | DO NOT use |
|---|---|---|
| Enemy walking path | **Path2D + Curve2D** | Node2D + custom MapEditPathPoint script |
| Trigger area / zone | **Area2D + CollisionShape2D** | Custom Node2D + script |
| Solid blocker | **StaticBody2D + CollisionShape2D / CollisionPolygon2D** | Same |
| Spawn point | **Marker2D** | Empty Node2D |
| Single sprite prop | **Sprite2D** as a direct child of a grouping Node2D | Node2D wrapper around a Sprite2D when there's no extra logic |

### Avoid \`@tool\` for gameplay

\`@tool\` scripts run in the editor too. Use them ONLY for editor-time
visualization (e.g. drawing a guide). Never put gameplay logic behind \`@tool\`
— at runtime it confuses everything.

### Loading data

Use the standard pattern:

\`\`\`gdscript
const ENEMY_DATA := "res://data/enemies.json"

func _ready() -> void:
    var enemies = _load_json(ENEMY_DATA)
    for e in enemies:
        # spawn / register / whatever
        pass

func _load_json(path: String) -> Variant:
    var text := FileAccess.get_file_as_string(path)
    return JSON.parse_string(text)
\`\`\`

Don't write the catalog inline as a literal in the .gd file — OGF can edit
the JSON, can't edit the inline literal.

### Project setup defaults

\`project.godot\` should declare:
\`\`\`
[application]
config/name="<your game>"
run/main_scene="res://scenes/Main.tscn"
config/features=PackedStringArray("4.5")
\`\`\`
`;

const WEB = `## Web (Canvas 2D + vanilla JS) specifics

### File layout — modular by responsibility

The bootstrap scaffolds a minimal split that's the OGF contract: each module
owns one job, stays under ~300 lines, and is independently understandable.
Add new modules as the game grows — don't fold new responsibilities into an
existing module to "save a file".

\`\`\`
index.html
styles.css
src/
  game.js                   ← entry: boot + frame loop. STAYS SMALL (<60 lines).
  scene.js                  ← level JSON loading, scene state, draw dispatch
  render.js                 ← camera (sx/sy), background + props draw primitives
  input.js                  ← keyboard/mouse → poll-able intent surface
  assets.js                 ← loadJSON / loadImage helpers (no game state)
  collision.js              ← ADD when checking blockers/walkBounds at runtime
  battle.js                 ← ADD when introducing a combat scene / state machine
  ui.js                     ← ADD for HUD, dialogs, menus
  entities/
    player.js               ← ADD when player has its own update logic
    enemy.js                ← ADD when enemies have their own update logic
data/
  levels.json               ← list of { id, file } — one entry per scene
  <level-id>.json           ← one file per scene (see schema below)
  enemies.json              ← catalog (array-of-objects)
  heroes.json
  items.json
  waves.json                ← (TD games) wave timeline
assets/
  maps/<level-id>.png       ← background per level
  props/<id>/prop.png       ← single sprite props
  sprites/<thing>/sheet.png ← multi-frame characters
  sounds/...
\`\`\`

**Why this split**: each module aligns with an OGF editor surface. \`scene.js\`
+ level JSON ↔ Scenes tab. Catalogs ↔ Table editor. \`waves.json\` ↔ Timeline
editor. Code that grows past 300 lines is a sign to split — pick the smallest
new module that lifts a single responsibility out (collision math, battle
state machine, an entity's update loop).

### \`data/levels.json\` is the level registry — keep it accurate

OGF uses \`data/levels.json\` to decide which JSON files are levels (open in
the Scenes tab as a draggable canvas) versus which are catalogs (open as a
table). If you add a new scene, add it to \`data/levels.json\` immediately.

Two equivalent shapes — both work, OGF parses either:

\`\`\`json
{
  "levels": [
    { "id": "outdoor", "file": "data/outdoor-collision-map.json" },
    { "id": "temple",  "file": "data/temple-collision-map.json"  }
  ]
}
\`\`\`

\`\`\`json
[
  { "id": "outdoor", "file": "data/outdoor-collision-map.json" },
  { "id": "temple",  "file": "data/temple-collision-map.json"  }
]
\`\`\`

Each entry MUST have at least \`id\` and \`file\`. Extra fields (display name,
mapKey, etc.) are fine — OGF ignores them but your game can use them.

Any \`data/*.json\` NOT listed here (enemies, items, audio-themes, assets) is
treated as a catalog and won't be routed to the Scenes tab. Don't store
gameplay numbers inside levels.json itself — it's a routing manifest only.

### Per-level JSON schema

Each level file has this shape (extra fields are fine):

\`\`\`json
{
  "id": "temple",
  "background": "assets/maps/temple.png",
  "mapSize": { "width": 1672, "height": 941 },
  "spawn":   { "x": 836, "y": 782 },
  "exits":   { "<id>": { "x", "y", "interactRadius", "target", "spawn": { "x", "y" } } },
  "zones":   { "<id>": { "x", "y", "w", "h" } },
  "walkBounds": [ { "id", "type": "rect" | "ellipse", "x", "y", ...} ],
  "blockers":   [ { "id", "type", "x", "y", "w", "h" | "rx", "ry" } ],
  "spawn_points": [ { "id", "x", "y", "facing"? } ],
  "props":     [ { "id", "image", "x", "y", "w", "h", "sortY"? } ]
}
\`\`\`

OGF will render the \`background\` image, then overlay every shape from this
file with the correct semantic color. The user drags a shape → OGF rewrites
the JSON in place.

### Anchor conventions

- **Props** use a **bottom-center** anchor: \`(p.x, p.y)\` = (horizontal center,
  feet / ground line). Renders as
  \`ctx.drawImage(img, p.x - p.w/2, p.y - p.h, p.w, p.h)\`. This matches how
  characters stand on the ground and how OGF drags them.
- **Rects / blockers / walkBounds** use **top-left** anchor: \`(x, y)\` = upper-left
  corner, plus \`w\`, \`h\`.
- **Points** (spawn, exits, goals) are just \`{ x, y }\` with no anchor concept.
- \`sortY\` (optional) is the y used for back-to-front draw order; defaults
  to \`y\`. Use it when the visual feet sit above the collision feet (e.g.
  a shrine whose roof should sort behind a tree even though its base is in
  front).

### Code patterns

- **Level JSON is loaded from disk every boot. Never hardcode coordinates,
  prop lists, or catalogs in JS.** The whole point of the JSON layout is
  that OGF (or the user, or Codex) can edit data/\\*.json and the next
  reload sees the change with zero code edits. If you find yourself writing
  a literal array of \`{ x, y, image }\` in a .js file — STOP and put it in a
  level/catalog JSON instead.

  \`\`\`js
  // scene.js
  const level = await loadJSON('data/temple.json');
  for (const p of level.props) {
    ctx.drawImage(images[p.image], p.x - p.w/2, p.y - p.h, p.w, p.h);
  }
  \`\`\`

- Pre-load every \`props[*].image\` into an \`images\` map keyed by the
  path string itself; look up via \`images[p.image]\` at draw time.
- Catalogs (\`enemies.json\`, \`items.json\`) are array-of-objects; load once
  at boot, look up by id at runtime.

### Module split rules (when to break out a new file)

The bootstrap ships with five files (\`game / scene / render / input /
assets\`). Add another when ANY of these is true:

- A module exceeds ~300 lines.
- You're about to add a second responsibility to an existing module
  (e.g. combat math creeping into scene.js → split into \`battle.js\`).
- You're adding a poll-able state machine (battle, dialog, menu) — give
  it its own module so the loop in game.js stays a one-line dispatch.
- An entity has its own update loop / per-frame logic — promote it to
  \`entities/<thing>.js\`.

DON'T pre-create empty files for "future" modules. Add them when the
threshold trips, not before.

The bootstrap's \`src/game.js\` is intentionally tiny (boot + dispatch loop).
Don't grow it. New work goes in scene.js or its own module.

### Image generation

Same skills as Godot:
- \`generate2dsprite\` for character / enemy / item sprites
- \`generate2dmap\` for backgrounds + props

The generated assets land under \`assets/\`; you wire them into the level
JSONs by editing \`background\` / \`props[*].image\` etc.

### What NOT to do

- ❌ WebGL / Three.js for new projects (much harder to visually edit)
- ❌ Physics engines for V1 — own the simple AABB / circle math
- ❌ Bundlers / build steps unless asked — OGF assumes the project is
  serve-able as a static folder
`;

export function godotConventions(): string {
  return COMMON + '\n' + GODOT;
}

export function webConventions(): string {
  return COMMON + '\n' + WEB;
}

/** Loaded by composePrompt — short summary, not the full doc. The full doc
 *  is in .ogf/conventions.md if Codex needs to re-read it. */
export function summarizeConventions(): string {
  return `# OGF conventions (full doc at .ogf/conventions.md)

- Data and code SEPARATE. Numbers in JSON under data/. Never inline.
- Shapes use canonical fields: { x, y } / { x, y, w, h } / { x, y, radius } /
  { points: [[x,y]...] }. No variants.
- One level per JSON file.
- For sprites use the \`generate2dsprite\` Codex skill; for maps use
  \`generate2dmap\`. They handle image_gen + post-processing.
- Live editor state is at .ogf/scene-context.json — cat it for spatial info.

Engine-specific rules in .ogf/conventions.md (read it when starting fresh
work or when you'd otherwise pick a non-standard pattern).`;
}
