// Headless runtime smoke test for an OGF vanilla-Canvas game.
// Stubs the browser (Canvas2D/Image/fetch/WebAudio/rAF/DOM), loads every
// <script src> from index.html in order as ONE shared-scope bundle (mirrors how
// the browser shares classic-script globals), boots, then pumps frames in both
// title and playing modes — surfacing the runtime errors the static verifier can't.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.argv[2];
const FRAMES = Number(process.argv[3] ?? 180);
const errors = [];
const rec = (where, e) => errors.push({ where, msg: e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : (e && e.message) || String(e) });

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));

function elementStub() {
  const style = new Proxy({}, { get(t, p) { if (p === 'setProperty') return (k, v) => { t[k] = v; }; if (p === 'getPropertyValue') return (k) => t[k] ?? ''; if (p === 'removeProperty') return (k) => { delete t[k]; }; return t[p]; }, set(t, p, v) { t[p] = v; return true; } });
  const o = { style, dataset: {}, children: [], width: 1280, height: 720, textContent: '', innerHTML: '', value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext: () => ctx, getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, width: 1280, height: 720, right: 1280, bottom: 720 }) };
  return new Proxy(o, { get(t, p) {
      if (p === 'addEventListener') return (ty, cb) => { (listeners[ty] || (listeners[ty] = [])).push(cb); };
      if (p in t) return t[p];
      return () => (p === 'querySelector' ? elementStub() : p === 'querySelectorAll' ? [] : undefined);
    }, set(t, p, v) { t[p] = v; return true; } });
}
const ctx = new Proxy({}, { get(t, p) {
    if (p === 'canvas') return canvas;
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (p === 'createPattern') return () => ({});
    if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    if (p === 'drawImage') return (img, ...rest) => { // faithful: browsers throw on these
        if (img == null) throw new TypeError("drawImage: image argument is null/undefined");
        if (img.__broken === true || img.width === 0 || img.height === 0 || img.complete === false) throw new Error("drawImage: HTMLImageElement is in a broken/incomplete state (load failed or zero-size)");
        for (const n of rest) if (typeof n === 'number' && !Number.isFinite(n)) throw new Error("drawImage: non-finite coordinate (" + n + ")");
      };
    if (p in t) return t[p];
    return () => undefined; // any other 2D method is a no-op
  }, set(t, p, v) { t[p] = v; return true; } });
const canvas = elementStub();

class ImageStub {
  constructor() { this._src = ''; this.onload = null; this.onerror = null; this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; this.complete = false; this.__broken = true; }
  set src(v) { this._src = v; const abs = path.join(ROOT, String(v).replace(/^\.?\//, '')); queueMicrotask(() => {
      try {
        if (!fs.existsSync(abs)) { this.__broken = true; this.complete = true; this.onerror && this.onerror(new Error('404 ' + v)); return; }
        const buf = fs.readFileSync(abs);
        const isPng = buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        if (!isPng) { this.__broken = true; this.complete = true; this.onerror && this.onerror(new Error('undecodable image ' + v)); return; }
        this.width = this.naturalWidth = buf.readUInt32BE(16);   // PNG IHDR width
        this.height = this.naturalHeight = buf.readUInt32BE(20); // PNG IHDR height
        this.complete = true; this.__broken = (this.width === 0 || this.height === 0);
        if (this.__broken) this.onerror && this.onerror(new Error('zero-dim image ' + v));
        else this.onload && this.onload();
      } catch (e) { this.__broken = true; this.complete = true; this.onerror && this.onerror(e); }
    }); }
  get src() { return this._src; }
  addEventListener(ev, cb) { if (ev === 'load') this.onload = cb; if (ev === 'error') this.onerror = cb; }
}
function fakeFetch(url) {
  const abs = path.join(ROOT, String(url).replace(/^\.?\//, ''));
  const ok = fs.existsSync(abs);
  return Promise.resolve({ ok, status: ok ? 200 : 404,
    json: async () => JSON.parse(fs.readFileSync(abs, 'utf8')),
    text: async () => fs.readFileSync(abs, 'utf8'),
    arrayBuffer: async () => fs.readFileSync(abs).buffer });
}
let rafCb = null, clock = 0;
const node = () => new Proxy({ value: 0 }, { get(t, p) { if (p === 'connect') return () => node(); if (p === 'gain' || p === 'frequency' || p === 'detune') return node(); if (p in t) return t[p]; return () => undefined; }, set(t, p, v) { t[p] = v; return true; } });
class AudioCtx { constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; this.sampleRate = 44100; } createOscillator() { return node(); } createGain() { return node(); } createBuffer() { return { duration: 0, length: 0, numberOfChannels: 1, sampleRate: 44100, getChannelData: () => new Float32Array(0), copyToChannel() {}, copyFromChannel() {} }; } createBufferSource() { return node(); } createBiquadFilter() { return node(); } createDynamicsCompressor() { return node(); } decodeAudioData() { return Promise.resolve(this.createBuffer()); } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } }

const con = { log: console.log, info: console.log, debug() {}, warn: (...a) => console.warn('  [warn]', ...a),
  error: (...a) => { rec('console.error', a.map((x) => (x && x.stack) || (x && x.message) || String(x)).join(' ')); } };
const listeners = {};
const fire = (type, ev) => { for (const cb of (listeners[type] || [])) { try { cb(ev); } catch (e) { rec(type + ' handler', e); } } };
const key = (code, down) => fire(down ? 'keydown' : 'keyup', { code, key: code, preventDefault() {}, stopPropagation() {} });
const mouse = (type, x, y) => fire(type, { offsetX: x, offsetY: y, clientX: x, clientY: y, pageX: x, pageY: y, button: 0, buttons: 1, target: canvas, preventDefault() {}, stopPropagation() {} });
const g = {
  console: con, Math, JSON, Date, Object, Array, String, Number, Boolean, Set, Map, WeakMap, WeakSet, Symbol, Promise, RegExp, Error, TypeError,
  parseInt, parseFloat, isNaN, isFinite, Infinity, NaN, queueMicrotask, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; }, cancelAnimationFrame() {}, performance: { now: () => clock },
  Image: ImageStub, fetch: fakeFetch, AudioContext: AudioCtx, webkitAudioContext: AudioCtx,
  navigator: { userAgent: 'node', maxTouchPoints: 0, getGamepads: () => [] }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, alert() {},
  addEventListener: (t, cb) => { (listeners[t] || (listeners[t] = [])).push(cb); }, removeEventListener() {},
  document: { getElementById: (id) => (id === 'game' ? canvas : elementStub()), querySelector: () => elementStub(), querySelectorAll: () => [],
    createElement: () => elementStub(), addEventListener: (t, cb) => { (listeners[t] || (listeners[t] = [])).push(cb); }, removeEventListener() {}, body: elementStub(), documentElement: elementStub(),
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve(), add() {} } },
};
g.window = g; g.self = g; g.globalThis = g;
const context = vm.createContext(g);

let bundle = '';
for (const s of srcs) {
  const abs = path.join(ROOT, s);
  if (!fs.existsSync(abs)) { console.log('  MISSING SCRIPT', s); continue; }
  bundle += `\n//=== ${s} ===\n` + fs.readFileSync(abs, 'utf8') + '\n';
}
bundle += '\nfunction __probe(){ try { var s=(typeof state!=="undefined")?state:{}; return { mode:s.mode??null, px:(s.player)?Math.round(s.player.x):null, P:(s.particles||[]).length, F:(s.floaters||[]).length, T:(s.trails||[]).length, TW:(s.tweens||[]).length, IMG:(typeof images!=="undefined")?Object.keys(images).length:-1, FX:(s.battle&&s.battle.effects)?s.battle.effects.length:-1, DQ:(s.dialogueQueue||[]).length, EN:(s.enemies||[]).length, PR:(s.projectiles||[]).length }; } catch(e){ return { err:String(e) }; } }\n';
try { vm.runInContext(bundle, context, { filename: 'bundle.js' }); } catch (e) { rec('script parse/exec', e); }

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
await flush(); // boot()'s async chain
try { if (typeof context.startNewRun === 'function') context.startNewRun(); } catch (e) { rec('startNewRun', e); }
await flush();
const p0 = (typeof context.__probe === 'function') ? context.__probe() : null;
for (let f = 0; f < FRAMES; f++) {
  // Drive a real player: start, hold right, jump + attack on a cadence, interact, pause/unpause.
  if (f === 12) key('KeyD', true); // hold run-right
  if (f % 22 === 9) key('ArrowRight', true); if (f % 22 === 12) key('ArrowRight', false);
  if (f % 28 === 10) key('ArrowUp', true); if (f % 28 === 13) key('ArrowUp', false);
  if (!process.env.NOACT) {
    if (f === 2) key('Enter', true); if (f === 5) key('Enter', false);
    if (f % 45 === 20) key('Space', true); if (f % 45 === 26) key('Space', false);
    if (f % 35 === 15) key('KeyJ', true); if (f % 35 === 19) key('KeyJ', false);
    if (f === 80) key('KeyE', true); if (f === 83) key('KeyE', false);
    if (f === 140) key('KeyP', true); if (f === 142) key('KeyP', false);
    if (f === 150) key('KeyP', true); if (f === 152) key('KeyP', false);
    if (f === 64) key('KeyZ', true); if (f === 66) key('KeyZ', false);
    if (f % 30 === 14) { const mx = 360 + (f % 6) * 90, my = 320 + (f % 3) * 70; mouse('pointerdown', mx, my); mouse('mousedown', mx, my); mouse('click', mx, my); mouse('mouseup', mx, my); mouse('pointerup', mx, my); }
  }
  clock += 1000 / 60;
  if (rafCb) { const cb = rafCb; rafCb = null; try { cb(clock); } catch (e) { rec('frame ' + f, e); break; } }
  await Promise.resolve();
}

if (errors.length) {
  console.log(`\nSMOKE: FAIL — ${errors.length} runtime error(s):`);
  for (const e of errors.slice(0, 6)) console.log(`  [${e.where}] ${e.msg}`);
  process.exit(1);
} else {
  const p1 = (typeof context.__probe === 'function') ? context.__probe() : null;
  const moved = p0 && p1 && p0.px != null && p1.px != null && p1.px !== p0.px;
  console.log(`\nSMOKE: PASS — booted + ran ${FRAMES} frames clean (title + playing + render).`);
  console.log(`  play: mode=${p1 && p1.mode}  player.x ${p0 && p0.px} → ${p1 && p1.px}  ${moved ? '(MOVES on input ✓)' : '(did NOT move ✗)'}`);
  console.log(`  sizes p0→p1: ${JSON.stringify(p0)} → ${JSON.stringify(p1)}`);
}
