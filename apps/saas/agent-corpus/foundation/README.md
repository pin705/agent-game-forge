# Foundation seeds

Per-genre starter scaffolds extracted from hand-built reference projects.
Each genre folder ships a `seed/` tree that mirrors what the agent should
write to a brand-new project of that genre.

## Layout

```
foundation/
├── README.md              ← this file
├── <genre>/
│   └── seed/
│       ├── SEED.md        ← architecture doc the agent reads first
│       ├── index.html
│       ├── styles.css
│       ├── src/*.js       ← 14-20 modules per the module-architecture rule
│       └── data/*.json    ← empty catalogs + tunable configs
```

Genre folder names match `templates/conventions/genres/<genre>.md`.

## Currently shipped (all ★★★)

| Genre | Seed | Notes |
|---|---|---|
| `side-scroll/` | ✅ 14 src files | Sengoku-Era platform action, juice layer, error overlay |
| `top-down-rpg/` | ✅ 36 files | Sengoku-Era-ogf-derived, full feature set |
| `arena-survivor/` | ✅ 14 src files | VS-style; object pools, ring spawner, auto-fire, XP orbs, level-up |
| `shmup/` | ✅ 14 src files | Vertical scroll; pooled bullets, wave director, star field |
| `tower-defense/` | ✅ 14 src files | Polyline path, archer/cannon towers, 4-wave economy |
| `grid-logic/` | ✅ 14 src files | Roguelike step-mode; undo stack, enemy AI, items, goal |
| `ui-heavy/` | ✅ 13 src files | Card battler; deck/hand/energy, screen-stack, click regions |

All 7 seeds pass the headless smoke test (240 frames, boot + play mode, no runtime errors).

The agent's Phase 0 (see `conventions/common.md`) handles the
seed-or-from-scratch decision per project genre. Adding a new genre's
seed is opt-in: the moment a `<genre>/seed/` folder exists here, the
next bootstrap stages it under the project's
`.ogf/foundation-seeds/<genre>/` and the agent will adopt it on its
next run.

## Adding a new genre seed

1. Hand-build a reference project for the genre (the way
   `D:/Sengoku-Era-ogf` was the reference for top-down-rpg). Polish to
   the same standard: module split, config-vs-identity separation,
   shared state.js, thin game.js entry.

2. Copy the reference's `index.html`, `styles.css`, `src/*.js`,
   `data/*.json` into a new `foundation/<genre>/seed/` folder. Strip
   genre-specific content from `data/*.json` so they ship empty (the
   agent fills them per the project's spec).

3. Write a `SEED.md` documenting which modules are universal vs
   starter vs recipe-fillable for that genre.

4. Update this README's "Currently shipped" list.

5. Add per-genre recipes under `templates/recipes/<genre>/` for the
   common subsystems agents will need (battle / menu / dialogue / save
   / progression / fx — adjust list per genre).

No bootstrap changes needed. The walker in `bootstrap.ts`
(`vendoredFoundationSeedFiles`) auto-discovers any `<genre>/seed/`
folder under `foundation/`.
