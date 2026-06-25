# Scaffold director

**Stage goal:** stand up the runnable project skeleton (modules + data files).

**Produces:** `project_skeleton` (src/* + data/* in place, runs empty).

## Process

Run the **Phase 0 foundation-seed procedure** in `conventions/common.md`:

1. If `.ogf/foundation-seeds/<genre>/seed/` exists, copy it to root (overwriting
   the bootstrap stubs). Else build the module split from scratch using
   common.md "Module architecture" (constants/state/config/catalogs/dom/assets/
   audio/input/collision/render/scene + thin game.js, + genre modules).
2. Honor `module_style` (simple script-tags default, or ES modules).
3. Create the `data/*.json` files the genre needs (levels, configs) — empty
   catalogs are fine for now.
4. **Verify the skeleton**: `python .agents/tools/verify-game.py` should pass
   (valid JS/JSON/schema) even before gameplay exists.

Auto-advance (no approval gate), but checkpoint.

## Done when

`verify-game.py` exits 0 on the skeleton. `pipeline.py done scaffold`.
