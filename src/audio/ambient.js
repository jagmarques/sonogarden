// Chord-progression driven ambient engine. Beat-synced, harmonically planned, never random.
//
// SOURCE (tintinnabuli): https://en.wikipedia.org/wiki/Tintinnabuli (T-voice arpeggiates triad).
// SOURCE (tape-loops): https://en.wikipedia.org/wiki/Music_for_Airports (staggered entries).
// SOURCE (pentatonic): https://en.wikipedia.org/wiki/Pentatonic_scale (no dissonant combinations).
//
// Major progression I-V-vi-IV (semitone offsets from tonic: 0, 7, 9, 5) is the most common in
// pop (Wikipedia "I-V-vi-IV progression"). Minor equivalent: i-VII-VI-VII (0, -2, -4, -2) or
// i-VI-III-VII (0, -4, -5, -2). One chord per 8-beat bar; 4 bars per cycle = 32-beat cycle.
// Everything is scheduled against a single beat timer so no timer drifts out of sync.

import { triggerHarp } from './player.js';
import { getCurrentMood } from './moods.js';

const BEAT_MS = 1500;

const PROG_MAJOR = [
  { root: 0,  type: 'maj' },
  { root: 7,  type: 'maj' },
  { root: 9,  type: 'min' },
  { root: 5,  type: 'maj' },
];
const PROG_MINOR = [
  { root: 0,  type: 'min' },
  { root: -4, type: 'maj' },
  { root: -5, type: 'maj' },
  { root: -2, type: 'maj' },
];

function triadIntervals(type) {
  return type === 'min' ? [0, 3, 7] : [0, 4, 7];
}

const MAJOR_PENT = [0, 2, 4, 7, 9];
const MINOR_PENT = [0, 3, 5, 7, 10];

let _running = false;
let _beat = 0;
let _timer = null;

function progFor(mood) {
  return mood.scale === 'minor' ? PROG_MINOR : PROG_MAJOR;
}
function pentFor(mood) {
  return mood.scale === 'minor' ? MINOR_PENT : MAJOR_PENT;
}

function currentChord(mood) {
  const prog = progFor(mood);
  const bar = Math.floor(_beat / 8) % prog.length;
  return prog[bar];
}

// Pad: sustain one chord tone per bar on the downbeat, ringing 9 seconds so it overlaps the
// next bar by ~30%. Rotates through triad inversions across the 4-bar cycle.
function emitPad(mood) {
  const ch = currentChord(mood);
  const triad = triadIntervals(ch.type);
  const voicing = [0, 12, 7]; // root, octave-up root, fifth
  const v = voicing[Math.floor(_beat / 8) % voicing.length];
  const pitch = mood.tonic + ch.root + triad[0] + v;
  triggerHarp(pitch, 0.22, 9.0);
  triggerHarp(mood.tonic + ch.root + triad[2] + 12, 0.16, 8.0);
}

// Arpeggio: one triad tone per beat (1.5s). Sequence goes root-third-fifth-octave up and back.
function emitArp(mood) {
  const ch = currentChord(mood);
  const triad = triadIntervals(ch.type);
  const pattern = [triad[0], triad[1], triad[2], triad[0] + 12, triad[2], triad[1]];
  const n = pattern[_beat % pattern.length];
  const pitch = mood.tonic + ch.root + n + 12;
  triggerHarp(pitch, 0.3, 2.2);
}

// Gesture: every 16 beats a short pentatonic phrase rooted on the current chord.
function emitGesture(mood) {
  const ch = currentChord(mood);
  const pent = pentFor(mood);
  const baseOctave = 24;
  const triadRoot = mood.tonic + ch.root;
  const start = Math.floor(Math.random() * pent.length);
  const dir = Math.random() < 0.5 ? -1 : 1;
  const len = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < len; i++) {
    const idx = Math.max(0, Math.min(pent.length - 1, start + i * dir));
    const pitch = triadRoot + pent[idx] + baseOctave;
    const delayMs = i * 420;
    setTimeout(() => {
      if (!_running) return;
      triggerHarp(pitch, 0.5, 2.4);
    }, delayMs);
  }
}

function tick() {
  if (!_running) return;
  const mood = getCurrentMood();
  // Downbeat of each bar -> pad change.
  if (_beat % 8 === 0) emitPad(mood);
  // Every beat -> arp step.
  emitArp(mood);
  // Every 16 beats, 30% chance -> melodic gesture.
  if (_beat % 16 === 0 && Math.random() < 0.55) emitGesture(mood);
  _beat += 1;
  _timer = setTimeout(tick, BEAT_MS);
}

export function startAmbient() {
  if (_running) return;
  _running = true;
  _beat = 0;
  tick();
}

export function stopAmbient() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

export function onMoodChange() {
  _beat = 0;
}
