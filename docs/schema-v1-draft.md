# OGF Game Schema v1 — DRAFT

> ⚠️ **DRAFT.** Written before validating against agent output. Will be revised after Tier A test runs (platformer / arena / TD). Don't lock this in code yet.

This is the JSON shape the agent must produce so OGF can render and edit a game. The shape is framework-agnostic — runtime adapters (Phaser / vanilla / Godot) translate this into runtime code.

## Design principles for v1

1. **Match what the agent naturally writes.** Validate every field against actual agent output before locking.
2. **Universal across genres.** TD, platformer, RPG, arena should all fit this schema. Per-genre fields go in `extras` namespaces, not top-level.
3. **Editable means visible.** If a field can't be drag-edited, it's not in `level.json` — it's in catalogs (read-only-ish) or scripts (agent-only).
4. **No speculative fields.** Add to the schema only when a real test project demands it.

## Project file layout

```
project-root/
├── .ogf/
│   ├── spec.md              ← agent-authored project plan
│   ├── conventions.md       ← OGF rules (we write this on bootstrap)
│   ├── style-anchor.png     ← visual canon for image_gen reference chain
│   └── scene-context.json   ← live editor state (OGF writes this)
├── data/
│   ├── levels.json          ← registry: { id, file, displayName? }[]
│   ├── levels/
│   │   ├── level_1.json     ← OgfLevel (this schema)
│   │   ├── boss_room.json
│   │   └── ...
│   ├── actors.json          ← actor catalog (player + enemies + NPCs)
│   ├── props.json           ← prop catalog (static + interactive)
│   ├── animations.json      ← animation refs (sprite path, frame count, fps)
│   └── audio.json           ← audio cue catalog
├── assets/
│   ├── sprites/<id>/sheet.png + pipeline-meta.json
│   ├── maps/<level-id>/...  ← single image OR layered files
│   └── audio/...
└── src/
    ├── game.js              ← runtime entry (framework-specific)
    └── ...
```

## Level file (`data/levels/<id>.json`) — the editable unit

```ts
interface OgfLevel {
  /** Stable id, matches the file name. */
  id: string;

  /** Display name for OGF / in-game UI. */
  name: string;

  /** Logical viewport size. Game code uses this; renderer scales to fit window. */
  viewport: { width: number; height: number };

  /** How the level scrolls. */
  camera: {
    mode: 'locked' | 'horizontal-scroll' | 'vertical-scroll' | 'follow' | 'parallax';
    /** When mode='follow': the actor id to follow. */
    follow?: string;
    /** Pan limits — game shouldn't scroll past these. */
    bounds?: { x: number; y: number; w: number; h: number };
  };

  /** Visual + gameplay layers, ORDERED back-to-front. */
  layers: LayerSpec[];

  /** Actors placed in this level. Spawn-time only — runtime physics + AI move them. */
  actors: ActorPlacement[];

  /** Props placed in this level (drag-editable). */
  props: PropPlacement[];

  /** Trigger zones (door, encounter, hazard). */
  zones?: ZoneSpec[];

  /** Paths (TD enemy routes, NPC patrols). */
  paths?: PathSpec[];

  /** Scene transitions: where does this level connect to others? */
  exits?: ExitSpec[];

  /** Genre-specific extras the agent may need. OGF ignores unknown keys. */
  extras?: Record<string, unknown>;
}
```

### LayerSpec — visual + collision layers

```ts
type LayerSpec =
  | ImageLayer
  | TilemapLayer
  | PropsLayer
  | ColliderLayer;

interface ImageLayer {
  kind: 'image';
  id: string;
  /** -10 = far back, 0 = world, 10+ = foreground */
  zIndex: number;
  /** Project-relative PNG path. */
  image: string;
  /** Position within viewport (top-left). Default: (0,0). */
  position?: { x: number; y: number };
  /** Parallax scroll factor. 0 = static, 1 = scrolls 1:1 with camera. */
  parallax?: number;
  /** Repeat horizontally if camera scrolls past image width. */
  repeatX?: boolean;
}

interface TilemapLayer {
  kind: 'tilemap';
  id: string;
  zIndex: number;
  /** Tileset image path. */
  tileset: string;
  /** Tile dimensions in pixels. */
  tileSize: { w: number; h: number };
  /** Grid of tile indices, row-major. -1 = empty cell. */
  cells: number[][];
  /** Whether tiles in this layer block movement. */
  collidable?: boolean;
}

interface PropsLayer {
  kind: 'props';
  id: string;
  zIndex: number;
  /** Inline reference to props array, OR a filter rule for which props go here. */
  filter?: { tag?: string; ids?: string[] };
}

interface ColliderLayer {
  kind: 'collider';
  id: string;
  shapes: Array<
    | { kind: 'rect'; x: number; y: number; w: number; h: number; tag?: string }
    | { kind: 'circle'; x: number; y: number; r: number; tag?: string }
    | { kind: 'polygon'; points: [number, number][]; tag?: string }
  >;
}
```

### ActorPlacement — where an actor starts in this level

```ts
interface ActorPlacement {
  /** Unique within this level. */
  id: string;
  /** References data/actors.json entry. */
  actorId: string;
  /** Where the actor's anchor (typically feet) sits at level start. */
  position: { x: number; y: number };
  /** Initial facing direction. */
  facing?: 'left' | 'right' | 'up' | 'down';
  /** Initial animation state. Default: 'idle'. */
  state?: string;
  /** Per-actor overrides. */
  overrides?: { hp?: number; tag?: string };
}
```

### PropPlacement — drag-editable static / interactive prop

```ts
interface PropPlacement {
  id: string;
  /** References data/props.json entry. */
  propId: string;
  /** Bottom-center anchor (consistent with actor convention). */
  position: { x: number; y: number };
  /** Rotation in degrees, default 0. */
  rotation?: number;
  /** Scale, default 1. */
  scale?: number;
  /** Per-instance overrides. */
  overrides?: Record<string, unknown>;
}
```

### Other entities

```ts
interface PathSpec {
  id: string;
  /** Ordered point sequence. World coords. */
  points: { x: number; y: number }[];
  /** TD enemy paths use this; AI patrol paths might too. */
  tag?: string;
}

interface ZoneSpec {
  id: string;
  shape: { kind: 'rect'; x: number; y: number; w: number; h: number }
       | { kind: 'circle'; x: number; y: number; r: number };
  /** What happens when actor enters. */
  trigger?: 'encounter' | 'exit' | 'spawn' | 'checkpoint' | 'hazard' | 'custom';
  /** Trigger-specific data. */
  data?: Record<string, unknown>;
}

interface ExitSpec {
  /** Where in this level the exit is (the zone the player walks into). */
  zone: { x: number; y: number; w: number; h: number };
  /** Target level + spawn point. */
  toLevel: string;
  toSpawn?: { x: number; y: number };
}
```

## Catalogs

### `data/actors.json`

```ts
interface ActorDef {
  id: string;
  /** Generic role — informs AI defaults. */
  kind: 'player' | 'npc' | 'enemy' | 'boss';
  /** Animation refs by state name. */
  animations: Record<string, AnimationRef>;
  /** HP, speed, damage etc. — gameplay numbers. */
  stats?: Record<string, number>;
  /** Hitbox relative to anchor point. */
  hitbox?: { w: number; h: number; offsetX?: number; offsetY?: number };
}

interface AnimationRef {
  /** Project-relative sheet path. */
  sheet: string;
  /** Slicing — usually matches sidecar pipeline-meta.json. */
  cols: number;
  rows: number;
  /** Which row this animation is on (0-indexed). */
  row?: number;
  fps: number;
  loop?: boolean;
}
```

### `data/props.json`

```ts
interface PropDef {
  id: string;
  /** Project-relative image path. */
  image: string;
  /** Natural display size. */
  width: number;
  height: number;
  /** Center, bottom-center, top-left. */
  anchor: 'center' | 'bottom' | 'top-left';
  /** Static (no interaction) or interactive (chest, door, etc). */
  kind: 'static' | 'interactive';
  /** Hitbox if interactive. */
  hitbox?: { w: number; h: number };
}
```

## Open questions (validate via test runs)

These are unknowns I'd need to see agent output to resolve.

### Q1: How does agent NAME files?
- `level_1.json` vs `mountain_pass.json`?
- `levels/main.json` vs `levels/main_level.json`?
- → Read what the agent picks; lock convention to its natural choice.

### Q2: Does agent inline OR reference animations?
- Inline: actor has `animations: { idle: { sheet: "...", fps: 8 } }` directly
- Reference: actor has `animationGroupId: "ronin"` pointing to `animations.json`
- → Inline is simpler; reference enables sharing. See what agent does.

### Q3: Does agent split layers when generate2dmap returns parallax?
- Hopeful: agent produces `layers: [{ kind:'image', image:'maps/sky.png', parallax:0.2 }, ...]`
- Worst: agent dumps all layers into one image, ignores skill output
- → This IS what we're testing on the platformer run.

### Q4: Tile vs free-position layout?
- TD: free position
- RPG / platformer: tile-aligned
- → Schema supports both. See if agent reaches for tilemap when appropriate.

### Q5: Where does collision live?
- Inline in level (current contracts)
- Sidecar `collision.json`
- Implicit via tilemap.collidable
- → Probably all three for different cases. See agent preference.

### Q6: How does agent reference image_gen output?
- `assets/sprites/scout/sheet.png`?
- `assets/sprites/scout/idle.png` + `walk.png` + ...?
- → Skill controls this — read pipeline-meta.json for actual structure.

### Q7: Where do scripts live?
- `src/game.js` entry — agreed
- Per-actor: `src/entities/scout.js`?
- Per-level: `src/scenes/level_1.js`?
- → Convention already tries to dictate this; see if agent follows.

### Q8: What about UI?
- HP bar, score, inventory — not in level json
- Probably `data/hud.json` or similar
- → Open question; HUD might just be code initially.

## Migration from current SceneModel

Current `packages/contracts/src/scene.ts`:

```ts
SceneModel {
  scenePath, rootName,
  background: SceneBackground | null,    // ❌ singular — needs to become layers
  props: SceneProp[],                     // ✅ keep, may need extras
  colliders: SceneCollider[],             // ✅ keep, becomes a ColliderLayer
  collidersJsonPath,
  zones: SceneZone[],                     // ✅ keep
  zonesJsonPath,
  paths: ScenePath[],                     // ✅ keep
  notes: string[],
}
```

v1 mapping:
- `background` → loader produces a single ImageLayer at zIndex -10
- `props` → PropsLayer entries OR direct top-level props (TBD)
- `colliders` → ColliderLayer at zIndex 0
- `zones`, `paths` → top-level (unchanged)
- New: `layers`, `actors` (currently spread between scene + catalog)

Migration is **non-breaking** if we add new fields and keep old ones working as fallbacks during Phase 1 transition.

## Next step

Run platformer test → audit `data/levels/*.json` produced by agent → correct schema where Q1-Q8 are answered → write actual TypeScript types in `packages/contracts/src/ogf-schema.ts`.
