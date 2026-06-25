# Spec director

**Stage goal:** turn discovery answers into `.ogf/spec.md` — the game description
future stages execute against.

**Produces:** `spec.md`.

## Process

Follow `conventions/common.md` → "Spec authorship — describe WHAT, not HOW" and
the genre file's "Spec phase-plan expansion". In short:

1. **§1 Identity**: genre, premise, art style + the TWO palette roles (sprite vs
   map — see common.md "Palette discipline"), references, and the
   `Visual decisions` line (genre/animation_richness/module_style).
2. **§2 Player / §3 Levels / §4 Enemies-pickups-hazards**: by NAME, with
   animations named (idle/walk/attack). Respect `combat_style: none`.
3. **§7 Phase plan with VERIFY gates**: this is the INNER plan for the `systems`
   stage. Apply the phase-granularity rules (one concern per phase; split
   sprite-gen from system-wiring; short VERIFY lines).
4. Pull game-feel/balance targets from `conventions/game-design.md`.

**This is an approval gate** — the spec is the contract. Summarize it and get the
user's sign-off before checkpointing (`pipeline.py done spec --approved`).
