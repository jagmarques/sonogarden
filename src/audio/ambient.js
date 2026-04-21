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
let _chordTimer = null;
let _chimeTimer = null;

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

// Phrase templates expressed as offsets into the pentatonic scale. 0 = tonic. Each template
// is a small, musical shape with a clear contour (arch, descent, call-and-answer, etc).
// These sound intentional, unlike random pentatonic walks.
const PHRASES = [
  [4, 2, 0],
  [0, 2, 4, 2],
  [4, 3, 2, 0],
  [0, 2, 4, 3, 2],
  [2, 4, 2, 0],
  [0, 2, 4],
  [4, 2, 3, 0],
  [3, 2, 4, 2, 0],
];

// Small timing perturbation so phrases don't feel metronomic. Keeps ambient, not robotic.
function jitter(baseMs, amtMs = 40) {
  return baseMs + (Math.random() - 0.5) * amtMs * 2;
}

// Play a musical phrase: pick a template, choose a tempo for this phrase, play with an
// arch dynamic shape (soft-louder-soft). Silence between notes within the phrase is
// deliberate and uniform, not random.
function playPhrase(m) {
  const pent = pentFor(m);
  const chord = _currentChord || { root: 0, type: m.scale === 'minor' ? 'min' : 'maj' };
  const tmpl = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const baseOctave = 12 + (Math.random() < 0.18 ? 12 : 0);
  const stepMs = 320 + Math.random() * 260;
  const n = tmpl.length;
  for (let i = 0; i < n; i++) {
    const idx = Math.max(0, Math.min(pent.length - 1, tmpl[i]));
    const pitch = m.tonic + chord.root + pent[idx] + baseOctave;
    const arch = Math.sin((i / Math.max(1, n - 1)) * Math.PI);
    const vel = 0.16 + arch * 0.22;
    const when = jitter(i * stepMs, 30);
    setTimeout(() => {
      if (!_running) return;
      triggerHarp(pitch, Math.max(0.08, Math.min(0.5, vel)), 3.2);
    }, Math.max(0, when));
  }
}

// Very rare high single-note shimmer. Adds sparkle without clutter.
function playShimmer(m) {
  const pent = pentFor(m);
  const root = (_currentChord && _currentChord.root) || 0;
  const n = pent[Math.floor(Math.random() * pent.length)];
  const pitch = m.tonic + root + n + 36;
  triggerHarp(pitch, 0.22, 5.0);
}

// Schedule the next chime with a much longer base gap and a real "silent rest" probability.
// Ambient music breathes: sometimes no phrase fires at all and the pad carries the minute.
function scheduleChime() {
  if (!_running) return;
  const mood = getCurrentMood();
  const [lo, hi] = mood.chimeMs || [12000, 22000];
  const gap = lo + Math.random() * (hi - lo);
  const nextMs = gap + (Math.random() < 0.28 ? gap * (0.8 + Math.random()) : 0);
  _chimeTimer = setTimeout(() => {
    if (!_running) return;
    const m = getCurrentMood();
    if (Math.random() < 0.75) {
      playPhrase(m);
      if (Math.random() < 0.08) {
        setTimeout(() => { if (_running) playShimmer(getCurrentMood()); }, 2200 + Math.random() * 1500);
      }
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
  // Gentle opening phrase after ~2s so the instrument announces itself once, then breathes.
  setTimeout(() => { if (_running) playPhrase(getCurrentMood()); }, 2000);
  scheduleChordDrift(mood);
  scheduleChime();
}

export function stopAmbient() {
  _running = false;
  if (_chordTimer) { clearTimeout(_chordTimer); _chordTimer = null; }
  if (_chimeTimer) { clearTimeout(_chimeTimer); _chimeTimer = null; }
  if (_padSynth) { try { _padSynth.releaseAll(); } catch (_) { /* ignore */ } }
}

export function onMoodChange() {
  if (!_running) return;
  const mood = getCurrentMood();
  pickNextChord(mood);
  emitPadChord(mood);
  // Short pause then a phrase, so the mood change is audible without feeling jumpy.
  setTimeout(() => { if (_running) playPhrase(getCurrentMood()); }, 1200);
}
