# Tower Defense Seed — Iron Bastion

Kingdom Rush style. Enemies walk a polyline path; you place towers on build spots.

**Controls:**
- Click tower type (right panel) to select
- Click near a build spot to place
- Enter: start game / retry

**Economy:** Start with $150 gold. Earn gold per enemy killed. Don't let enemies reach the exit.

**Extend:**
- Add more waves to `data/guandu_pass.json` `waves[]`
- Add tower types to `TOWER_TYPES` in `src/constants.js`
- Add enemy types to `ENEMY_STATS` in `src/enemies.js`
- Add new build spots to `data/guandu_pass.json` `buildSpots[]`
