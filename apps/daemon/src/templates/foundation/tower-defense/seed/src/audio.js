var audioCtx = null;
var musicTimer = 0;
var musicStep = 0;
var musicGain = null;

var _AUDIO_DEFAULTS = { musicGain: 0.025, musicStepSec: 0.48, musicNotes: [196, 247, 220, 165] };

function ensureAudio() {
  if (!audioCtx) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    musicGain = audioCtx.createGain();
    musicGain.gain.value = _AUDIO_DEFAULTS.musicGain;
    musicGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function tickMusic(dt) {
  if (!audioCtx || state.mode === "title" || state.mode === "loading") return;
  musicTimer -= dt;
  if (musicTimer > 0) return;
  var notes = _AUDIO_DEFAULTS.musicNotes;
  var freq = notes[musicStep % notes.length];
  musicStep += 1;
  musicTimer = _AUDIO_DEFAULTS.musicStepSec;
  tone(freq, 0.08, "triangle", musicGain, 0.025);
}

function playSfx(name) {
  if (!audioCtx) return;
}

function tone(freq, duration, type, gainNode, gainValue) {
  if (!audioCtx) return;
  var osc = audioCtx.createOscillator();
  var gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = gainValue;
  osc.connect(gain);
  gain.connect(gainNode || audioCtx.destination);
  var now = audioCtx.currentTime;
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}
