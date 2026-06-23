let audioCtx = null;
let musicTimer = 0;
let musicStep = 0;
let musicGain = null;

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.035;
    musicGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function tickMusic(dt) {
  if (!audioCtx || state.mode === "title" || state.mode === "loading") return;
  musicTimer -= dt;
  if (musicTimer > 0) return;
  var notes = [196, 247, 220, 165];
  var freq = notes[musicStep % notes.length];
  musicStep += 1;
  musicTimer = 0.42;
  tone(freq, 0.08, "triangle", musicGain, 0.05);
}

function playSfx(name) {
  if (!audioCtx) return;
  tone(440, 0.05, "square", null, 0.08);
}

function tone(freq, duration, type, gainNode, gainValue) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = gainValue;
  osc.connect(gain);
  gain.connect(gainNode || audioCtx.destination);
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}
