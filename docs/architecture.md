# OGF Architecture

This doc explains why OGF exists, how it's organized, and what design principles drive every product decision. Read this before adding a feature or changing a contract.

## What OGF is

OGF is the **visual half of an agent-driven game-making workflow**.

```
┌─────────────────┐    chat / prompts     ┌─────────────────┐
│      User       │ ────────────────────► │   Agent (Codex) │
└────────┬────────┘                       └────────┬────────┘
         │                                         │
         │ click / drag / open                     │ writes code,
         │                                         │ generates art,
         │                                         │ edits JSON
         ▼                                         ▼
┌─────────────────────────────────────────────────────┐
│                  Project on disk                     │
│  data/ levels.json  enemies.json  ...                │
│  assets/ sprites/  maps/  ...                        │
│  scripts/ game.js  scene.js  ...                     │
└─────────────────────────────────────────────────────┘
         ▲                                         ▲
         │ render + drag-edit                      │ runs the game,
         │                                         │ shows pending diffs
         │                                         │
┌────────┴─────────────────────────────────────────┴──┐
│                       OGF                            │
│  Sidebar (file tree) │ Editor (assets/scenes/play)  │
│                                  │ Agent panel (chat)│
└─────────────────────────────────────────────────────┘
```

The agent and OGF both read/write the same files on disk. They never talk to each other directly. The disk IS the contract.

## What OGF is NOT

- **Not a replacement for Unity / Godot / GameMaker.** Those are full engines. OGF is a thin coordination layer that sits between the user, the agent, and the engine runtime (Phaser, Godot, etc.).
- **Not Phaser Editor.** Phaser Editor is a desktop IDE for Phaser developers. The human is the author there; AI is a copilot. OGF is browser-based, agent-first, runtime-agnostic, and designed for users who don't write code.
- **Not a no-code tool.** OGF doesn't try to hide code from the user. The agent writes code, the user can read or edit it, but the primary interaction is chat + drag, not visual scripting.
- **Not a static editor.** SceneModel and the conventions it enforces are a moving target — they grow as we add genre support. Don't speculatively add fields.

## Design principles

These are the rules we use to settle internal design debates.

### 1. The agent is the author. The editor is the lens.

When something feels missing in the editor, the first question is: "can the user achieve this by chatting?" If yes, the editor doesn't need to add the feature — the agent already covers it.

The editor is for things that are **faster to drag than to describe**: moving an enemy spawn 32 pixels, retiming a wave, swapping one sprite for another. Anything that's awkward to verbalize ("make the boss arena 200 pixels taller") should drag-edit.

Things that are easier to describe than drag — "add a coin pickup", "make this enemy faster" — stay in chat.

### 2. Disk is the contract.

OGF and the agent communicate exclusively through files on disk. Never through OGF-specific APIs the agent has to learn. This means:

- Whatever we put in OGF's `SceneModel` MUST correspond to a file shape the agent can naturally produce.
- We don't add OGF-specific metadata files unless absolutely necessary (`.ogf/spec.md` is one of the few exceptions).
- File schemas live in `packages/contracts/` so both the daemon (writer) and OGF (reader) agree.

### 3. Schema first, framework second.

OGF defines its own JSON schema for levels, scenes, catalogs. The agent writes that schema. A loader (per-engine, per-framework) translates the schema into runtime code:

```
agent writes  data/levels/level_1.json   (OGF schema)
                       ↓
              schema-to-X loader
                       ↓
                 Phaser scene
                  (or Godot .tscn)
                  (or Pixi sprite tree)
```

This means we're not locked into Phaser. The same SceneModel can drive multiple runtimes; the editor only cares about the JSON schema.

### 4. Editor incompleteness is acceptable. Agent incompleteness is not.

If the editor can't render parallax layers, that's a bug to fix later — the user can still chat with the agent to tweak the parallax. If the agent can't generate parallax layers, that's a fundamental product gap — there's no fallback. So we prioritize agent capability over editor completeness.

This is why we can ship genre-by-genre. Each genre that the agent supports is shippable; the editor catches up over time.

### 5. Iterate, don't speculate.

Don't design SceneModel for genres we haven't tried yet. Run the agent on a real project. See what it produces. See what the editor can't render. Fix that gap. Move on.

A wrong schema chosen up-front is harder to migrate from than a missing feature added later.

## What's in the box

### Daemon (`apps/daemon/`)

Node.js + Express service that:
- Spawns Codex CLI per turn (`apps/daemon/src/codex.ts`)
- Streams events back over SSE (`/api/runs/:id/events`)
- Watches for new image files during a run (Codex's image_gen is silent — see `apps/daemon/src/server.ts` `startImageWatch`)
- Reads/writes project files (`/api/files/*`)
- Hosts the project SQLite DB (conversations, projects, messages)
- Generates the inline conventions block injected into every Codex prompt (`apps/daemon/src/templates/conventions.ts`)

### Web (`apps/web/`)

Vite + React app. Tabbed workspace:
- **Sidebar** — file tree, project switcher, file search
- **Editor center** — Assets / Scenes / Play tabs
  - Assets tab: file inspector with monaco editor + image previewer (slicer / regenerate)
  - Scenes tab: drag-edit canvas (`SceneEditor.tsx`)
  - Play tab: runs the game (Godot launches subprocess; web opens iframe)
- **Agent panel** — chat with Codex, history, refs, composer

### Contracts (`packages/contracts/`)

Shared TypeScript types — single source of truth for the API + the SceneModel schema.

## Engine support strategy

OGF currently supports two engines:

- **Web** (default since the JS-first pivot): vanilla JS + Canvas right now; Phaser becomes the default web runtime in Phase 1 of the roadmap.
- **Godot 4** (maintained): existing projects work; we don't actively add Godot-only features.

We don't currently develop Unity support. The contract types are there if someone wants to revive it.

The long-term vision is **schema + multiple runtime adapters**. Same OGF JSON schema → Phaser / PixiJS / vanilla / Godot loaders. Pick the runtime you ship to.

## Where we're going

See `roadmap.md` for the full 12-month plan and `genre-support.md` for what works today vs WIP.

Short version: web-first, Phaser as default runtime in Phase 1, then 12 months of "iterate per-genre" until OGF can scaffold and edit any common 2D game type.
