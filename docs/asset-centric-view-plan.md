# Asset-Centric View — Plan

> **Status:** Discussion / proposal. Branch `feature/asset-centric-view`. No code yet.

## The problem in one screenshot's worth of words

OGF's left pane today is a raw file tree. For a finished test project (`test-td`) it shows ~40 files across `data/`, `assets/`, `src/`, `.ogf/`. The user thinks in **entities** ("Scout", "Archer Tower") and **scenes** ("Guandu Pass"); the tree forces them to think in **paths** (`assets/sprites/scout/walk.png`, `data/enemies.json#scout`, `src/enemies.js:142`).

Net effect: even after the agent does great work, the project feels messy because the surface area we expose is messy.

Today, when the user wants to "regenerate Scout":

1. They guess where Scout's sprite lives → drill into `assets/sprites/scout/`.
2. Pick ONE png (say `attack.png`) → click Regenerate.
3. Modal pops, asks options for that ONE png.
4. Other anims of Scout are unchanged → drift between idle/walk/attack.

What they actually mean: "redo the whole Scout pack with consistent style." The current UI can't say that.

## What the user is asking for

1. **Asset-first sidebar.** Show the things people care about (entities, scenes, maps), not files. Files are accessible but secondary.
2. **Group by entity.** All Scout-related files (sprites + catalog row + usages) collapse into one "Scout" item.
3. **Whole-pack regenerate.** Click an entity → regenerate ALL its sprites + update its catalog row in one operation.
4. **Separate Data vs Scenes.** Two top-level lanes in the sidebar — like Figma's "Pages" + "Assets".
5. **Refactor button on Open Project.** For users with existing JS games, a third option that asks the agent to import + restructure into OGF layout.

## Mental model — Figma analogy

| Figma | OGF (today) | OGF (proposed) |
|-------|-------------|-----------------|
| Pages | n/a | Scenes lane |
| Components | n/a | Entities lane (each = sprite pack + catalog row) |
| Assets | n/a | Maps / Audio lane |
| Layers (raw) | File tree | Files lane (collapsed by default) |

The shift: **the catalog files become the index, not the asset folders.** `data/enemies.json` is a list of entities → each entry maps to a folder of sprites → that's what we display.

## Proposed UI

```
┌─ SIDEBAR ─────────────────┐  ┌─ MAIN ─────────────────────┐
│                           │  │                            │
│ ▼ ENTITIES                │  │  [whatever's selected]     │
│   ▼ Enemies (3)           │  │                            │
│     ● Scout               │  │                            │
│     ● Bandit              │  │                            │
│     ● Crimson Daimyo      │  │                            │
│   ▼ Towers (4)            │  │                            │
│     ● Archer              │  │                            │
│     ● Spear               │  │                            │
│     ● Strategist          │  │                            │
│     ● Cavalry Camp        │  │                            │
│   ▼ Heroes (1)            │  │                            │
│     ● Guan Yu             │  │                            │
│   ▼ Pickups (2)           │  │                            │
│     ● Rice Ball           │  │                            │
│     ● XP Orb              │  │                            │
│                           │  │                            │
│ ▼ SCENES (3)              │  │                            │
│   ◆ Guandu Pass           │  │                            │
│   ◆ Baima Gate Boss       │  │                            │
│   ◆ Level 1               │  │                            │
│                           │  │                            │
│ ▼ ASSETS                  │  │                            │
│   ▶ Maps (3)              │  │                            │
│   ▶ Audio (8)             │  │                            │
│   ▶ Style anchor          │  │                            │
│                           │  │                            │
│ ▼ CODE                    │  │                            │
│   game.js                 │  │                            │
│   enemies.js              │  │                            │
│   towers.js               │  │                            │
│   ...                     │  │                            │
│                           │  │                            │
│ ▼ FILES (raw)             │  │                            │
│   ▶ all 47 files          │  │                            │
│                           │  │                            │
│ ─────────────────────     │  │                            │
│ + Add entity              │  │                            │
│ + Add scene               │  │                            │
└───────────────────────────┘  └────────────────────────────┘
```

### When user clicks an entity (e.g. "Scout")

```
┌─ SCOUT ─────────────────────────────── enemy ─┐
│                                                │
│ ┌────┬────┬────┬────┐                         │
│ │idle│walk│atk │die │  [+ add animation]      │
│ └────┴────┴────┴────┘                         │
│   ▶ animated previews loop side-by-side       │
│                                                │
│ ── STATS ────────────────────────────────      │
│ HP        45                                   │
│ Speed     90 px/s                              │
│ Damage    8                                    │
│ XP        5                                    │
│ [Edit table view]                              │
│                                                │
│ ── DISPLAY ─────────────────────────────       │
│ Render     90 × 90 px, anchor: bottom          │
│ Hitbox     55 × 70                             │
│ Strategy   side_with_flip                      │
│                                                │
│ ── USED IN ─────────────────────────────       │
│ Scenes:    Guandu Pass · Baima Gate Boss       │
│ Code refs: src/enemies.js:142, 158             │
│                                                │
│ ── ACTIONS ─────────────────────────────       │
│ ⟳ Regenerate whole pack                        │
│ ⟳ Regenerate one animation                     │
│ + Add animation (e.g. "dodge", "block")        │
│ + Add variant (e.g. "elite_scout")             │
│ 🗑  Remove from project                         │
│                                                │
│ ── FILES ───────────────────────────────       │
│ 4 sprites · 1 catalog row · 2 code refs        │
│ [Show in raw file tree]                        │
└────────────────────────────────────────────────┘
```

This view is **derived** from existing files — no schema change needed. The catalog (`data/enemies.json#scout`) IS the source of truth; sprites are matched by id convention (`assets/sprites/scout/*.png`).

### When user clicks a scene (e.g. "Guandu Pass")

Opens the existing **SceneEditor** (already built, no changes needed). The existing Scene/Data/Play tabs continue to work.

### When user clicks "Files (raw)"

Drops back to today's full file tree. This is the escape hatch — power users + debugging always have it.

## How OGF discovers entities (no schema work needed)

```ts
// Pseudocode — runs on project load + when catalogs change
async function discoverEntities(projectPath: string): Promise<Entity[]> {
  const entities: Entity[] = [];

  // 1. Walk known catalog files. These ARE the entity index.
  const catalogs = [
    { file: 'data/enemies.json', kind: 'enemy' },
    { file: 'data/heroes.json', kind: 'hero' },
    { file: 'data/towers.json', kind: 'tower' },
    { file: 'data/pickups.json', kind: 'pickup' },
    { file: 'data/projectiles.json', kind: 'projectile' },
    { file: 'data/items.json', kind: 'item' },
    { file: 'data/player.json', kind: 'player' },
    // discovered dynamically: any data/<name>.json with a top-level array OR record
  ];

  for (const cat of catalogs) {
    const json = await readJsonIfExists(projectPath, cat.file);
    if (!json) continue;
    const rows = Array.isArray(json) ? json : Object.entries(json).map(([id, v]) => ({ id, ...v }));
    for (const row of rows) {
      entities.push({
        id: row.id,
        kind: cat.kind,
        catalog: cat.file,
        sprites: await findSprites(projectPath, row.id),  // glob assets/sprites/<id>/*.png
        usages: await scanCodeRefs(projectPath, row.id),  // existing fetchUsages
        stats: row.stats ?? {},
        display: { displayW: row.displayW, displayH: row.displayH, anchor: row.anchor },
      });
    }
  }
  return entities;
}
```

**No file system changes. No new schema. Just a derived view.**

If discovery fails (catalog malformed, sprite folder missing) → show entity in a "broken" state with a "Show files" link to investigate. Never hide errors.

## Whole-pack regenerate — the flow

Today: user picks one PNG → modal options → agent regens that PNG.

Proposed: user clicks entity → action button "Regenerate whole pack" → modal pre-fills with:
- All current animations (preview each)
- ☑ Regenerate ALL animations (default)
- ☑ Update catalog row if dimensions/grid change
- ☑ Match style anchor + previously generated entities
- Hint textarea: "what should change about this character?"
- Aspect ratio selector (applies to all anims)
- Per-anim FPS overrides (collapsed)

Submit → builds ONE prompt:

```
Regenerate the COMPLETE sprite pack for entity `scout` (data/enemies.json).

The pack:
- assets/sprites/scout/idle.png  (8 frames @ 4×2)
- assets/sprites/scout/walk.png  (6 frames @ 6×1)
- assets/sprites/scout/attack.png (4 frames @ 4×1)
- assets/sprites/scout/death.png (5 frames @ 5×1)

Goal: refresh all four animations as a coherent set so Scout looks
like the SAME character across all anims. Current concern: visual
drift between anims.

For each animation:
1. Stage to .ogf/regen/assets/sprites/scout/<anim>.png
2. Use generate2dsprite with reference=generated_image after
   view_image of the FIRST anim's previous version (the agent picks
   one — typically idle).
3. Maintain the existing grid + fps for each anim.

Hint from user: "More aggressive — bigger swings, more weight"

Style references (read these via view_image before any generate call):
- .ogf/style-anchor.png
- assets/sprites/scout/idle.png  (existing — primary identity ref)

Don't edit any other file. Confirm each regen output path when done.
The user reviews + applies the swap (see Regenerate workflow in
conventions for staging).
```

Once user reviews + applies all 4 → if dimensions changed, run a follow-up agent turn that updates `enemies.json#scout` displayW/displayH/collision and any code references.

## Separate Data vs Scene panes

Today: one mixed file tree.
Proposed: top-level lanes in sidebar (see UI mock above):

- **Entities** — derived from data catalogs
- **Scenes** — `data/levels.json` registry
- **Assets** — Maps + Audio + Style anchor (raw image/audio assets that aren't tied to entities)
- **Code** — `src/*.js` and other source files
- **Files (raw)** — full file tree, escape hatch

Each lane is collapsible. User can hide everything except what they're working on.

## Refactor existing project — the new "Open" option

Open Project modal today: **Open existing** + **Create new from prompt**.

Add: **Refactor existing JS game**.

Flow:
1. User picks a folder containing an existing JS game (Phaser, vanilla canvas, P5, whatever).
2. OGF asks Codex to scan it and produce a 1-page audit:
   - Detected engine (Phaser vs vanilla)
   - Found entities (parsed from sprite paths + script analysis)
   - Found scenes/levels (if any)
   - Found assets (PNGs, sheets, audio)
   - Confidence score per detection
3. User reviews audit. Picks: full refactor, sidecar-only, or cancel.
4. **Sidecar-only mode** (low risk, default): agent writes `data/*.json` catalogs derived from existing code, doesn't touch original files. User sees their game in OGF's asset-centric view but the original code keeps working unchanged.
5. **Full refactor mode** (high risk, opt-in): agent restructures into OGF's `data/`+`assets/`+`src/` layout, possibly rewriting source. Always works in a NEW dir or git branch. Never destroys the original.

**Sidecar-only is the right default.** It's what makes the import a one-click decision instead of a high-stakes rewrite. Most existing games don't NEED OGF's structure — they just need OGF's asset-centric view. The sidecar gives that without touching the engine.

Refactor flow respects existing CLAUDE.md / conventions if present.

## Implementation plan

This is a multi-week effort. Order matters — each step ships value independently.

### Phase 1 — Discovery + sidebar lanes (1 week)

- [ ] Daemon API: `GET /api/projects/:id/entities` → returns derived entity list
- [ ] Daemon API: `GET /api/projects/:id/scenes` → returns scene list (already partially exists via levels registry)
- [ ] React: new `Sidebar` lanes (Entities / Scenes / Assets / Code / Files), collapsible
- [ ] Click entity → opens new `EntityInspector` panel (placeholder, just shows id + sprite list for now)
- [ ] Click scene → opens existing SceneEditor
- [ ] "Files (raw)" lane = today's FileTree, hidden behind toggle

**Ship gate:** test-td shows 6 entities + 1 scene in the new sidebar; user can click each. EntityInspector is bare but functional.

### Phase 2 — EntityInspector full UI (1 week)

- [ ] Animations strip (each anim's SpritePreview side-by-side)
- [ ] Stats panel (editable inline; writes back to catalog json)
- [ ] Display + hitbox panel
- [ ] Used-in panel (scenes + code refs)
- [ ] Click any sprite → existing FileEditor opens with regen pending

**Ship gate:** User can browse Scout, edit HP value, see it persist to enemies.json.

### Phase 3 — Animation-pack regenerate (1 week)

> **Critical correction after looking at real test-td output:** the
> "pack" the user wants atomic isn't 4 anims of one entity. It's the
> ~10 files inside ONE animation folder (the `idle/` directory), all
> generated by one `generate2dsprite` call. The entity-level pack
> (4 anims at once) is a multiplier of this same mechanism.

#### What an "animation pack" actually is on disk

`generate2dsprite` writes ~10 files per animation into one directory:

```
assets/sprites/yellow_turban_scout/idle/
  ├── sheet.png             ← THE FILE THE GAME READS
  ├── idle-1.png            ← individual frames
  ├── idle-2.png
  ├── idle-3.png
  ├── idle-4.png
  ├── animation.gif         ← preview only
  ├── pipeline-meta.json    ← cols/rows/fps/cell_size/anchor + provenance
  ├── prompt-used.txt       ← the exact prompt the agent used
  ├── raw-sheet.png         ← magenta-bg intermediate from image_gen
  ├── raw-sheet-clean.png   ← after chroma cleanup
  └── sheet-transparent.png ← intermediate
```

These ~10 files are **internally consistent**: `idle-3.png` IS the third
frame of `sheet.png`; `pipeline-meta.json` describes both. If you
regenerate `sheet.png` alone, the frames + meta on disk become stale
and lying. **Today's per-file regenerate has this bug.** The fix:
regenerate operates on the directory, not the file.

**Detection rule** (server-side): a directory is an "animation pack"
iff it contains both `sheet.png` AND `pipeline-meta.json`. Cheap to
detect on file open.

The skill already supports this — it takes `--output-dir <path>` and
writes the whole pack there. We just point that at the staging mirror.

#### User flow — "I want to change scout's idle"

1. User opens any file under `assets/sprites/yellow_turban_scout/idle/`
   (probably `sheet.png` because it's the visible one). Could be
   the FileEditor, could be from the future Entity Inspector.
2. Clicks **Regenerate**.
3. Modal opens, headed: **"Regenerate scout / idle"** (parsed from
   `<entity>/<action>/sheet.png` path convention).
4. Body explicitly tells the user what's about to happen:
   > "This regenerates the entire `idle/` folder — 10 files including
   > the sheet, individual frames, and metadata. Everything swaps
   > atomically when you apply. Other animations of scout (walk,
   > attack) won't be touched."
5. Hint textarea + Quick/Manual + sibling-match (siblings now means
   OTHER ANIMATIONS of the same entity — `walk/sheet.png` and
   `attack/sheet.png`, NOT files in the same folder which are the
   pack itself).
6. Submit.

Prompt sent to Codex:

```
Regenerate the animation pack at
  `assets/sprites/yellow_turban_scout/idle/`
via the `generate2dsprite` skill. Stage the ENTIRE output (sheet +
frames + intermediates + pipeline-meta + prompt-used) to
  `.ogf/regen/assets/sprites/yellow_turban_scout/idle/`

Pass `--output-dir .ogf/regen/assets/sprites/yellow_turban_scout/idle`
to the skill so it writes the full file set there.

What should change: <hint>

Visual consistency (only hard rule — must read as the SAME scout):
  view_image .ogf/style-anchor.png (if it exists)
  view_image these OTHER animations of the same entity:
    - assets/sprites/yellow_turban_scout/walk/sheet.png
    - assets/sprites/yellow_turban_scout/attack/sheet.png
  Use the "Same character, new animation" reference role from
  conventions.

Layout & dimensions: <Quick: your call / Manual: user-specified>

When done:
  - Confirm the staging dir contains the full pack (same file set
    as the live folder).
  - Report the layout actually used (cols/rows/fps/frame size).
  - DO NOT touch the live folder or any data/code file.
```

After codex finishes, OGF detects new staging dir → toast banner:

> ⟳ scout / idle — pack ready (10 files) [Review →]

User clicks Review → pack review modal:

```
┌─ Review pack: scout / idle ─────────────────────────┐
│                                                     │
│  ANIMATED PREVIEW                                   │
│  ┌─────────────┐    ┌─────────────┐                │
│  │  ORIGINAL   │    │     NEW     │                 │
│  │  ▶ idle     │    │  ▶ idle     │                 │
│  │  cycle anim │    │  cycle anim │                 │
│  └─────────────┘    └─────────────┘                 │
│                                                     │
│  Layout       4×1 @ 8fps        4×1 @ 8fps  ✓       │
│  Frame size   90×90             96×96       changed │
│                                                     │
│  ▾ Files in pack (10)                               │
│      sheet.png            • will replace            │
│      idle-1.png           • will replace            │
│      idle-2.png           • will replace            │
│      idle-3.png           • will replace            │
│      idle-4.png           • will replace            │
│      animation.gif        • will replace            │
│      pipeline-meta.json   • will replace            │
│      prompt-used.txt      • will replace            │
│      raw-sheet.png        • will replace            │
│      raw-sheet-clean.png  • will replace            │
│      sheet-transparent.png • will replace           │
│                                                     │
│  ☑ Auto-update slicing in code/data after apply     │
│    (frame size changed 90→96)                       │
│                                                     │
│            [Discard pack]    [Apply pack]           │
└─────────────────────────────────────────────────────┘
```

Apply → server replaces all 10 files atomically → if layout changed,
fire follow-up turn telling Codex "scout/idle frame size changed
90→96, update displayW/displayH/collision in data/enemies.json#scout
and grep src/enemies.js for any `90` you find related to scout."

#### What needs building (concrete pieces)

```
DAEMON
  D1. Detection helper isAnimationPackDir(dirPath) — has sheet.png
      AND pipeline-meta.json.
  D2. GET /api/files/regen/packs?projectPath=…
      → returns [{ dir, fileCount, layout: {cols,rows,fps,frameW,
                    frameH} from pipeline-meta }]
  D3. POST /api/files/regen/apply-pack
      body: { projectPath, packDir }
      → walks staging dir recursively, copies each file to live
        equivalent, unlinks staging, removes empty staging dirs.
        Atomic per-file; if mid-operation fails, return
        {applied:[…], failed:[{relPath, err}]}.
  D4. POST /api/files/regen/discard-pack
      body: { projectPath, packDir } → rm -rf staging dir.

CLIENT
  C1. RegenerateOptionsModal — detect pack dir; if yes, change
      copy ("regenerates 10 files") and submit pack-aware prompt
      with --output-dir flag.
  C2. PendingPacksBar — top of app, shows "N packs ready" when
      /regen/packs returns non-empty. Polls or subscribes via
      existing run-finished signal.
  C3. PackReviewModal — animated preview pair from old vs new
      sheet.png, file list, apply/discard, auto-code-update toggle.
  C4. Layout diff + follow-up turn fire — read pipeline-meta.json
      from BOTH live and staging, compare cols/rows/fps/frameW/H.
      If different, after apply POST /api/runs with focused patch
      prompt + targeted file refs.

CONVENTION
  M1. Add a 'Regenerate animation pack' subsection that mirrors the
      'Regenerate workflow' one, but emphasizes:
        - --output-dir to staging
        - sibling = OTHER actions of same entity (walk/attack), not
          files in the same folder
        - report layout in last message so client can compare.
```

#### Why this is intuitive

The user thinks **"regenerate scout's idle"** — one mental concept,
one click. Today they have to think about which file to right-click
and accept that 9 other files in the folder will be silently stale.
After this change the mental model matches the disk model: the
animation IS the unit, the folder IS the pack, apply IS atomic.

The existing single-file regen still works for one-off PNGs that
aren't part of a pack (a UI icon, a logo). Detection is automatic —
no UI mode switch.

#### Entity-level (multi-anim) regenerate is the SAME mechanism

When the future Entity Inspector adds "Regenerate whole entity",
all it does is fire ONE prompt that asks Codex to regenerate N
animations into N staging dirs in the same turn. The pack-detection
+ pack-apply infra handles N packs the same as 1. No extra server
work.

**Ship gate:** User opens scout/idle/sheet.png → Regenerate → modal
clearly says "10 files" → submit → wait → toast "pack ready" → review
→ Apply → all 10 files swap → if frame size changed, follow-up turn
patches enemies.json automatically → game looks consistent.

#### How the pack flows end to end

The user wanted three guarantees:

1. **Keep all the work, not just one file.** Staging is already a tree mirror at `.ogf/regen/<relPath>` — adding more paths is free. Agent generates N files into the mirror in one turn.
2. **Atomic swap when confirmed.** "Apply pack" does N copies + N unlinks in one server call; partial failure leaves the staging file behind so user can retry or discard.
3. **Code follows assets.** Right after apply, if dimensions/grid changed for any file, fire a follow-up agent turn that patches catalog entries + source references. User reviews this patch through the existing diff flow.

Concrete pieces needed (extending today's per-file regen, not replacing it):

```
DAEMON
  GET  /api/files/regen/list?projectPath=…
       → { pending: [{ relPath, size, mtimeMs }] }
       Walks .ogf/regen/ for any staged file.

  POST /api/files/regen/apply-pack
       body: { projectPath, relPaths: string[] }
       → { applied: string[], failed: { relPath, err }[] }
       Wraps the existing per-file copy+unlink in a loop. Failures
       leave staging in place so user retries; never mid-state-rolls
       back successful copies (target may already be live).

  POST /api/files/regen/discard-pack
       body: { projectPath, relPaths: string[] }
       → { discarded: string[] }

  POST /api/runs (existing)
       Used to fire the follow-up code-update turn after apply.
       Prompt body assembled client-side from the pre-vs-post-apply
       dimension comparison (computed before apply runs).

CLIENT
  PendingRegenBar (always-visible top bar when staging non-empty)
    "N files pending review · [Open]"
    Open → PendingRegenPanel modal/drawer.

  PendingRegenPanel
    Lists every staged file grouped by entity dir.
    Each row: thumbnail diff (Original / New side-by-side) +
              animated preview pair (today's regen-compare).
    Footer:
      [Discard pack]              [Apply pack]
      [☑] Auto-update code after apply
      "If layouts changed, the agent will be asked to patch
       catalog + code references in a follow-up turn."

  After apply:
    1. Compute layout-diff per file (cols/rows/fps/dimensions
       comparing the regen-meta we asked the agent to report
       against the slice metadata for the original).
    2. If ANY file changed layout AND auto-update was checked:
       POST /api/runs with a focused prompt — see below.
    3. Otherwise just close the panel.

AGENT FOLLOW-UP PROMPT (auto-fired after apply when layouts changed)
  ────────────────────────────────────────────────────────────
  The user just applied a regenerate pack for entity `scout`.
  These files now have new layouts on disk:

    - assets/sprites/scout/idle.png
        was 4×2 @ 8 fps (90×90 frames)
        now 4×2 @ 8 fps (96×96 frames)         ← only display size
    - assets/sprites/scout/attack.png
        was 4×1 @ 9 fps (96×96 frames)
        now 6×1 @ 9 fps (128×96 frames)        ← grid + frame size

  Update wherever this slicing is referenced so the engine renders
  the new layout correctly:
    - data/enemies.json#scout (displayW/displayH/animations.attack
      .frameW/frameH/frames)
    - src/enemies.js:142     (cols/rows/fps for scout sheet)
    - data/levels/*.json     (no change expected — placement coords
      are by anchor, not size — but check)

  Stay focused on the slicing patch. Don't restyle the catalog,
  don't tune stats, don't touch unrelated entities. Show the diff
  for review.
  ────────────────────────────────────────────────────────────

  This prompt is built CLIENT-SIDE from the regen metadata, not
  asked of the agent — the agent already reported the layout when
  it staged the pack (the "When done" section of the regen prompt
  asks for it). We just feed the comparison back.

EDGE CASES
  - User regens single file, then regens another while first is
    still pending → both accumulate in .ogf/regen/. Pack panel
    shows both. They don't have to be from the same entity.
  - User opens FileEditor on a file with staging → existing single-
    file diff banner still works (unchanged). Pack panel is
    additive, not replacement.
  - Apply mid-failure (e.g. target file got moved by user mid-
    operation) → that file's row marks failed in the panel,
    remaining files still applied. User can investigate or discard.
  - Agent didn't report layout dimensions on regen → we skip the
    follow-up turn and surface a one-line warning. Manual code
    edit available via existing FileEditor flow.
```

### Phase 4 — Refactor existing project (2 weeks, riskier)

- [ ] Open Project modal: third option "Refactor existing JS game"
- [ ] Codex skill / prompt: project audit → produce JSON report
- [ ] Audit review UI (one screen, scroll-through)
- [ ] Sidecar-only mode (default, low risk)
- [ ] Full refactor mode (opt-in, branch isolation)
- [ ] Documentation: what OGF guarantees / doesn't guarantee for imports

**Ship gate:** A real Phaser tutorial game can be imported in sidecar mode; OGF's asset-centric view shows correct entities; the original game still runs unchanged.

## Open questions

1. **What about projects WITHOUT clean catalogs?** A user who hand-coded enemies into `enemies.js` constants instead of `enemies.json` — do we discover them? Probably yes via code-scan as Phase 4 work; for Phase 1-3 assume well-structured projects.
2. **Multi-genre projects** (a project with TD AND platformer levels)? Each scene declares its own genre via `camera.mode` already. Sidebar groups everything together. Fine.
3. **Custom catalogs** (user adds `data/spells.json`)? Detect via heuristic: any `data/<name>.json` with array-of-objects-with-id shape gets a sidebar lane. Whitelist common ones for nicer labels.
4. **Backwards compat** — does the old file tree go away? **No.** It's a toggle, always available. Power users + debugging always need raw access.
5. **Naming.** "Entities" vs "Things" vs "Components"? "Entities" wins — game-dev native term.
6. **Where does scene-context.json fit?** Behind the scenes, unchanged. Sidebar doesn't need to surface it.

## What this PROBABLY isn't worth doing

- Drag-and-drop between sidebar lanes (overkill, click-to-rename works)
- Search bar in sidebar (later, only if entity count grows past ~30)
- Custom user-defined groupings (premature abstraction; let conventions emerge first)
- A "favorites" star (not enough projects to need it yet)

## Recommendation: ship Phase 1 first

Phase 1 alone gives the user 80% of the perceived improvement (clean sidebar, click-to-entity, scenes separate from data). EntityInspector can be bare for week one — even if it just shows "Scout (3 sprites, 2 usages) [open files]" that's already cleaner than today.

Phase 2-3 each add real workflow value but Phase 1 is the foundation that makes them obvious wins later.

Phase 4 (refactor existing project) is the marketing win — it's what gets external users to try OGF. But it's the riskiest and shouldn't block Phase 1-3.

## Next step (for the human)

Pick one:
- **(a)** Approve plan → I start Phase 1 in this branch
- **(b)** Push back on UI / discovery rules / phasing
- **(c)** Cut scope — e.g. "just whole-pack regenerate, skip the sidebar redesign for now"
