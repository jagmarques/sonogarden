// Thin facade over the ambient engine. Kept as autoplay.js so App.svelte's imports don't break.

import { playNoteSequence } from './player.js';
import { startAmbient, stopAmbient, onMoodChange as ambientMoodChange } from './ambient.js';

let _running = false;
let _onMelody = null;

export async function startAutoplay({ onMelody } = {}) {
  if (_running) return;
  _running = true;
  _onMelody = typeof onMelody === 'function' ? onMelody : null;
  startAmbient();
}

export function stopAutoplay() {
  _running = false;
  stopAmbient();
}

export async function onMoodChange() {
  if (!_running) return;
  ambientMoodChange();
}

// Replay a stored NoteSequence (saved moment or shared melody) via the existing player.
export function playStoredMelody(ns) {
  if (!ns || !Array.isArray(ns.notes) || ns.notes.length === 0) return;
  playNoteSequence(ns);
  if (typeof _onMelody === 'function') {
    try { _onMelody(ns); } catch (_) { /* ignore */ }
  }
}
