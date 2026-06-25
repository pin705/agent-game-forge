# Discovery director

**Stage goal:** learn what game to build before writing anything.

**Produces:** `discovery_answers` (the user's choices, folded into spec §1 next stage).

## Process

1. Emit the mandatory `<question-form>` defined in `conventions/common.md`
   ("MANDATORY: discovery form must include genre and animation_richness"). It
   MUST include `genre`, `animation_richness`, `module_style`; add `title`,
   `world/setting`, `palette/art style`, `references`, and `combat_style`
   (`none` for pure-platformer/puzzle).
2. Keep it to one form. Don't ask engineering questions (frame counts, parallax
   layer counts, platform strategy) — those are skill decisions, not user ones.
3. **This is an approval gate.** Wait for the user's answers before checkpointing.

## Done when

Genre + animation_richness + module_style are chosen and you've read the matching
`conventions/genres/<genre>.md`. Checkpoint: `pipeline.py done discovery --approved`.
