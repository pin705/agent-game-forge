# Systems director

**Stage goal:** build the actual gameplay — execute `spec.md §7`'s phase plan,
one phase at a time, until the game is playable.

**Produces:** `playable_game`.

## Process

This stage runs the INNER phase plan. For each phase in `spec.md §7`:

1. Read the relevant recipe(s) in `.ogf/recipes/<genre>/` and the genre
   convention before writing a subsystem (common.md "Recipes" table).
2. Implement ONE concern (movement, collision, camera, a battle FSM, a wave
   spawner, HUD…). Keep modules 100–500 LOC, data in `data/*.json`
   (common.md "Module architecture").
3. Pull balance/feel numbers from `conventions/game-design.md`.
4. **Verify after each phase**: `python .agents/tools/verify-game.py`. You are
   headless — this is your check (common.md "Phase verification").
5. Need an asset mid-phase? Use `fetch-asset` first, then `gen-image`.

Auto-advance between phases; checkpoint the `systems` stage when the whole phase
plan is done. If the user picked `manual_all`, pause per phase.

## Done when

Every spec phase is wired and `verify-game.py` passes. `pipeline.py done systems`.
