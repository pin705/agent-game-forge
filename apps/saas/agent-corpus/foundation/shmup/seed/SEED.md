# Starlance — Shmup Foundation Seed

Starlance is a complete, asset-free vertical-scrolling shooter built on Canvas2D
primitives only (every ship, bullet, and star is drawn with paths/rects — no
images, no external files). It boots to a title screen, then a juicy playable
loop: your triangle ship auto-fires upward while enemy formations stream in from
the top along sine/straight/dive/swoop paths and fire stream/spread/aimed/ring
bullet patterns back at you. Killing enemies pops score floaters, screen shake,
particle bursts, and combo escalation; getting hit costs a life with hit-stop,
flash, and i-frames. Waves loop with a per-cycle difficulty ramp; at 0 lives it's
game over (restart). Bullets/enemies/stars are pooled, and everything is
data-driven via `data/shmup-config.json` (player speed/cooldown, bullet patterns,
enemy catalog) and `data/waves.json` (the wave script).

## Controls

- Arrow keys / WASD — move ship (4-directional, clamped to play field)
- Space / J / K — fire (also auto-fires on a cooldown)
- Enter / Space — start / restart
- P / Esc — pause
- Gamepad supported (left stick + face buttons)
