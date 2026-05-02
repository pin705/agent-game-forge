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

### File layout
\`\`\`
index.html
styles.css
src/
  game.js                   ← main entry; load data, run loop, render
  level.js                  ← (optional) level loading helper
  player.js / enemy.js      ← gameplay modules
data/
  levels.json               ← list of level ids → file
  <level-id>.json           ← one file per level (see schema below)
  enemies.json              ← catalog
  heroes.json
  items.json
assets/
  maps/<level-id>.png       ← background per level
  sprites/<thing>/...
  sounds/...
\`\`\`

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

### Code patterns

- \`game.js\` should fetch level JSON at runtime:
  \`\`\`js
  const data = await fetch('data/temple.json').then(r => r.json());
  ctx.drawImage(await loadImage(data.background), 0, 0);
  for (const b of data.blockers) drawShape(b);
  \`\`\`
- Don't hardcode coordinates in \`game.js\`. They go in the level JSON.
- Catalogs (\`enemies.json\`, \`items.json\`) are array-of-objects; load once
  at boot, look up by id at runtime.
- Keep \`game.js\` modular. If it grows past ~600 lines, split into
  \`level.js\` / \`player.js\` / \`combat.js\` etc.

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
