# Arena Survivor Seed — Endless Vanguard

A juicy, asset-free Vampire-Survivors-style arena survivor: you move, your weapon auto-fires at the nearest enemy, hordes converge from a ring just off-screen, kills drop XP orbs that magnet to you and fill a level bar, and every level-up freezes the frame for a one-of-three upgrade pick. Everything is drawn with Canvas2D primitives (no images, no external files) and all balance lives in `data/arena-config.json` (player speed/HP/i-frames, weapon cooldown/damage/range, spawn rate/cap/ramp, XP curve + magnet) so it is fully data-driven. Juice is wired per `conventions/juice.md`: hit -> screenshake scaled by combo + hit-stop + damage floater + spark burst + hurt-flash; kill -> bigger burst + heavier hit-stop; player hit -> shake + brief hit-stop + i-frame blink; level-up -> hit-stop + "LEVEL UP" floater + flash burst.

## Controls
- Move: WASD / Arrow keys (8-directional), or left-half touch joystick
- Attack: automatic — fires at the nearest enemy on a cooldown
- Level up: press 1 / 2 / 3 (or Enter / tap) to pick an upgrade card
- Pause: Esc / P
- Start / Retry: Enter / tap

Extend by editing `data/arena-config.json` (balance) or `data/strings.json` (text / locales).
