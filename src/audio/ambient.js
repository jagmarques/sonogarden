// Endel-style texture engine: continuous pink-noise bed, slow FM sine pads, rare harp chimes.
// SOURCE Endel mode descriptions: https://endel.io (verified 2026-04-21).
// SOURCE Sleep profile: Endel homepage quote "starts with a gentle tune ... then proceeds to a
//   very soft white noise, loud enough to break the silence but quiet enough that you don't notice it".
// No beat grid. No metered progression. Everything on independent slow timers.

import * as Tone from 'tone';
import { triggerHarp, getMelodyBus, getPadBus } from './player.js';
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
let _padTimer = null;
let _chordTimer = null;
let _chimeTimer = null;

function triadFor(type) {
  return type === 'min' ? MINOR_TRIAD : MAJOR_TRIAD;
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
    envelope: { attack: 6, decay: 0, sustain: 1, release: 10 },
  }).connect(dest);
  _padSynth.volume.value = -12;
  return _padSynth;
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

function schedulePadRefresh(mood) {
  if (!_running) return;
  emitPadChord(mood);
  const nextMs = 9000 + Math.random() * 5000;
  _padTimer = setTimeout(() => {
    const m = getCurrentMood();
    schedulePadRefresh(m);
  }, nextMs);
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

function scheduleChime() {
  if (!_running) return;
  const mood = getCurrentMood();
  const [lo, hi] = mood.chimeMs || [9000, 16000];
  const nextMs = lo + Math.random() * (hi - lo);
  _chimeTimer = setTimeout(() => {
    const m = getCurrentMood();
    const pent = pentFor(m);
    const n = pent[Math.floor(Math.random() * pent.length)];
    const octave = 12 + (Math.random() < 0.4 ? 12 : 0);
    const root = (_currentChord && _currentChord.root) || 0;
    const pitch = m.tonic + root + n + octave;
    triggerHarp(pitch, 0.45, 3.2);
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
  schedulePadRefresh(mood);
  scheduleChordDrift(mood);
  scheduleChime();
}

export function stopAmbient() {
  _running = false;
  if (_padTimer) { clearTimeout(_padTimer); _padTimer = null; }
  if (_chordTimer) { clearTimeout(_chordTimer); _chordTimer = null; }
  if (_chimeTimer) { clearTimeout(_chimeTimer); _chimeTimer = null; }
  if (_padSynth) { try { _padSynth.releaseAll(); } catch (_) { /* ignore */ } }
}

export function onMoodChange() {
  if (!_running) return;
  const mood = getCurrentMood();
  pickNextChord(mood);
  emitPadChord(mood);
}
