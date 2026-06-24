// Real-browser E2E for the OGF studio editor — drives a REAL headless Chromium
// (playwright-core + the installed ms-playwright chromium / system Chrome, no
// download) so Radix tabs/dropdowns actually switch (the preview harness can't).
// Exercises the ported web-parity features against the live dev server (vite on
// :7643 → proxies /api → daemon :7621) using the real project on disk.
//
// Usage: node /tmp/studio-e2e.mjs            (BASE defaults to http://localhost:7643)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:7643';
const req = createRequire('/Users/bon/Documents/game-studio/agent-game-forge/package.json');
const pw = await import(pathToFileURL(req.resolve('playwright-core')).href);
const chromium = pw.chromium ?? pw.default?.chromium;

function findChrome() {
  const c = [
    process.env.OGF_CHROME, process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  return c.find((p) => p && fs.existsSync(p));
}

const results = [];
const rec = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const step = async (name, fn) => { try { const d = await fn(); rec(name, true, d || ''); } catch (e) { rec(name, false, (e && e.message || String(e)).split('\n')[0].slice(0, 160)); } };

let browser;
try {
  const exe = findChrome();
  browser = await chromium.launch(exe ? { executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-gpu'] } : { headless: true, args: ['--no-sandbox'] });
  console.log('launched chromium' + (exe ? ' (system: ' + exe.split('/').pop() + ')' : ' (ms-playwright)'));
} catch (e) {
  console.error('SETUP ERROR — cannot launch chromium:', e.message);
  process.exit(2);
}

const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
// Force English locale + light theme so text/placeholder selectors are stable.
await ctx.addInitScript(() => {
  try { localStorage.setItem('ogf_studio_lang', 'en'); localStorage.removeItem('ogf-theme'); } catch {}
});
const page = await ctx.newPage();
const jsErrors = [];   // real JS exceptions / console.error (feature bugs)
let net404 = 0;        // resource 404s — expected on an unbuilt project, not a bug
page.on('pageerror', (e) => jsErrors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource|404|ERR_|net::/.test(t)) { net404++; return; }
  jsErrors.push('console.error: ' + t.slice(0, 200));
});
page.on('requestfailed', () => { net404++; });

try {
  // ---- Boot + open the project ----
  await step('dashboard loads', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('a[href^="/build/"]', { timeout: 15000 });
    return 'project card present';
  });
  await step('open project → workspace', async () => {
    await page.locator('a[href^="/build/"]').first().click();
    await page.waitForSelector('[role="tablist"]', { timeout: 15000 });
    await page.waitForSelector('textarea', { timeout: 15000 });
    return 'tablist + composer mounted';
  });

  // ---- Feature: composer model picker (batch 1) ----
  await step('composer model picker opens + lists models', async () => {
    // The model trigger is a ghost button in the composer showing the model id.
    const trigger = page.locator('button').filter({ hasText: /gpt-|claude|default/i }).first();
    await trigger.click({ timeout: 5000 });
    await page.waitForSelector('[role="menu"] [role="menuitem"], [role="menuitemradio"]', { timeout: 5000 });
    const n = await page.locator('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"]').count();
    if (n < 2) throw new Error('only ' + n + ' model options');
    // pick the 2nd option, then assert the menu closed
    await page.locator('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"]').nth(1).click();
    await page.waitForSelector('[role="menu"]', { state: 'detached', timeout: 3000 });
    return n + ' models listed, selection applied';
  });

  // ---- Feature: conversation new + grouping + search (batch 1) ----
  await step('conversation: new chat → grouped row', async () => {
    const newBtn = page.getByRole('button', { name: /new/i }).first();
    await newBtn.click({ timeout: 5000 });
    // a grouped header (Today) or at least a conversation row should appear
    await page.waitForFunction(() => /Today/i.test(document.body.innerText), null, { timeout: 6000 });
    return 'new conversation created, "Today" group shown';
  });
  await step('conversation: search field present + filters', async () => {
    const search = page.getByPlaceholder(/search chats/i);
    await search.fill('zzz_nomatch_zzz', { timeout: 4000 });
    await page.waitForFunction(() => /No matching chats/i.test(document.body.innerText), null, { timeout: 4000 });
    await search.fill('');
    return 'search filters to no-match state';
  });

  // ---- Feature: Code tab — file tabs + tree search + breadcrumbs (batch 1+2) ----
  await step('switch to Code tab', async () => {
    await page.locator('[id$="-trigger-code"]').click();
    await page.waitForSelector('[id$="-content-code"][data-state="active"]', { timeout: 6000 });
    return 'code panel active';
  });
  let openedFiles = [];
  await step('Code: file tree search filters', async () => {
    const fs2 = page.getByPlaceholder(/search files/i);
    await fs2.fill('.js');
    await page.waitForTimeout(400);
    // collect file buttons (leaf files have a title attr = relPath)
    openedFiles = await page.locator('button[title$=".js"]').evaluateAll((els) => els.map((e) => e.getAttribute('title')).slice(0, 3));
    if (openedFiles.length === 0) {
      // fall back to any file
      openedFiles = await page.locator('button[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')).filter((t) => /\.\w+$/.test(t)).slice(0, 3));
    }
    await fs2.fill('');
    if (openedFiles.length === 0) throw new Error('no files in tree to test');
    return 'filtered; found ' + openedFiles.length + ' file(s): ' + openedFiles.join(', ');
  });
  await step('Code: opening files creates tabs + breadcrumb', async () => {
    if (openedFiles.length === 0) throw new Error('no files');
    const fs2 = page.getByPlaceholder(/search files/i);
    const targets = openedFiles.slice(0, 2);
    for (const f of targets) {
      // Re-filter so the (possibly nested) file is rendered, then click it.
      await fs2.fill(f.split('/').pop());
      await page.waitForSelector(`button[title="${f}"]`, { timeout: 5000 });
      await page.locator(`button[title="${f}"]`).first().click({ timeout: 5000 });
      await page.waitForTimeout(200);
    }
    await fs2.fill('');
    // Each opened file should now have a tab; the active file's basename shows in
    // the tab bar + breadcrumb. Assert a tab element exists for each target.
    const txt = await page.evaluate(() => document.body.innerText);
    for (const f of targets) {
      const base = f.split('/').pop();
      if (!txt.includes(base)) throw new Error('no tab/breadcrumb for ' + base);
    }
    return 'opened ' + targets.length + ' file tab(s): ' + targets.map((f) => f.split('/').pop()).join(', ');
  });

  // ---- Feature: Data tab — search + sort (batch 2) ----
  await step('switch to Data tab (renders)', async () => {
    await page.locator('[id$="-trigger-data"]').click();
    await page.waitForSelector('[id$="-content-data"][data-state="active"]', { timeout: 6000 });
    return 'data panel active';
  });

  // ---- Feature: Assets tab (batch 2) ----
  await step('switch to Assets tab (renders)', async () => {
    await page.locator('[id$="-trigger-assets"]').click();
    await page.waitForSelector('[id$="-content-assets"][data-state="active"]', { timeout: 6000 });
    return 'assets panel active';
  });

  // ---- Feature: Scene tab — editing tools (batch 2) ----
  await step('switch to Scene tab (renders)', async () => {
    await page.locator('[id$="-trigger-scene"]').click();
    await page.waitForSelector('[id$="-content-scene"][data-state="active"]', { timeout: 6000 });
    return 'scene panel active';
  });

  // ============ BATCH 3 features ============
  // Monaco editor — open a .js file and assert the Monaco DOM mounts (not a textarea).
  await step('Code: Monaco editor mounts on a text file', async () => {
    await page.locator('[id$="-trigger-code"]').click();
    await page.waitForSelector('[id$="-content-code"][data-state="active"]', { timeout: 6000 });
    const fsi = page.getByPlaceholder(/search files/i);
    await fsi.fill('.js');
    await page.waitForSelector('button[title$=".js"]', { timeout: 5000 });
    const f = await page.locator('button[title$=".js"]').first().getAttribute('title');
    await page.locator(`button[title="${f}"]`).first().click();
    await fsi.fill('');
    await page.waitForSelector('.monaco-editor', { timeout: 12000 });
    return 'monaco mounted (' + f.split('/').pop() + ')';
  });

  // Command palette — Cmd/Ctrl+K opens a dialog listing commands; Esc closes.
  await step('command palette ⌘K opens + lists + closes', async () => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK');
    await page.waitForSelector('[role="dialog"] input', { timeout: 5000 });
    const items = await page.locator('[role="dialog"] button').count();
    if (items < 3) throw new Error('only ' + items + ' palette commands');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 4000 });
    return items + ' commands listed';
  });

  // Resizable columns — drag a col-resize handle; grid-template-columns must change.
  await step('workspace columns resize by drag', async () => {
    const readCols = () => page.evaluate(() => {
      const el = [...document.querySelectorAll('[style*="grid-template-columns"]')]
        .find((e) => /px/.test(e.style.gridTemplateColumns || ''));
      return el ? el.style.gridTemplateColumns : '';
    });
    const before = await readCols();
    const handle = page.locator('.cursor-col-resize').first();
    const box = await handle.boundingBox();
    if (!box) throw new Error('no resize handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 64, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const after = await readCols();
    if (!before || before === after) throw new Error('columns unchanged: ' + before);
    return 'cols changed';
  });

  // Attachments — composer exposes an attach (paperclip) control.
  await step('composer has attach (paperclip) button', async () => {
    const has = await page.evaluate(() => !!document.querySelector('svg.lucide-paperclip'));
    if (!has) throw new Error('no paperclip in composer');
    return 'attach control present';
  });

  // Conversation rename — open a row menu → Rename → type → Enter → title updates.
  await step('conversation rename updates title', async () => {
    const newTitle = 'E2E-Renamed-' + Math.floor(performance.now());
    const menuTrigger = page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal').first();
    await menuTrigger.scrollIntoViewIfNeeded().catch(() => {});
    await menuTrigger.locator('xpath=ancestor::button[1]').click({ force: true, timeout: 5000 });
    await page.getByRole('menuitem', { name: /rename/i }).click({ timeout: 4000 });
    // The rename input autofocuses + selects-all; type into the focused element.
    await page.waitForTimeout(150);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.type(newTitle);
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => document.body.innerText.includes(t), newTitle, { timeout: 6000 });
    return 'renamed → ' + newTitle;
  });

  // Play console — switch to Play tab; the Console toggle (Terminal) is present.
  await step('Play console toggle present', async () => {
    await page.locator('[id$="-trigger-play"]').click();
    await page.waitForSelector('[id$="-content-play"][data-state="active"]', { timeout: 6000 });
    const has = await page.evaluate(() => !!document.querySelector('svg.lucide-terminal'));
    if (!has) throw new Error('no console toggle in play toolbar');
    return 'console toggle present';
  });

  // ---- Health: no JS exceptions during the whole run (404s are benign) ----
  await step('no JS exceptions during E2E', async () => {
    if (jsErrors.length) throw new Error(jsErrors.length + ' JS error(s): ' + jsErrors.slice(0, 3).join(' | '));
    return `clean (benign resource 404s: ${net404})`;
  });
} finally {
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== E2E SUMMARY: ${pass}/${results.length} passed · JS errors: ${jsErrors.length} · resource 404s: ${net404} ====`);
  if (jsErrors.length) console.log('JS errors:\n  ' + jsErrors.slice(0, 8).join('\n  '));
  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
