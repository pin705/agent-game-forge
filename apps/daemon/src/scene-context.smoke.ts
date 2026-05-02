// Smoke test: verify formatSceneContextSnippet builds the expected per-turn
// snippet for a real scene-context.json dump.
import { readSceneContext, formatSceneContextSnippet } from './scene-context.js';

const PROJECT = 'D:\\kindomrush';

const ctx = readSceneContext(PROJECT);
if (!ctx) {
  console.error('[FAIL] no scene-context.json — open the kindomrush scene in OGF first.');
  process.exit(1);
}

console.log('--- raw context summary ---');
console.log(`  scene: ${ctx.scene?.relPath}`);
console.log(`  selected: ${ctx.selected?.nodePath ?? 'none'}`);
console.log(`  stats: ${JSON.stringify(ctx.stats)}`);

console.log('\n--- snippet without simulated selection ---');
const noSel = formatSceneContextSnippet(ctx);
console.log(noSel);
console.log(`(length: ${noSel.length} chars)`);

// Force a simulated selection on OakTree_Northwest to see nearby logic.
const oak = ctx.props?.find((p) => p.name === 'OakTree_Northwest');
if (oak) {
  const withSel = formatSceneContextSnippet({
    ...ctx,
    selected: {
      kind: 'prop',
      nodePath: oak.nodePath,
      name: oak.name,
      position: oak.position,
      scale: oak.scale,
      texture: oak.texture,
    },
  });
  console.log('\n--- snippet with OakTree_Northwest selected ---');
  console.log(withSel);
  console.log(`(length: ${withSel.length} chars)`);

  // Token estimate: roughly 4 chars / token. Print rough count.
  console.log(`\nrough token estimate: ${Math.ceil(withSel.length / 4)} tokens`);
}
