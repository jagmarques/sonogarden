// Endel-style texture engine: continuous pink-noise bed, slow FM sine pads, rare harp chimes.
// SOURCE Endel mode descriptions: https://endel.io (verified 2026-04-21).
// SOURCE Sleep profile: Endel homepage quote "starts with a gentle tune ... then proceeds to a
//   very soft white noise, loud enough to break the silence but quiet enough that you don't notice it".
// No beat grid. No metered progression. Everything on independent slow timers.

import * as Tone from 'tone';
import { triggerVoice, getMelodyBus, getPadBus, getVoice } from './player.js';
import { getCurrentMood } from './moods.js';

const MAJOR_TRIAD = [0, 4, 7];
const MINOR_TRIAD = [0, 3, 7];
const MAJOR_PENT = [0, 2, 4, 7, 9];
const MINOR_PENT = [0, 3, 5, 7, 10];

// Key-related chords only. Roots relative to tonic in semitones.
const MAJOR_CHORDS = [
  { root: 0,  type: 'maj' },
  { root: 5,  type: 'maj' },
  { root: 7,  type: 'maj' },
  { root: 9,  type: 'min' },
];
const MINOR_CHORDS = [
  { root: 0,  type: 'min' },
  { root: -2, type: 'maj' },
  { root: -4, type: 'maj' },
  { root: -5, type: 'maj' },
];

let _running = false;
let _padSynth = null;
let _noise = null;
let _noiseFilter = null;
let _noiseGain = null;
let _currentChord = null;
let _chordTimer = null;
let _chimeTimer = null;
let _droneTimer = null;
let _lastDroneVoice = null;

function triadFor(type) {
  return type === 'min' ? MINOR_TRIAD : MAJOR_TRIAD;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Returns "C major", "A minor", etc for the currently playing chord.
export function getCurrentChordLabel() {
  if (!_currentChord) return '';
  const mood = getCurrentMood();
  const midi = mood.tonic + _currentChord.root;
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name} ${_currentChord.type === 'min' ? 'minor' : 'major'}`;
}
function pentFor(mood) {
  return mood.scale === 'minor' ? MINOR_PENT : MAJOR_PENT;
}
function chordsFor(mood) {
  return mood.scale === 'minor' ? MINOR_CHORDS : MAJOR_CHORDS;
}

function midiToFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function ensurePadSynth() {
  if (_padSynth) return _padSynth;
  const dest = getPadBus();
  // Sine-based polyphonic pad with long attack/release for overlapping washes.
  _padSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 1.5, decay: 0, sustain: 1, release: 8 },
  }).connect(dest);
  _padSynth.volume.value = -12;
  return _padSynth;
}

// Lets setMood update pad volume from the mood descriptor.
export function setPadVolume(db) {
  if (_padSynth && typeof db === 'number') {
    try { _padSynth.volume.rampTo(db, 1.2); } catch (_) { /* ignore */ }
  }
}

function ensureNoise() {
  if (_noise) return;
  const dest = getMelodyBus();
  _noiseFilter = new Tone.Filter({ frequency: 800, type: 'lowpass', rolloff: -24 }).connect(dest);
  _noiseGain = new Tone.Gain(Math.pow(10, -30 / 20)).connect(_noiseFilter);
  _noise = new Tone.Noise('pink').connect(_noiseGain);
  _noise.start();
}

function pickNextChord(mood) {
  const pool = chordsFor(mood);
  // Avoid repeating the same chord twice in a row.
  let next = pool[Math.floor(Math.random() * pool.length)];
  if (_currentChord && next.root === _currentChord.root && pool.length > 1) {
    next = pool[(pool.indexOf(next) + 1) % pool.length];
  }
  _currentChord = next;
  return next;
}

function emitPadChord(mood) {
  ensurePadSynth();
  const ch = _currentChord || pickNextChord(mood);
  const triad = triadFor(ch.type);
  const base = mood.tonic + ch.root;
  const voices = [base, base + triad[1], base + triad[2], base + 12];
  // Release previous chord voices a touch before the new attack to avoid stack-up.
  try { _padSynth.releaseAll(Tone.now() + 0.05); } catch (_) { /* ignore */ }
  const when = Tone.now() + 0.1;
  for (const p of voices) {
    try { _padSynth.triggerAttack(midiToFreq(p), when, 0.5); } catch (_) { /* ignore */ }
  }
}

function scheduleChordDrift(mood) {
  if (!_running) return;
  const [lo, hi] = mood.chordChangeMs || [22000, 38000];
  const nextMs = lo + Math.random() * (hi - lo);
  _chordTimer = setTimeout(() => {
    const m = getCurrentMood();
    pickNextChord(m);
    emitPadChord(m);
    scheduleChordDrift(m);
  }, nextMs);
}

// Phrase templates as pentatonic-scale offsets. 0 = tonic. Each shape is a small lyrical
// figure: ascent, descent, arch, return-to-tonic, sigh, call-and-answer. Longer phrases
// (5-7 notes) read as melodies, not chimes. Repeats of the same scale degree create
// suspensions and a vocal feel.
const PHRASES = [
  [0, 2, 4, 2, 0],
  [4, 3, 2, 0],
  [0, 2, 4, 3, 2, 0],
  [4, 2, 4, 2, 0],
  [2, 4, 3, 2, 0, 2],
  [0, 4, 2, 4, 0],
  [4, 2, 3, 4, 2, 0],
  [3, 4, 2, 0, 2, 0],
  [0, 2, 0, 4, 2, 0],
  [4, 3, 2, 4, 2, 0, 2],
  [2, 4, 2, 0, 4, 2, 0],
  [0, 4, 3, 2, 0, 2, 4],
];

// Small timing perturbation so phrases don't feel metronomic. Keeps ambient, not robotic.
function jitter(baseMs, amtMs = 40) {
  return baseMs + (Math.random() - 0.5) * amtMs * 2;
}

// Per-voice phrase tempo ranges. Bowed and reeded instruments want longer note spacing
// than plucked ones so the attack envelope has room to speak.
const VOICE_TEMPO = {
  piano:       [320, 580],
  harp:        [300, 540],
  cello:       [700, 1200],
  guitarNylon: [450, 780],
  harmonium:   [900, 1500],
};

// Per-voice octave offsets relative to mood tonic. Keeps each instrument in its best range.
const VOICE_OCTAVE = {
  piano:       12,
  harp:        12,
  cello:       0,
  guitarNylon: 0,
  harmonium:   0,
};

function playPhrase(m) {
  const voiceKey = m.phraseVoice || 'harp';
  const pent = pentFor(m);
  const chord = _currentChord || { root: 0, type: m.scale === 'minor' ? 'min' : 'maj' };
  const tmpl = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const baseOctave = VOICE_OCTAVE[voiceKey] ?? 12;
  const octaveJump = Math.random() < 0.15 ? 12 : 0;
  const [tLo, tHi] = VOICE_TEMPO[voiceKey] || [320, 580];
  const stepMs = tLo + Math.random() * (tHi - tLo);
  const holdSec = (stepMs / 1000) * 2.6 + 1.4;
  const n = tmpl.length;
  for (let i = 0; i < n; i++) {
    const idx = Math.max(0, Math.min(pent.length - 1, tmpl[i]));
    const pitch = m.tonic + chord.root + pent[idx] + baseOctave + octaveJump;
    const arch = Math.sin((i / Math.max(1, n - 1)) * Math.PI);
    const vel = 0.28 + arch * 0.32;
    const when = jitter(i * stepMs, 30);
    setTimeout(() => {
      if (!_running) return;
      triggerVoice(voiceKey, pitch, Math.max(0.15, Math.min(0.75, vel)), holdSec);
    }, Math.max(0, when));
  }
  // 30 percent chance of a soft answering note an octave up after the phrase ends, gives
  // a call-and-response shape that reads as more lyrical.
  if (Math.random() < 0.3) {
    const lastIdx = tmpl[n - 1];
    const answerPitch = m.tonic + chord.root + pent[lastIdx] + baseOctave + 12;
    const answerWhen = n * stepMs + 350;
    setTimeout(() => {
      if (!_running) return;
      triggerVoice(voiceKey, answerPitch, 0.18, holdSec * 0.7);
    }, answerWhen);
  }
}

function playShimmer(m) {
  const key = m.shimmerVoice;
  if (!key) return;
  const pent = pentFor(m);
  const root = (_currentChord && _currentChord.root) || 0;
  const n = pent[Math.floor(Math.random() * pent.length)];
  const pitch = m.tonic + root + n + 36;
  triggerVoice(key, pitch, 0.18, 4.5);
}

// Re-trigger the low drone voice (contrabass / cello / harmonium). Each strike is held
// long enough to overlap the next one so the drone sounds continuous, not pulsed.
function scheduleDrone(m) {
  if (!_running) return;
  const key = m.droneVoice;
  if (!key) { _lastDroneVoice = null; return; }
  const chord = _currentChord || { root: 0, type: m.scale === 'minor' ? 'min' : 'maj' };
  const root = m.tonic + chord.root;
  triggerVoice(key, root - 12, 0.18, 14.0);
  if (Math.random() < 0.4) {
    setTimeout(() => { if (_running) triggerVoice(key, root - 5, 0.13, 12.0); }, 1600);
  }
  _lastDroneVoice = key;
  const nextMs = 9000 + Math.random() * 4000;
  _droneTimer = setTimeout(() => scheduleDrone(getCurrentMood()), nextMs);
}

// Schedule the next chime. Music plays continuously: every slot fires a phrase.
function scheduleChime() {
  if (!_running) return;
  const mood = getCurrentMood();
  const [lo, hi] = mood.chimeMs || [9000, 16000];
  const nextMs = lo + Math.random() * (hi - lo);
  _chimeTimer = setTimeout(() => {
    if (!_running) return;
    const m = getCurrentMood();
    playPhrase(m);
    if (Math.random() < 0.1) {
      setTimeout(() => { if (_running) playShimmer(getCurrentMood()); }, 2200 + Math.random() * 1500);
    }
    scheduleChime();
  }, nextMs);
}

export function startAmbient() {
  if (_running) return;
  _running = true;
  const mood = getCurrentMood();
  ensureNoise();
  pickNextChord(mood);
  emitPadChord(mood);
  setTimeout(() => { if (_running) playPhrase(getCurrentMood()); }, 2000);
  scheduleChordDrift(mood);
  scheduleChime();
  if (mood.droneVoice) scheduleDrone(mood);
}

export function stopAmbient() {
  _running = false;
  if (_chordTimer) { clearTimeout(_chordTimer); _chordTimer = null; }
  if (_chimeTimer) { clearTimeout(_chimeTimer); _chimeTimer = null; }
  if (_droneTimer) { clearTimeout(_droneTimer); _droneTimer = null; }
  if (_padSynth) { try { _padSynth.releaseAll(); } catch (_) { /* ignore */ } }
}

export function onMoodChange() {
  if (!_running) return;
  const mood = getCurrentMood();
  pickNextChord(mood);
  emitPadChord(mood);
  setTimeout(() => { if (_running) playPhrase(getCurrentMood()); }, 1200);
  if (_droneTimer) { clearTimeout(_droneTimer); _droneTimer = null; }
  if (mood.droneVoice) scheduleDrone(mood);
}
