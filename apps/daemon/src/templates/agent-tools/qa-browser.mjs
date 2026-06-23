#!/usr/bin/env node
// qa-browser.mjs — the PRODUCTION QA gate. Loads a built game in a REAL headless
// Chrome (via playwright-core + the system Chrome binary — no heavy download) and
// asserts the things the headless stub (gamesmoke.mjs) CANNOT see:
//   1. zero console errors / page exceptions / failed network requests (404 assets)
//   2. canvas actually RENDERS content — not a black void / single-color blank
//   3. title → play transition fires on the Start input
//   4. the frame loop stays ALIVE after input (state.time advances → no soft-lock/freeze)
//   5. no on-canvas error overlay (state.error stays null)
// Saves title + gameplay screenshots so a human (or vision check) can eyeball it.
//
// Usage:  node qa-browser.mjs <gameDir> [--port 8930] [--shots <dir>] [--play-ms 3500]
// Exit:   0 = PASS · 1 = FAIL (reasons printed) · 2 = setup error (no Chrome, etc.)
//
// This is genre-agnostic: it reads window.state generically and tolerates games
// with no spatial player (card-battler / tower-defense) — those still must render,
// transition, and keep the loop alive.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const GAME_DIR = path.resolve(args[0] || '.');
const opt = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const PORT = Number(opt('--port', 8930));
const PLAY_MS = Number(opt('--play-ms', 3500));
const SHOTS = opt('--shots', path.join(GAME_DIR, '.ogf-qa'));

if (!fs.existsSync(path.join(GAME_DIR, 'index.html'))) {
  console.error(`QA: setup error — no index.html in ${GAME_DIR}`);
  process.exit(2);
}

// ---- find a real Chrome ----------------------------------------------------
function findChrome() {
  const envPath = process.env.OGF_CHROME || process.env.CHROME_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const byPlatform = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
  };
  for (const p of (byPlatform[process.platform] || [])) if (fs.existsSync(p)) return p;
  return null;
}

// ---- tiny static server ----------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ico': 'image/x-icon' };
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(GAME_DIR, urlPath === '/' ? '/index.html' : urlPath);
      if (!filePath.startsWith(GAME_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

// ---- canvas liveness probe (runs in page) ---------------------------------
const LIVENESS_FN = `(() => {
  const c = document.querySelector('canvas');
  if (!c) return { ok: false, reason: 'no canvas element' };
  let ctx; try { ctx = c.getContext('2d'); } catch (e) { return { ok:false, reason:'getContext threw' }; }
  if (!ctx) return { ok:false, reason:'no 2d context' };
  const w = c.width, h = c.height;
  let img; try { img = ctx.getImageData(0,0,w,h).data; } catch(e){ return { ok:false, reason:'getImageData threw: '+e.message }; }
  const seen = new Set(); let nonBg = 0, n = 0;
  for (let i=0;i<img.length;i+=4*53){ const r=img[i],g=img[i+1],b=img[i+2];
    seen.add((r>>4)+'_'+(g>>4)+'_'+(b>>4)); if (r+g+b>40) nonBg++; n++; }
  const st = (typeof window.state!=='undefined') ? window.state : null;
  return { ok:true, w, h, distinctColors: seen.size, litFraction: +(nonBg/Math.max(1,n)).toFixed(3),
    mode: st ? st.mode : null, time: st ? (st.time||0) : null,
    errorSet: st ? !!st.error : false };
})()`;

// ---- main ------------------------------------------------------------------
const fails = [];
const warns = [];
const fail = (m) => fails.push(m);
const warn = (m) => warns.push(m);

const chromePath = findChrome();
if (!chromePath) {
  console.error('QA: setup error — no Chrome/Chromium found. Set OGF_CHROME=/path/to/chrome and retry.');
  process.exit(2);
}

let playwright;
try { playwright = await import('playwright-core'); }
catch { console.error('QA: setup error — playwright-core not installed (npm i -D playwright-core).'); process.exit(2); }

fs.mkdirSync(SHOTS, { recursive: true });
const server = await startServer();
const url = `http://localhost:${PORT}/index.html`;
const consoleErrors = [], pageErrors = [], failedRequests = [];
let browser;
try {
  browser = await playwright.chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));
  page.on('requestfailed', (r) => { const u = r.url(); if (!u.startsWith('data:')) failedRequests.push(`${u} (${r.failure()?.errorText || '?'})`); });
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.url()} → HTTP ${r.status()}`); });

  // 1) Load
  await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch((e) => fail(`page.goto failed: ${e.message}`));
  await page.waitForTimeout(900); // let boot()'s async chain + first frames run

  const atTitle = await page.evaluate(LIVENESS_FN);
  await page.screenshot({ path: path.join(SHOTS, 'title.png') }).catch(() => {});
  if (!atTitle.ok) fail(`canvas not renderable at load: ${atTitle.reason}`);
  else {
    if (atTitle.distinctColors < 3) fail(`title screen looks blank (only ${atTitle.distinctColors} distinct colors — likely black/single-color void)`);
    if (atTitle.litFraction < 0.002) fail(`title screen almost entirely empty (lit fraction ${atTitle.litFraction})`);
    if (atTitle.errorSet) fail('error overlay is showing on the title screen (state.error set)');
  }

  // 2) Start input → expect transition off the title/menu
  const modeBefore = atTitle.mode;
  for (const k of ['Enter', 'Space']) { await page.keyboard.press(k).catch(() => {}); await page.waitForTimeout(120); }
  await page.waitForTimeout(400);
  let afterStart = await page.evaluate(LIVENESS_FN);
  if (modeBefore && afterStart.mode === modeBefore && /title|menu|loading/i.test(String(modeBefore))) {
    // try a canvas click (card-battler / TD start buttons)
    await page.mouse.click(640, 400).catch(() => {});
    await page.waitForTimeout(400);
    afterStart = await page.evaluate(LIVENESS_FN);
  }
  if (modeBefore && afterStart.mode === modeBefore && /title|menu/i.test(String(modeBefore)))
    fail(`Start input did not leave the "${modeBefore}" screen (no title→play transition)`);

  // 3) Play for a bit holding common inputs, then check the loop is ALIVE + content present
  const t0 = afterStart.time;
  await page.keyboard.down('KeyD').catch(() => {});
  await page.keyboard.down('ArrowRight').catch(() => {});
  // periodic action inputs during play
  const end = Date.now() + PLAY_MS;
  while (Date.now() < end) {
    await page.keyboard.press('Space').catch(() => {});
    await page.keyboard.press('KeyJ').catch(() => {});
    await page.mouse.click(540 + (Date.now() % 5) * 40, 460).catch(() => {});
    await page.waitForTimeout(220);
  }
  await page.keyboard.up('KeyD').catch(() => {});
  await page.keyboard.up('ArrowRight').catch(() => {});

  const playing = await page.evaluate(LIVENESS_FN);
  await page.screenshot({ path: path.join(SHOTS, 'gameplay.png') }).catch(() => {});
  if (!playing.ok) fail(`canvas not renderable during play: ${playing.reason}`);
  else {
    if (playing.distinctColors < 4) fail(`gameplay looks blank (${playing.distinctColors} distinct colors — nothing is being drawn)`);
    if (playing.litFraction < 0.003) fail(`gameplay screen almost empty (lit fraction ${playing.litFraction})`);
    if (playing.errorSet) fail('error overlay is showing during gameplay (state.error set — a runtime error was caught)');
    if (typeof t0 === 'number' && typeof playing.time === 'number' && playing.time <= t0 + 0.05)
      fail(`frame loop appears FROZEN (state.time ${t0} → ${playing.time} over ${PLAY_MS}ms — soft-lock?)`);
  }

  // 4) Real-browser error channels
  if (consoleErrors.length) fail(`${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 4).join(' | ')}`);
  if (pageErrors.length) fail(`${pageErrors.length} uncaught page exception(s): ${pageErrors.slice(0, 4).join(' | ')}`);
  if (failedRequests.length) fail(`${failedRequests.length} failed/404 request(s): ${failedRequests.slice(0, 5).join(' | ')}`);

} catch (e) {
  fail(`harness error: ${e.message}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}

// ---- report ----------------------------------------------------------------
const tag = path.basename(path.dirname(GAME_DIR) === GAME_DIR ? GAME_DIR : GAME_DIR);
console.log(`\nQA-BROWSER · ${path.relative(process.cwd(), GAME_DIR) || GAME_DIR}`);
console.log(`  Chrome: ${chromePath}`);
console.log(`  shots:  ${path.relative(process.cwd(), SHOTS)}/{title,gameplay}.png`);
for (const w of warns) console.log(`  ⚠ ${w}`);
if (fails.length) {
  console.log(`\n  RESULT: FAIL — ${fails.length} blocker(s):`);
  for (const f of fails) console.log(`    ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`\n  RESULT: PASS — boots, renders content, transitions, loop alive, no errors/404s.`);
  process.exit(0);
}
