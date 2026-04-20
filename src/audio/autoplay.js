// Transport-driven autoplay. Each tick generates a fresh improvised phrase.
// One Tone.Loop for the main; modifiers never play on their own.

import * as Tone from 'tone';
import { playNoteSequence } from './player.js';
import { generatePhrase } from './improvise.js';
import { getLiveMelody, liveMelodyVersion } from './composer.js';
import { infusion } from './infusion.js';
import { getCurrentMood } from './moods.js';
import { gardenState } from '../state/store.svelte.js';

const DEBUG = false;
const MIN_ENERGY_TO_PLAY = 0;

const DEFAULT_INTERVAL = '10s';

function moodInterval() {
  const m = getCurrentMood();
  return (m && m.interval) || DEFAULT_INTERVAL;
}

const _loops = new Map();
let _getSeeds = null;
let _markPlaying = null;
let _markStopped = null;
let _running = false;

function debugEnabled() {
  if (DEBUG) return true;
  return typeof window !== 'undefined' && window.__SONO_DEBUG__ === true;
}

function debug(...args) {
  if (debugEnabled()) {
    // eslint-disable-next-line no-console
    console.log('[sonogarden.autoplay]', ...args);
  }
}

function currentSeeds() {
  if (typeof _getSeeds !== 'function') return [];
  try {
    const s = _getSeeds();
    return Array.isArray(s) ? s : [];
  } catch (_) {
    return [];
  }
}

function currentSeedById(id) {
  return currentSeeds().find((s) => s.id === id) || null;
}

function triggerSeed(seedId) {
  const seed = currentSeedById(seedId);
  if (!seed) return;
  const energy = typeof seed.energy === 'number' ? seed.energy : 1;
  if (energy < MIN_ENERGY_TO_PLAY) return;

  if (typeof _markPlaying === 'function') {
    try { _markPlaying(seedId); } catch (_) { /* ignore */ }
  }

  // Generate a fresh non-repeating phrase every tick.
  const absorbed = infusion && infusion.absorbedIds ? infusion.absorbedIds.size : 0;
  const midi = generatePhrase({ scale: seed.scale || 'dorian', absorbed });

  // Publish the composer's live RH melody so the Tend DNA card can read it.
  if (seed.role === 'main') {
    gardenState.liveMelody = getLiveMelody();
    gardenState.liveMelodyTick = liveMelodyVersion();
  }

  debug('triggerSeed fire', {
    seedId: seed.id,
    scale: seed.scale,
    absorbed,
    notes: midi.notes.length,
    totalTime: midi.totalTime,
  });

  playNoteSequence(midi, {
    seedId: seed.id,
    scale: seed.scale,
    form: seed.form,
    energy,
    onEnd: () => {
      if (typeof _markStopped === 'function') {
        try { _markStopped(seedId); } catch (_) { /* ignore */ }
      }
    },
  });
}

function registerSeed(seed) {
  if (!seed || !seed.id) return;
  // Only the main seed loops; modifiers sit silent until absorbed.
  if (seed.role !== 'main') return;
  if (_loops.has(seed.id)) return;

  const loop = new Tone.Loop(() => {
    triggerSeed(seed.id);
  }, moodInterval());

  try {
    loop.start('+0m');
  } catch (err) {
    debug('loop.start failed', err);
  }

  _loops.set(seed.id, { loop });
}

function unregisterSeed(seedId) {
  const entry = _loops.get(seedId);
  if (!entry) return;
  try { entry.loop.stop(); } catch (_) { /* ignore */ }
  try { entry.loop.dispose(); } catch (_) { /* ignore */ }
  _loops.delete(seedId);
}

/**
 * Kick off Transport-driven autoplay. Must be called AFTER initAudio resolves.
 * @param {object} _unusedGardenRef reserved
 * @param {object} hooks
 */
export function startAutoplay(_unusedGardenRef, hooks = {}) {
  _getSeeds = typeof hooks.getSeeds === 'function' ? hooks.getSeeds : _getSeeds;
  _markPlaying = typeof hooks.markPlaying === 'function' ? hooks.markPlaying : _markPlaying;
  _markStopped = typeof hooks.markStopped === 'function' ? hooks.markStopped : _markStopped;

  _running = true;
  refreshAutoplay();

  // Kick the main immediately so the user hears sound on the first bar.
  const seeds = currentSeeds();
  const main = seeds.find((s) => s && s.role === 'main');
  if (main) {
    setTimeout(() => triggerSeed(main.id), 120);
  }
}

/** Cancel all loops. Does not touch Tone.Transport or Destination.mute. */
export function stopAutoplay() {
  _running = false;
  const ids = Array.from(_loops.keys());
  for (const id of ids) unregisterSeed(id);
}

/**
 * Rebuild loops to match the current seed set. Call after plant/prune/breed.
 */
export function refreshAutoplay() {
  if (!_running) return;
  const seeds = currentSeeds();
  const currentIds = new Set(seeds.map((s) => s.id));

  for (const id of Array.from(_loops.keys())) {
    if (!currentIds.has(id)) unregisterSeed(id);
  }

  seeds.forEach((seed) => {
    if (!_loops.has(seed.id)) registerSeed(seed);
  });
}

/** Rebuild the main loop so the new mood interval takes effect immediately. */
export function onMoodChange() {
  if (!_running) return;
  const seeds = currentSeeds();
  const main = seeds.find((s) => s && s.role === 'main');
  if (!main) return;
  unregisterSeed(main.id);
  registerSeed(main);
  setTimeout(() => triggerSeed(main.id), 80);
}

/** For tests / diagnostics. */
export function __getLoopCount() {
  return _loops.size;
}

export const __constants = Object.freeze({
  DEFAULT_INTERVAL,
  MIN_ENERGY_TO_PLAY,
});
