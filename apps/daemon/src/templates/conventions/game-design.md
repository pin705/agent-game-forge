# Design depth — turn a prompt into a structured spec.md

A one-line prompt ("a samurai survivors game") under-specifies the game. The
result is a thin engine with no progression, three identical enemies, and no
sense of why it's fun. This convention is the **design-thinking layer**: before
you write `.ogf/spec.md`, work through six design questions so the spec carries
real depth. It is adapted from a GDD (Game Design Document) structure — but
bent to OGF's reality: **vanilla JS + HTML5 Canvas, data-driven from `data/*.json`,
no frameworks.**

Read this AFTER `common.md` + your `genres/<genre>.md`, BEFORE drafting spec.md.
It does not replace the spec authorship rules in `common.md` §"Spec authorship"
— it deepens what goes into each section.

## Why this exists

> ⚠️ Recurring failure: spec writer treats spec.md as a one-paragraph blurb
> ("side-scroller, ninja, 3 levels, pixel art") and jumps to phase planning.
> The game ships playable but shallow — no core-loop tension, enemies that are
> palette-swaps with the same AI, no progression curve, a flat difficulty line.
> The fix is not more code; it's 20 minutes of design thinking captured as
> structured spec sections the later phases can execute against.

The six design lenses below map onto spec.md sections. They are **WHAT the game
IS** (per `common.md` — describe what, not how). Numbers you decide here land in
`data/*-config.json` (tuning) and catalogs land in `data/*.json` (identity).

## The six lenses (work through them in order)

| Lens | Question it answers | Lands in spec.md / data |
|---|---|---|
| 1. Design pillars | What 3 feelings must this game deliver? | spec §1 Identity |
| 2. Core loop + mechanics | What does the player DO, second to second? | spec §1, §2 (player/mechanics) |
| 3. Asset registry | Every sprite/bg/sfx the game needs, named | spec §2-6 (by-name anims) |
| 4. Tuning-config schema | Which numbers must be tweakable? | `data/*-config.json` |
| 5. Entity / catalog plan | What THINGS exist (enemies, weapons, items)? | `data/<catalog>.json` |
| 6. Content / phase roadmap | In what order does it get built + verified? | spec §7 phase plan |

---

## Lens 1 — Design pillars (3 max)

Pillars are the 2-3 load-bearing feelings the game must deliver. Every later
decision (enemy design, pacing, art) is judged against them. Write them into
spec §1 as a short block.

**Format** — verb + feeling + how it shows up mechanically:

```
Design pillars:
1. ESCALATING DREAD — the screen fills with enemies faster than you can clear
   them; the tension is "how long can I survive". (drives: ramping spawn curve,
   no safe corner, slow movement)
2. BUILD EXPRESSION — every level-up is a fork; runs feel different because
   weapon combos differ. (drives: 3-card upgrade picks, weapon evolutions)
3. JUICE PER KILL — each kill pops, shakes, drops loot; killing feels good even
   when you're losing. (drives: hit particles, XP orbs, screen shake on death)
```

**Rules:**

- **2-3 pillars, never 5+.** More than 3 means none is load-bearing.
- Each pillar names a **mechanic it drives** — a pillar with no mechanical
  consequence is marketing copy, not design.
- When two later decisions conflict, the pillar order breaks the tie (pillar 1
  wins over pillar 3).

If you can't name 3 pillars from the user's prompt, ask ONE clarifying question
in the discovery form ("what should this game FEEL like — tense survival, power
fantasy, or methodical puzzle?") rather than guessing.

---

## Lens 2 — Core loop + mechanics

The **core loop** is the 5-30 second cycle the player repeats for the whole
game. Name it explicitly in spec §1. If you can't describe the loop in one
sentence, the game isn't designed yet.

```
Core loop (arena survivor):
  move to dodge → weapons auto-fire → enemies die → collect XP orbs →
  level up → pick an upgrade → enemies get harder → repeat until death.
```

```
Core loop (shmup):
  scroll forward → dodge bullet patterns → shoot the wave → grab power-up →
  next formation arrives → boss at stage end.
```

Then list the **mechanics** that make the loop work, in spec §2. A mechanic =
a player-facing verb plus its rule. Describe by name; the genre file + recipes
supply the vanilla-Canvas implementation.

| Mechanic field | Example | Notes |
|---|---|---|
| Movement | "8-way WASD, no diagonal speed boost" | normalize the vector |
| Primary action | "weapons auto-fire on cooldown" | no manual aim (VS-style) |
| Defense / mitigation | "i-frames after a hit; dash with cooldown" | |
| Progression verb | "XP orbs → level → pick 1 of 3 upgrade cards" | the meta-loop |
| Fail state | "HP reaches 0 → run ends → score screen" | |
| Win state (if any) | "survive 20 min OR kill final boss" | survivors often have none |

**Anti-pattern**: listing genre mechanics that the chosen genre doesn't have
(gravity/jump in a top-down arena; manual aim in a VS-like). Cross-check
against `genres/<genre>.md` §Mechanics — the genre file is binding.

**Combat-style honoring**: if the user picked `combat_style: none`, the loop
must NOT center on attacking. See `common.md` §"respect combat_style: none".

---

## Lens 3 — Asset registry

Enumerate every visual + audio asset the game needs, BY NAME, before phase
planning. This is the single highest-value design artifact — it makes the phase
plan fall out almost mechanically (one sprite-gen phase per character family,
per `common.md` §"Module architecture").

> ⚠️ OGF deviation from a generic GDD: a generic GDD asset table includes a
> `params` column with `frameCount`, `resolution`, `tileset_size`. **OGF spec.md
> must NOT carry those** — per `common.md` §"Spec authorship", frame
> counts/grids/resolutions are skill-time decisions, not spec-time. The registry
> records WHAT asset and its animations BY NAME; the `generate2dsprite` /
> `generate2dmap` skill picks the grid at invocation time.

**Registry table** (put in spec §2-6, grouped by entity; this is a worked
planning table, not a literal spec block):

| role | id | view | animations (by name) | source |
|---|---|---|---|---|
| player | `ronin` | side / top-down | idle, walk, attack, hurt | fetch→gen |
| enemy | `bat` | top-down | idle, fly | fetch→gen |
| enemy | `skeleton` | top-down | idle, walk, attack | gen |
| boss | `ancient_skull` | top-down | idle, attack, death | gen |
| projectile | `arrow` | — | (single sheet) | fetch |
| pickup | `xp_orb` | — | (single sheet) | fetch |
| background | `grass_tile` | tileable | — | fetch→gen |
| sfx | `hit`, `level`, `death` | — | WebAudio tones (no .mp3) | code |

**Rules:**

- **`source` column** drives cost. Per `common.md` §"Asset sourcing", try the
  free broker (`fetch-asset.py`) BEFORE generating. Mark `fetch` for anything a
  CC0 pack likely covers (orbs, common tiles, sfx), `gen` only for custom-style
  signature art. `fetch→gen` = try fetch first, fall back to gen.
- **Animations BY NAME only.** "idle, walk, attack" — never "idle (2×2)". The
  grid is the skill's call.
- **One character per sprite entity.** A sprite sheet contains exactly one
  character (per `common.md` palette/anchor rules).
- **Audio is code, not files.** OGF uses WebAudio tones/noise in `src/audio.js`
  driven by `data/audio-config.json` — list sfx by event name (`hit`, `level`,
  `death`), not as `.mp3` assets. No audio files to generate or fetch.
- **View** must match the genre (side-scroll → side; arena/shmup → top-down or
  fixed). The genre file's art-direction section is binding.

The registry tells you the **sprite-gen phase count**: one phase per character
family (player / each enemy / boss), per `common.md` phase-granularity rules.

---

## Lens 4 — Tuning-config schema (`data/*-config.json`)

Per `common.md` §"Module architecture" rule 3, split JSON into **tuning**
(`*-config.json`) and **identity** (`*.json`). This lens designs the tuning
files: every number a designer (or the user, in chat) would want to tweak
without touching code.

> OGF deviation from a generic GDD: a generic GDD wraps every value as
> `{ "value": X, "type": "...", "description": "..." }`. **OGF does NOT use that
> wrapper.** OGF config is plain JSON read by `src/config.js` — `{ "gravity": 1200 }`,
> accessed as `CONFIG.gravity`. Keep it flat and plain. Use canonical shapes
> (point/rect/circle/polygon per `common.md`) for any spatial value.

**What belongs in tuning config** (numbers that shape *feel*):

- Player: max HP, move speed, i-frame duration, dash speed/cooldown
- Combat: damage, attack cooldown, projectile speed, knockback
- Difficulty curve: spawn rate over time, HP scaling, wave timing
- Progression: XP curve coefficients, stat growth per level
- Juice: screen-shake magnitude, particle counts, hit-flash duration
- Camera: follow speed, deadzone size, lookahead distance
- Audio: per-cue tone frequency + gain

**What belongs in identity catalogs** (which THINGS exist) — see Lens 5.

**Example tuning file** (`data/difficulty-config.json`, plain JSON, no wrapper):

```json
{
  "spawnCurve": { "baseInterval": 1.5, "minInterval": 0.4, "rampSeconds": 600 },
  "enemyHpScale": { "perMinute": 0.15 },
  "screenShake": { "onHit": 2, "onDeath": 8 },
  "magnetRadius": 90
}
```

Name files by subsystem: `physics-config.json`, `battle-config.json`,
`progression-config.json`, `audio-config.json`, `camera-config.json`,
`difficulty-config.json`. One subsystem per file so a balance pass touches one
file and can't break a catalog parser.

---

## Lens 5 — Entity / catalog plan (`data/*.json`)

Catalogs are the **identity** half: arrays of objects describing what things
exist. Per `common.md` §"Catalogs", every array entry needs a unique `id`, and
multi-action entities use the `animations: {}` open object (one key per action),
single-action entities use a flat `sprite`.

**Design each catalog so entries are mechanically DISTINCT, not palette-swaps.**
This is where shallow games die: three enemies named differently but identical
in stats + AI. Give each catalog axis of variation:

| Catalog | Axis of meaningful variation |
|---|---|
| enemies | speed vs HP vs damage vs behavior (chase / ranged / swarm / tank) |
| weapons | pattern (forward / ring / orbit / homing) + cadence + damage |
| upgrades | stat boost vs new weapon vs weapon evolution |
| items / pickups | instant (heal) vs persistent (magnet+) vs currency |
| bosses | phase thresholds + attack pattern per phase |

**Enemy roster rule of thumb** (a roster that feels alive): include at minimum a
*fodder* (cheap, many), a *threat* (forces a reaction), and a *spike* (boss or
elite). Three palette-swapped fodder is the anti-pattern.

**Example catalog** (`data/enemies.json`, identity — stats here, balance curve
in `difficulty-config.json`):

```json
[
  { "id": "bat",      "role": "fodder", "size": { "w": 40, "h": 32 },
    "stats": { "hp": 2, "speed": 120, "damage": 1 }, "ai": "chase",
    "animations": { "idle": { "sprite": "assets/sprites/bat/idle/sheet.png" },
                    "fly":  { "sprite": "assets/sprites/bat/fly/sheet.png" } } },
  { "id": "skeleton", "role": "threat", "size": { "w": 48, "h": 64 },
    "stats": { "hp": 8, "speed": 70, "damage": 2 }, "ai": "chase",
    "animations": { "idle":   { "sprite": "assets/sprites/skeleton/idle/sheet.png" },
                    "walk":   { "sprite": "assets/sprites/skeleton/walk/sheet.png" },
                    "attack": { "sprite": "assets/sprites/skeleton/attack/sheet.png" } } }
]
```

Keep base stats in the catalog; keep the *curve that scales them over time* in
the tuning config. The runtime composes `scaledStat = base * curve(t)` — don't
bake the curve into the catalog (per the progression recipes).

---

## Lens 6 — Content / phase roadmap

The roadmap is spec §7. The six lenses above make it nearly mechanical: one
phase per asset family, one phase per system, short VERIFY gates. Follow
`common.md` §"Phase plan" rules in full — especially:

- **Split character-gen phases from system-wire phases** (one sprite family =
  one phase; wiring its behavior = another).
- **Each system gets its own phase** (spawner, auto-attack, XP, level-up,
  bullet patterns, scrolling-bg, waves — each is one phase, never combined).
- **VERIFY gate per phase** = one thing the user can confirm in <30s. If your
  VERIFY line lists 4+ outcomes, split the phase.
- **Per-scene expansion** for multi-step visual pipelines (don't flatten).
- **Honor `combat_style: none`** — no enemy/boss phases if the user opted out.

The genre file lists the canonical phase plan for that genre; start from it and
fill in spec-specific phases the lenses surfaced (e.g. a "weapon evolution"
system phase that the upgrades catalog implies).

**Map each phase to the recipes it should read first** (per `common.md`
§"Recipes — read at phase execution time"). Example for arena-survivor:

| Phase | Read recipe first |
|---|---|
| Wave spawner + difficulty curve | `recipes/arena-survivor/wave-spawner.md` |
| Auto-fire weapons | `recipes/arena-survivor/auto-attack.md` |
| XP orbs + level-up cards | `recipes/arena-survivor/xp-and-levelup.md` |

For shmup: `recipes/shmup/{scrolling-bg, enemy-waves, bullet-patterns}.md`.

---

## Quick self-check before writing spec.md

- [ ] 2-3 design pillars, each naming a mechanic it drives
- [ ] Core loop stated in ONE sentence; mechanics list cross-checked against the
      genre file (no gravity in top-down, no manual aim in VS-like, etc.)
- [ ] Asset registry enumerates every sprite/bg/sfx BY NAME, animations by name
      (no frame counts/grids), `source` column marks fetch-vs-gen
- [ ] Tuning numbers separated into `*-config.json` (plain JSON, NO `{value:}`
      wrapper); identity in `*.json` catalogs (every entry has `id`)
- [ ] Each catalog has an axis of real variation — no palette-swap rosters
- [ ] Phase plan: one phase per asset family + one per system, short VERIFY
      gates, mapped to the recipe each phase reads first
- [ ] Everything is vanilla Canvas 2D + OGF JSON shapes — no framework, no Tiled
      import, no `{ "value": X }` config wrapper, no HUD framework (canvas is UI)

If every box is checked, the spec carries the design depth that keeps the
shipped game from feeling thin.
