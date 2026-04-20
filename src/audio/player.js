// Audio playback layer. Simultaneous bar plays are capped by MAX_SEEDS_PER_BAR.
// Collisions stay silent; the visual burst fires from Garden.svelte.
// Browser-only. Tone.start() requires a user gesture.

import * as Tone from 'tone';
import {
  buildAllVoices,
  resolveInstrumentKeyForSeed,
  scaleTranspose,
  formVelocity,
} from './voices.js';
import { MOODS, setCurrentMood, getCurrentMood } from './moods.js';

const DEBUG = false;

const MASTER_LIMITER_THRESHOLD_DB = -3;
// Never gate playback on energy; keep constant for tests.
const MIN_ENERGY_TO_PLAY = 0;
const DEFAULT_QPM = 120;
// Ambient default. Each bar ~4s; long harp sustains bloom.
const DEFAULT_BPM = 60;
// Cap simultaneous plays so the room never overcrowds.
const MAX_SEEDS_PER_BAR = 4;
// Gentle master softening.
const MASTER_GAIN_DB = -3;

// Master chain nodes (module-level singletons).
// Graph: voiceOuts -> _sourceGain -> _masterGain -> _hpf ->
//        _compressor -> _reverb -> _limiter -> Destination.
let _sourceGain = null;
let _masterGain = null;
let _hpf = null;
let _compressor = null;
let _reverb = null;
let _limiter = null;

// Voice registry, populated after initAudio resolves.
let _voices = null;
let _mainVoiceOverride = 'harp';

export function setMainVoice(name) {
  if (typeof name !== 'string') return;
  _mainVoiceOverride = name;
}
export function getMainVoice() {
  return _mainVoiceOverride;
}

// Live mood swap: updates BPM, reverb, voice. Caller rebuilds the loop.
export function setMood(name) {
  const m = MOODS[name];
  if (!m) return null;
  setCurrentMood(name);
  try {
    transport().bpm.rampTo(m.bpm, 0.5);
  } catch (_) { /* before initAudio */ }
  if (_reverb) {
    try { _reverb.decay = m.reverbDecay; } catch (_) { /* ignore */ }
    try { _reverb.wet.rampTo(m.reverbWet, 0.5); } catch (_) { /* ignore */ }
  }
  _mainVoiceOverride = m.instrument;
  return m;
}

export { getCurrentMood as getMood } from './moods.js';

let _started = false;
let _starting = null;
let _gestureResolvers = [];
let _gestureListenerAttached = false;

// Per-bar scheduling counter: tracks how many plays have been parked on the
// currently-scheduled bar. Reset by a Transport scheduleRepeat on every '1m'.
let _barCounter = 0;
let _barCounterBarTime = 0;
let _barRepeatId = null;

// Registry of active playbacks: handleId -> { seedId, stop }.
const _active = new Map();
let _nextHandleId = 1;

function debug(...args) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[sonogarden.audio]', ...args);
  }
}

// Tone 15.x: Tone.getTransport() returns the global TransportClass instance.
function transport() {
  return Tone.getTransport();
}

function ensureMasterChain() {
  if (_limiter) return _sourceGain;

  _limiter = new Tone.Limiter(MASTER_LIMITER_THRESHOLD_DB);
  // Long reverb tail for chamber bloom.
  _reverb = new Tone.Reverb({ decay: 5.0, preDelay: 0.02 });
  _reverb.wet.value = 0.4;
  _compressor = new Tone.Compressor({
    threshold: -20,
    ratio: 4,
    attack: 0.01,
    release: 0.15,
    knee: 6,
  });
  _hpf = new Tone.Filter({ frequency: 90, type: 'highpass', rolloff: -12 });
  _masterGain = new Tone.Gain(Math.pow(10, MASTER_GAIN_DB / 20));
  _sourceGain = new Tone.Gain(1);

  _sourceGain.connect(_masterGain);
  _masterGain.connect(_hpf);
  _hpf.connect(_compressor);
  _compressor.connect(_reverb);
  _reverb.connect(_limiter);
  _limiter.connect(Tone.getDestination());

  return _sourceGain;
}

function ensureVoices() {
  if (_voices) return _voices;
  const source = ensureMasterChain();
  _voices = buildAllVoices(source);
  return _voices;
}

function ensureBarCounter() {
  if (_barRepeatId !== null) return;
  try {
    _barRepeatId = transport().scheduleRepeat(() => {
      _barCounter = 0;
      _barCounterBarTime = 0;
    }, '1m');
  } catch (_) {
    /* transport not started yet; retried on next play */
  }
}

function attachGestureListener() {
  if (_gestureListenerAttached) return;
  if (typeof window === 'undefined') return;
  _gestureListenerAttached = true;
  const events = ['pointerdown', 'keydown', 'touchstart'];
  const handler = async () => {
    for (const ev of events) {
      window.removeEventListener(ev, handler, true);
    }
    _gestureListenerAttached = false;
    try {
      await realStart();
      const resolvers = _gestureResolvers.slice();
      _gestureResolvers = [];
      for (const r of resolvers) r.resolve();
    } catch (err) {
      const resolvers = _gestureResolvers.slice();
      _gestureResolvers = [];
      for (const r of resolvers) r.reject(err);
    }
  };
  for (const ev of events) {
    window.addEventListener(ev, handler, { capture: true, passive: true });
  }
}

function contextRunning() {
  try {
    return Tone.getContext().state === 'running';
  } catch (_) {
    return false;
  }
}

async function realStart() {
  if (_started && contextRunning()) return;
  await Tone.start();
  ensureMasterChain();
  ensureVoices();
  ensureBarCounter();

  const t = transport();
  const mood = getCurrentMood();
  t.bpm.value = (mood && mood.bpm) || DEFAULT_BPM;
  if (t.state !== 'started') {
    t.start();
  }
  // Apply current mood reverb settings now that the chain exists.
  if (_reverb && mood) {
    try { _reverb.decay = mood.reverbDecay; } catch (_) { /* ignore */ }
    try { _reverb.wet.value = mood.reverbWet; } catch (_) { /* ignore */ }
  }
  if (mood && mood.instrument) _mainVoiceOverride = mood.instrument;

  _started = true;
  debug('audio started, transport running at', t.bpm.value, 'bpm');
}

/**
 * Idempotent. Creates the master chain and voices, starts Tone.Transport.
 * If called before a user gesture, returns a promise that resolves on first gesture.
 */
export function initAudio() {
  if (_started && contextRunning()) return Promise.resolve();
  if (_starting) return _starting;

  _starting = new Promise((resolve, reject) => {
    realStart().then(
      () => resolve(),
      () => {
        _gestureResolvers.push({ resolve, reject });
        attachGestureListener();
      },
    );
  }).finally(() => {
    if (_started && contextRunning()) _starting = null;
  });

  return _starting;
}

/**
 * Resolve once every sampled voice has finished loading its buffer set.
 * Callers should await this before kicking off autoplay so the first bar
 * actually makes sound instead of dropping into silent Sampler lookups.
 * Safe to call before or after initAudio.
 */
export async function waitForVoicesLoaded() {
  await initAudio().catch(() => { /* gesture pending; loaded still awaits below */ });
  // ensureVoices is idempotent; voices begin loading the moment they exist.
  const voices = ensureVoices();
  if (voices && voices.loaded && typeof voices.loaded.then === 'function') {
    await voices.loaded;
  }
}

/**
 * Set the global BPM used by all subsequent plays. No-op until initAudio resolves.
 * @param {number} v BPM in [40, 300].
 */
export function setBpm(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return;
  const clamped = Math.max(40, Math.min(300, v));
  try {
    transport().bpm.value = clamped;
  } catch (_) {
    /* ignore before initAudio */
  }
}

function noteSequenceDuration(ns) {
  if (!ns) return 0;
  if (typeof ns.totalTime === 'number' && ns.totalTime > 0) return ns.totalTime;
  let max = 0;
  if (Array.isArray(ns.notes)) {
    for (const n of ns.notes) {
      if (typeof n.endTime === 'number' && n.endTime > max) max = n.endTime;
    }
  }
  return max;
}

function midiToFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

// Context time of the next bar boundary (Transport subdivision "1m").
// Returns an AudioContext seconds value. Falls back to Tone.now() if Transport
// is not started.
function nextBarContextTime() {
  const t = transport();
  if (t.state !== 'started') return Tone.now();
  const next = t.nextSubdivision('1m');
  const now = Tone.now();
  if (!Number.isFinite(next) || next <= now) return now;
  return next;
}

// Pick the schedule bar-start for a new play. Honors MAX_SEEDS_PER_BAR: once a
// bar is full, extra plays bump to the next bar. Returns a context-time.
function reserveBarSlot() {
  const barStart = nextBarContextTime();
  if (_barCounterBarTime !== barStart) {
    _barCounter = 0;
    _barCounterBarTime = barStart;
  }
  if (_barCounter >= MAX_SEEDS_PER_BAR) {
    let oneBarSec;
    try {
      oneBarSec = Tone.Time('1m').toSeconds();
    } catch (_) {
      oneBarSec = (60 / DEFAULT_BPM) * 4;
    }
    const shifted = barStart + oneBarSec;
    _barCounter = 1;
    _barCounterBarTime = shifted;
    return shifted;
  }
  _barCounter += 1;
  return barStart;
}

// Schedule all notes of a NoteSequence through a resolved voice.
// `transpose` is added to every note's pitch before lookup. Cycle 16 always
// passes 0 but the parameter is retained so the signature stays stable.
function scheduleVoicePlay(ns, voice, form, qpm, baseVelocity, barStart, transpose) {
  const tempoScale = DEFAULT_QPM / qpm;
  const notes = Array.isArray(ns.notes) ? ns.notes : [];
  const total = notes.length;

  for (let i = 0; i < total; i++) {
    const n = notes[i];
    if (typeof n.pitch !== 'number') continue;
    const startSec = (typeof n.startTime === 'number' ? n.startTime : 0) * tempoScale;
    const endSec =
      (typeof n.endTime === 'number' ? n.endTime : (n.startTime || 0) + 0.25) *
      tempoScale;
    const dur = Math.max(0.05, endSec - startSec);
    const velocity = formVelocity(form, i, total, baseVelocity);
    const pitch = n.pitch + transpose;
    try {
      voice.synth.triggerAttackRelease(
        midiToFreq(pitch),
        dur,
        barStart + startSec,
        velocity,
      );
    } catch (err) {
      debug('voice triggerAttackRelease failed', err);
    }
  }

  const totalDur = noteSequenceDuration(ns) * tempoScale;
  return { barStart, totalDur };
}

/**
 * Play a NoteSequence through the sampled instrument that matches its scale.
 * Multiple concurrent calls coexist. Starts are quantized to the next bar
 * boundary of Tone.Transport with a 2-seed-per-bar cap; overflow plays roll
 * to the next bar.
 *
 * @param {object} ns Magenta INoteSequence (POJO form).
 * @param {object} [opts]
 * @param {Function} [opts.onEnd] Called when playback finishes or is stopped.
 * @param {string} [opts.seedId] Optional seed identifier for `stopBySeedId`.
 * @param {string} [opts.scale] Seed scale key; selects instrument. Defaults to 'major'.
 * @param {string} [opts.form] Seed form key; selects velocity curve. Defaults to 'motif'.
 * @param {number} [opts.energy=1] Seed energy [0..1]. Below 0.1 skips playback.
 * @param {number} [opts.qpm] Override tempo; default: ns.tempos[0].qpm or 120.
 * @returns {Promise<{id:number, seedId?:string, stop:Function}|null>}
 */
export async function playNoteSequence(ns, opts = {}) {
  try {
    if (!ns || !Array.isArray(ns.notes) || ns.notes.length === 0) {
      if (typeof opts.onEnd === 'function') opts.onEnd();
      return null;
    }

    const {
      onEnd,
      seedId,
      scale,
      form,
      energy = 1,
      qpm: qpmOpt,
    } = opts;

    if (energy < MIN_ENERGY_TO_PLAY) {
      if (typeof onEnd === 'function') onEnd();
      return null;
    }

    const qpm =
      typeof qpmOpt === 'number' && qpmOpt > 0
        ? qpmOpt
        : (ns.tempos && ns.tempos[0] && ns.tempos[0].qpm) || DEFAULT_QPM;

    await initAudio();
    if (!contextRunning()) {
      debug('audio context not running after initAudio, skipping play');
      if (typeof onEnd === 'function') onEnd();
      return null;
    }

    ensureBarCounter();

    // Re-trigger: cancel prior schedule for the same seed so concurrent bars
    // don't double-stack the same voice.
    if (seedId) {
      stopBySeedId(seedId);
    }

    const voices = ensureVoices();
    // User-selected main voice override wins; fallback to scale route.
    const instrumentKey = _mainVoiceOverride || resolveInstrumentKeyForSeed(scale);
    const voice = voices[instrumentKey] || voices.harp;
    if (!voice) {
      debug('no voice for scale', scale);
      if (typeof onEnd === 'function') onEnd();
      return null;
    }

    const resolvedForm = typeof form === 'string' && form.length > 0 ? form : 'motif';
    // Ambient touch. Velocity capped at ~75/127 (0.59).
    const baseVelocity = Math.min(0.59, 0.38 + 0.2 * Math.max(0, Math.min(1, energy)));
    const transpose = scaleTranspose(scale);

    const handleId = _nextHandleId++;
    const barStart = reserveBarSlot();
    const { totalDur } = scheduleVoicePlay(
      ns,
      voice,
      resolvedForm,
      qpm,
      baseVelocity,
      barStart,
      transpose,
    );

    const delayMs = Math.max(0, (barStart - Tone.now()) * 1000);
    let ended = false;
    const wrappedOnEnd = () => {
      if (typeof onEnd === 'function') {
        try {
          onEnd();
        } catch (err) {
          debug('onEnd threw', err);
        }
      }
    };

    // Settle guard: a little tail past totalDur lets envelope releases decay.
    const endTimer = setTimeout(
      () => {
        if (ended) return;
        ended = true;
        _active.delete(handleId);
        wrappedOnEnd();
      },
      Math.ceil(delayMs + totalDur * 1000) + 700,
    );

    const handle = {
      id: handleId,
      seedId,
      stop: () => {
        if (ended) return;
        ended = true;
        clearTimeout(endTimer);
        _active.delete(handleId);
        wrappedOnEnd();
      },
    };
    _active.set(handleId, handle);
    return handle;
  } catch (err) {
    debug('playNoteSequence failed', err);
    if (typeof opts.onEnd === 'function') {
      try {
        opts.onEnd();
      } catch (_) {
        /* ignore */
      }
    }
    return null;
  }
}

/**
 * Release any held notes across all voices and stop every active playback.
 * Also clears pending Transport events so queued bar-boundary starts do not
 * fire after the user muted/stopped.
 */
export function stopAll() {
  const handles = Array.from(_active.values());
  _active.clear();
  for (const h of handles) {
    try {
      h.stop();
    } catch (err) {
      debug('stop failed', err);
    }
  }
  if (_voices) {
    const v = _voices.harp;
    if (v && v.synth && typeof v.synth.releaseAll === 'function') {
      try { v.synth.releaseAll(); } catch (_) { /* ignore */ }
    }
  }
  try {
    transport().cancel(0);
  } catch (_) {
    /* ignore before initAudio */
  }
  // Re-arm the bar counter repeat; transport().cancel removed it.
  _barRepeatId = null;
  _barCounter = 0;
  _barCounterBarTime = 0;
  try {
    ensureBarCounter();
  } catch (_) {
    /* ignore */
  }
}

/**
 * Stop every active playback for a given seedId.
 * @param {string} seedId
 */
export function stopBySeedId(seedId) {
  if (!seedId) return;
  const toStop = [];
  for (const [, h] of _active) {
    if (h.seedId === seedId) toStop.push(h);
  }
  for (const h of toStop) {
    try {
      h.stop();
    } catch (err) {
      debug('stop failed', err);
    }
  }
}

/**
 * Toggle master mute on Tone.Destination.
 * @param {boolean} muted
 */
export function setMuted(muted) {
  const dest = Tone.getDestination();
  dest.mute = Boolean(muted);
}

/**
 * Collisions stay silent at the player level. Visual-only; kept as an export
 * so existing call sites stay valid.
 * @param {object} _seedA
 * @param {object} _seedB
 */
export function playCollision(_seedA, _seedB) {
  /* intentional no-op. */
}

/** For tests / diagnostics. */
export function __getActiveCount() {
  return _active.size;
}

export const __constants = Object.freeze({
  MASTER_LIMITER_THRESHOLD_DB,
  MIN_ENERGY_TO_PLAY,
  DEFAULT_QPM,
  DEFAULT_BPM,
  MAX_SEEDS_PER_BAR,
  MASTER_GAIN_DB,
});
