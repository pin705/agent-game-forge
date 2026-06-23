# Grid-Logic Seed — Shadow Dungeon

Roguelike/puzzle. Discrete cell movement, turn-based, undo stack.

**Controls:**
- Arrow keys: move / attack adjacent enemies
- Z: undo last move
- Enter: start game / retry

**Rules:**
- Reach the green ★ exit to win
- Pick up ◆ items for bonus points
- Attack enemies by moving into them (2 damage per hit)
- Enemies deal 1 damage per contact

**Extend:**
- Add rooms to `data/level_1.json` `grid[][]`
- Add entity types in `src/entities.js`
- Add new levels to `data/levels.json` + new level JSON files
- Add skills / items in `src/turn.js` `playCard` / interact handlers
