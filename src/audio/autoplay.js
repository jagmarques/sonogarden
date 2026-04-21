// Thin facade over the ambient engine.

import { startAmbient, stopAmbient, onMoodChange as ambientMoodChange } from './ambient.js';

let _running = false;

export async function startAutoplay() {
  if (_running) return;
  _running = true;
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
