// Texture engine: pink-noise bed + sine pad + per-mood phrase scheduler. No beat grid.

import * as Tone from 'tone';
import { triggerVoice, getMelodyBus, getPadBus, getVoice } from './player.js';
import { getCurrentMood } from './moods.js';

const MAJOR_TRIAD = [0, 4, 7];
const MINOR_TRIAD = [0, 3, 7];
// Full diatonic scales for richer melodic material than pentatonic.
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
// Chord-tone indices into the diatonic scale (1-3-5-7).
const CHORD_TONES_MAJ = [0, 2, 4, 6];
const CHORD_TONES_MIN = [0, 2, 4, 6];

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
// Bumped on every mood change. Every scheduled note captures the current gen at
// schedule time and bails if gen has advanced. Kills tails from the previous mood.
let _gen = 0;

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
function scaleFor(mood) {
  return mood.scale === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
}
function chordTonesFor(mood) {
  return mood.scale === 'minor' ? CHORD_TONES_MIN : CHORD_TONES_MAJ;
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

// Pink noise -30 dB low-passed 800 Hz. Strongest tone evidence per scientific-tones.md.
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

// Plays a real chord on the mood's phrase voice: root + 3rd + 5th + 7th, soft, slightly
// staggered so each note has its own attack. This is the harmonic anchor on chord changes.
function playPhraseChord(m, voicing = 'rich') {
  const voiceKey = m.phraseVoice || 'harp';
  const chord = _currentChord || { root: 0, type: m.scale === 'minor' ? 'min' : 'maj' };
  const triad = chord.type === 'min' ? [0, 3, 7] : [0, 4, 7];
  const intervals = voicing === 'rich' ? [...triad, 11] : triad;
  const baseOctave = (VOICE_OCTAVE[voiceKey] ?? 12);
  const root = m.tonic + chord.root + baseOctave;
  const myGen = _gen;
  for (let i = 0; i < intervals.length; i++) {
    const pitch = root + intervals[i];
    const stagger = i * 35;
    const vel = 0.22 - i * 0.02;
    setTimeout(() => {
      if (!_running || _gen !== myGen) return;
      triggerVoice(voiceKey, pitch, Math.max(0.1, vel), 4.5);
    }, stagger);
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
    playPhraseChord(m);
    scheduleChordDrift(m);
  }, nextMs);
}

// Diatonic-scale phrase templates. {n, d}: n is scale degree (0-6), d is duration in beats.
// Mix of ascents, descents, arches, returns, sighs, leaps, neighbour figures, and phrases
// that rest on chord tones (3, 5) instead of always landing on the tonic.
const PHRASES = [
  [{n:0,d:1},{n:2,d:1},{n:4,d:2},{n:2,d:1.5}],
  [{n:4,d:1},{n:3,d:0.5},{n:2,d:1},{n:0,d:2}],
  [{n:4,d:0.5},{n:5,d:0.5},{n:4,d:1},{n:2,d:1},{n:0,d:2}],
  [{n:0,d:0.75},{n:2,d:0.75},{n:4,d:1.5},{n:2,d:0.5},{n:0,d:1.5}],
  [{n:2,d:1},{n:4,d:1.5},{n:6,d:1},{n:4,d:1.5}],
  [{n:0,d:2},{n:4,d:1},{n:2,d:1.5}],
  [{n:6,d:0.5},{n:4,d:0.5},{n:2,d:1},{n:0,d:2}],
  [{n:0,d:1},{n:4,d:1.5},{n:2,d:0.5},{n:5,d:1.5}],
  [{n:5,d:0.75},{n:4,d:0.75},{n:2,d:1},{n:0,d:1},{n:2,d:2}],
  [{n:2,d:0.5},{n:4,d:0.5},{n:2,d:1},{n:0,d:0.5},{n:2,d:0.5},{n:4,d:2}],
  [{n:0,d:1.5},{n:2,d:0.5},{n:4,d:1},{n:6,d:2}],
  [{n:4,d:1},{n:2,d:0.5},{n:4,d:0.5},{n:5,d:1},{n:4,d:2}],
  [{n:0,d:1},{n:2,d:1},{n:4,d:1},{n:5,d:1},{n:4,d:2}],
  [{n:6,d:1},{n:5,d:1},{n:4,d:1},{n:2,d:1.5},{n:0,d:1.5}],
  [{n:0,d:0.5},{n:4,d:1.5},{n:2,d:0.5},{n:0,d:2}],
  [{n:2,d:1},{n:0,d:2},{n:4,d:1.5}],
];

// Small timing perturbation so phrases don't feel metronomic. Keeps ambient, not robotic.
function jitter(baseMs, amtMs = 40) {
  return baseMs + (Math.random() - 0.5) * amtMs * 2;
}

// Per-voice ms-per-note ranges; bowed/reeded instruments need wider spacing.
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

function pickOctaveOffset() {
  const r = Math.random();
  if (r < 0.06) return -12;
  if (r < 0.78) return 0;
  if (r < 0.94) return 12;
  return -12 + (Math.random() < 0.5 ? 0 : 24);
}

function playPhrase(m) {
  const voiceKey = m.phraseVoice || 'harp';
  const scale = scaleFor(m);
  const tones = chordTonesFor(m);
  const chord = _currentChord || { root: 0, type: m.scale === 'minor' ? 'min' : 'maj' };
  const tmpl = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const baseOctave = VOICE_OCTAVE[voiceKey] ?? 12;
  const octJump = pickOctaveOffset();
  const [tLo, tHi] = VOICE_TEMPO[voiceKey] || [320, 580];
  const beatMs = tLo + Math.random() * (tHi - tLo);
  const myGen = _gen;
  let cursor = 0;
  const n = tmpl.length;
  for (let i = 0; i < n; i++) {
    const step = tmpl[i];
    let degree = step.n;
    // 18 percent chance to lift this note up an octave within the phrase for a leap colour.
    let extraOct = (Math.random() < 0.18 && i > 0) ? 7 : 0;
    // On the first or last note, snap to a chord tone 60 percent of the time so phrases
    // start and resolve on stable colours instead of always on the scale degree.
    if ((i === 0 || i === n - 1) && Math.random() < 0.6) {
      degree = tones[Math.floor(Math.random() * tones.length)];
    }
    const idx = Math.max(0, Math.min(scale.length - 1, degree));
    const scaleSemis = scale[idx] + (extraOct ? 12 : 0);
    const pitch = m.tonic + chord.root + scaleSemis + baseOctave + octJump;
    const arch = Math.sin((i / Math.max(1, n - 1)) * Math.PI);
    const vel = 0.28 + arch * 0.32;
    const noteMs = beatMs * step.d;
    const holdSec = (noteMs / 1000) * 2.4 + 1.0;
    const when = jitter(cursor, 35);
    setTimeout(() => {
      if (!_running || _gen !== myGen) return;
      triggerVoice(voiceKey, pitch, Math.max(0.15, Math.min(0.75, vel)), holdSec);
    }, Math.max(0, when));
    cursor += noteMs;
  }
  // 25 percent chance of a soft answering note in the OPPOSITE octave for call-and-response.
  if (Math.random() < 0.25) {
    const tone = tones[Math.floor(Math.random() * tones.length)];
    const answerSemis = scale[tone];
    const answerOct = octJump <= 0 ? 12 : 0;
    const pitch = m.tonic + chord.root + answerSemis + baseOctave + answerOct;
    setTimeout(() => {
      if (!_running || _gen !== myGen) return;
      triggerVoice(voiceKey, pitch, 0.16, beatMs / 1000 * 2.5);
    }, cursor + 280);
  }
}

function playShimmer(m) {
  const key = m.shimmerVoice;
  if (!key) return;
  const tones = chordTonesFor(m);
  const scale = scaleFor(m);
  const root = (_currentChord && _currentChord.root) || 0;
  const t = tones[Math.floor(Math.random() * tones.length)];
  const pitch = m.tonic + root + scale[t] + 36;
  triggerVoice(key, pitch, 0.18, 4.5);
}

// Tanpura-style drone on tonic + fifth. Hold > retrigger so it sounds continuous.
function scheduleDrone(m) {
  if (!_running) return;
  const key = m.droneVoice;
  if (!key) { _lastDroneVoice = null; return; }
  const root = m.tonic;
  triggerVoice(key, root - 12, 0.16, 18.0);
  setTimeout(() => { if (_running) triggerVoice(key, root - 5, 0.11, 16.0); }, 2000);
  _lastDroneVoice = key;
  const nextMs = 7500 + Math.random() * 2500;
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
  playPhraseChord(mood);
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
  _gen += 1;
  if (_chimeTimer) { clearTimeout(_chimeTimer); _chimeTimer = null; }
  if (_droneTimer) { clearTimeout(_droneTimer); _droneTimer = null; }
  const mood = getCurrentMood();
  pickNextChord(mood);
  emitPadChord(mood);
  playPhraseChord(mood);
  const myGen = _gen;
  setTimeout(() => { if (_running && _gen === myGen) playPhrase(getCurrentMood()); }, 1500);
  scheduleChime();
  if (mood.droneVoice) scheduleDrone(mood);
}
