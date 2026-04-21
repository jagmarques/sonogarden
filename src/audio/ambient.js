// Continuous layered ambient engine. Three independent loops, all constrained to the mood's
// tonic triad and pentatonic scale so nothing clashes.
//
// SOURCE (Pärt tintinnabuli): https://en.wikipedia.org/wiki/Tintinnabuli
//   T-voice arpeggiates the tonic triad. M-voice moves diatonically in mostly stepwise motion.
// SOURCE (Eno tape-loops): https://en.wikipedia.org/wiki/Music_for_Airports
//   Tape loops of differing lengths drift out of phase, creating perpetual variation.
// SOURCE (pentatonic consonance): https://en.wikipedia.org/wiki/Pentatonic_scale
//   Omitting the 4th and 7th (major) avoids the semitone-above-tonic and tritone, so any
//   combination of pentatonic notes is harmonically safe.

import { triggerHarp } from './player.js';
import { getCurrentMood } from './moods.js';

const MAJOR_TRIAD = [0, 4, 7];
const MINOR_TRIAD = [0, 3, 7];
const MAJOR_PENT = [0, 2, 4, 7, 9];
const MINOR_PENT = [0, 3, 5, 7, 10];

let _running = false;
let _padTimer = null;
let _arpTimer = null;
let _gestureTimer = null;
let _padStep = 0;
let _arpStep = 0;

function triadFor(mood) {
  return mood.scale === 'minor' ? MINOR_TRIAD : MAJOR_TRIAD;
}
function pentFor(mood) {
  return mood.scale === 'minor' ? MINOR_PENT : MAJOR_PENT;
}

// Pad: staggered triad voices, one new note every PAD_SEC seconds, each rings PAD_RELEASE
// seconds. Voices overlap heavily so there is always a sustained chord bed.
function schedulePad() {
  if (!_running) return;
  const mood = getCurrentMood();
  const triad = triadFor(mood);
  const tonic = mood.tonic;
  const note = triad[_padStep % triad.length] + tonic + 12;
  _padStep += 1;
  triggerHarp(note, 0.22, 5.5);
  // Every third pad note, also play the root octave below for foundation.
  if (_padStep % 3 === 0) triggerHarp(tonic, 0.18, 6.0);
  const nextMs = 2400 + Math.random() * 900;
  _padTimer = setTimeout(schedulePad, nextMs);
}

// Arpeggio / T-voice: gentle triad notes one at a time, higher register.
function scheduleArp() {
  if (!_running) return;
  const mood = getCurrentMood();
  const triad = triadFor(mood);
  const tonic = mood.tonic;
  const offset = triad[_arpStep % triad.length];
  const octave = 12 * (1 + (_arpStep % 2));
  _arpStep += 1;
  triggerHarp(tonic + offset + octave, 0.32, 3.2);
  const nextMs = 1600 + Math.random() * 800;
  _arpTimer = setTimeout(scheduleArp, nextMs);
}

// Melodic gesture / M-voice: 3-6 stepwise pentatonic notes forming a short phrase, rare.
function scheduleGesture() {
  if (!_running) return;
  const mood = getCurrentMood();
  const pent = pentFor(mood);
  const tonic = mood.tonic + 12;
  const len = 3 + Math.floor(Math.random() * 4);
  let idx = Math.floor(Math.random() * pent.length);
  const dir = Math.random() < 0.5 ? -1 : 1;
  const startDelay = 0.05;
  for (let i = 0; i < len; i++) {
    idx = Math.max(0, Math.min(pent.length - 1, idx + (i === 0 ? 0 : dir)));
    const pitch = tonic + pent[idx];
    const t = startDelay + i * (0.45 + Math.random() * 0.15);
    setTimeout(() => {
      if (!_running) return;
      triggerHarp(pitch, 0.55, 2.4);
    }, t * 1000);
  }
  const nextMs = (20 + Math.random() * 20) * 1000;
  _gestureTimer = setTimeout(scheduleGesture, nextMs);
}

export function startAmbient() {
  if (_running) return;
  _running = true;
  _padStep = 0;
  _arpStep = 0;
  schedulePad();
  setTimeout(scheduleArp, 800);
  setTimeout(scheduleGesture, 4000);
}

export function stopAmbient() {
  _running = false;
  if (_padTimer) { clearTimeout(_padTimer); _padTimer = null; }
  if (_arpTimer) { clearTimeout(_arpTimer); _arpTimer = null; }
  if (_gestureTimer) { clearTimeout(_gestureTimer); _gestureTimer = null; }
}

export function onMoodChange() {
  if (!_running) return;
  _padStep = 0;
  _arpStep = 0;
}
