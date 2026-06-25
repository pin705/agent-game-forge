# Archetype classifier — route an idea to the right genre (physics-first)

Adopted from OpenGame's game-type classifier. Genre NAMES mislead — "puzzle",
"RPG", "arcade" each span several archetypes. Classify by **physics** instead:
gravity + perspective + movement. It's unambiguous and maps cleanly to OGF genres.

## When to use

At the **discovery** stage, when the user's idea is vague or could fit multiple
genres. If they clearly name one, just use it. Otherwise classify, then set the
discovery form's `genre` default to the result.

## The five archetypes

| Archetype | Gravity | Perspective | Movement | OGF genre | Examples |
|---|---|---|---|---|---|
| platformer | YES (Y) | side | continuous L/R + jump | `side-scroll` | Mario, Mega Man, Celeste |
| top-down action | none | top-down | free 8-direction | `top-down-rpg` (explore/NPC/story) or `arena-survivor` (waves/survival) | Zelda, Isaac, Vampire Survivors |
| grid / logic | none | top-down (front for match-3) | discrete cell steps | `grid-logic` | Sokoban, chess, Fire Emblem, Tetris, Match-3 |
| tower defense | enemies on fixed paths | top-down | path-follow + click | `tower-defense` | Kingdom Rush, Bloons |
| ui / panel | ~none | UI panels | click / tap | `ui-heavy` | Slay the Spire, visual novels, idle/clicker |

`shmup` is a scrolling-shooter variant of top-down/side action — pick it when the
core loop is dodging + shooting on a scrolling field.

## Key questions (ask in order)

1. Does the character **FALL** when not on ground? → YES = platformer → `side-scroll`.
2. Can it move **UP freely** without jumping? → top-down. Endless waves/survival → `arena-survivor`; explore + NPCs + story → `top-down-rpg`; scrolling shooter → `shmup`.
3. Does it move in **discrete grid steps**, or is the board a grid? → `grid-logic`.
4. **Fixed enemy paths** + you place defenses + timed waves? → `tower-defense`.
5. Mostly **panels / cards / text / buttons**, almost no avatar movement? → `ui-heavy`.

## Anti-mistakes (genre name ≠ archetype)

- **Terraria** is NOT top-down — it has gravity → platformer (`side-scroll`).
- **Angry Birds** is NOT "puzzle" mechanically — gravity → platformer physics.
- **Match-3 / Tetris** ARE `grid-logic` (discrete grid), not arcade top-down.
- A **card battler** (Slay the Spire) is `ui-heavy`, even if it shows a "map".
- **SimCity**-style building is `grid-logic`, not top-down action.

After classifying, set the discovery `genre` and read `.ogf/conventions/genres/<genre>.md`.
