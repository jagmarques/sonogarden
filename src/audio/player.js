// Browser-only. Tone.start() requires a user gesture.

import * as Tone from 'tone';
import { buildAllVoices } from './voices.js';
import { MOODS, setCurrentMood, getCurrentMood } from './moods.js';
import { emitNote } from './events.js';

const DEBUG = false;
const MASTER_LIMITER_THRESHOLD_DB = -3;
const MASTER_GAIN_DB = -5;
const DEFAULT_QPM = 80;
const DRONE_GAIN_DB = -32;
const MELODY_GAIN_DB = -7;
const DROP_DB_ON_NOTE = -3;
const DUCK_ATTACK = 0.04;
const DUCK_RELEASE = 0.6;

let _sourceGain = null;
let _masterGain = null;
let _hpf = null;
let _compressor = null;
let _reverb = null;
let _limiter = null;

let _voices = null;
let _melodyGain = null;
let _droneSynth = null;
let _droneGain = null;
let _droneBase = 1;

let _started = false;
let _starting = null;
let _gestureResolvers = [];
let _gestureListenerAttached = false;

function debug(...args) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[sonogarden.audio]', ...args);
  }
}

function transport() {
  return Tone.getTransport();
}

function dbToLin(db) { return Math.pow(10, db / 20); }

function ensureMasterChain() {
  if (_limiter) return _sourceGain;

  _limiter = new Tone.Limiter(MASTER_LIMITER_THRESHOLD_DB);
  _reverb = new Tone.Reverb({ decay: 6.0, preDelay: 0.03 });
  _reverb.wet.value = 0.45;
  _compressor = new Tone.Compressor({
    threshold: -18,
    ratio: 3,
    attack: 0.01,
    release: 0.2,
    knee: 8,
  });
  _hpf = new Tone.Filter({ frequency: 60, type: 'highpass', rolloff: -12 });
  _masterGain = new Tone.Gain(dbToLin(MASTER_GAIN_DB));
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
  ensureMasterChain();
  _melodyGain = new Tone.Gain(dbToLin(MELODY_GAIN_DB)).connect(_sourceGain);
  _voices = buildAllVoices(_melodyGain);
  return _voices;
}

function attachGestureListener() {
  if (_gestureListenerAttached) return;
  if (typeof window === 'undefined') return;
  _gestureListenerAttached = true;
  const events = ['pointerdown', 'keydown', 'touchstart'];
  const handler = async () => {
    for (const ev of events) window.removeEventListener(ev, handler, true);
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
  for (const ev of events) window.addEventListener(ev, handler, { capture: true, passive: true });
}

function contextRunning() {
  try { return Tone.getContext().state === 'running'; } catch (_) { return false; }
}

async function realStart() {
  if (_started && contextRunning()) return;
  await Tone.start();
  ensureMasterChain();
  ensureVoices();

  const t = transport();
  const mood = getCurrentMood();
  t.bpm.value = (mood && mood.bpm) || 60;
  if (t.state !== 'started') t.start();
  if (_reverb && mood) {
    try { _reverb.decay = mood.reverbDecay; } catch (_) { /* ignore */ }
    try { _reverb.wet.value = mood.reverbWet; } catch (_) { /* ignore */ }
  }
  _started = true;
}

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
  }).finally(() => { _starting = null; });
  return _starting;
}

export async function waitForVoicesLoaded() {
  await initAudio().catch(() => { /* gesture pending */ });
  const voices = ensureVoices();
  if (voices && voices.loaded && typeof voices.loaded.then === 'function') {
    await voices.loaded;
  }
}

export function setMood(name) {
  const m = MOODS[name];
  if (!m) return null;
  setCurrentMood(name);
  try { transport().bpm.rampTo(m.bpm, 0.5); } catch (_) { /* pre-init */ }
  if (_reverb) {
    try { _reverb.decay = m.reverbDecay; } catch (_) { /* ignore */ }
    try { _reverb.wet.rampTo(m.reverbWet, 0.5); } catch (_) { /* ignore */ }
  }
  return m;
}

function midiToFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

// Pads a tonic+fifth low drone under sampled melodies so gaps never feel dead.
export function startDrone(mood) {
  ensureMasterChain();
  if (!_droneSynth) {
    _droneBase = dbToLin(DRONE_GAIN_DB);
    _droneGain = new Tone.Gain(_droneBase).connect(_sourceGain);
    _droneSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 1.5, decay: 0, sustain: 1, release: 4 },
    }).connect(_droneGain);
  }
  const tonic = typeof mood?.tonic === 'number' ? mood.tonic : 60;
  const low = tonic - 12;
  const fifth = low + 7;
  try {
    _droneSynth.releaseAll();
    _droneSynth.triggerAttack([midiToFreq(low), midiToFreq(fifth)], Tone.now() + 0.05);
    if (typeof window !== 'undefined') {
      window.__sonoStats = window.__sonoStats || { notes: 0, plays: 0, drones: 0 };
      window.__sonoStats.drones += 1;
    }
  } catch (err) {
    debug('drone start failed', err);
  }
}

export function stopDrone() {
  if (!_droneSynth) return;
  try { _droneSynth.releaseAll(); } catch (_) { /* ignore */ }
}

// Sidechain-style duck: on each note, drop drone gain toward floor then spring back.
function duckDrone(atTime) {
  if (!_droneGain) return;
  const g = _droneGain.gain;
  const floor = _droneBase * dbToLin(DROP_DB_ON_NOTE);
  try {
    g.cancelScheduledValues(atTime);
    g.setTargetAtTime(floor, atTime, DUCK_ATTACK);
    g.setTargetAtTime(_droneBase, atTime + DUCK_ATTACK + 0.05, DUCK_RELEASE);
  } catch (_) { /* ignore */ }
}

// Plays a MusicVAE INoteSequence. Start times are in seconds at the sequence's qpm.
export async function playNoteSequence(ns, opts = {}) {
  if (!ns || !Array.isArray(ns.notes) || ns.notes.length === 0) return null;

  const { qpm: qpmOpt, velocity = 0.45 } = opts;
  const qpm =
    typeof qpmOpt === 'number' && qpmOpt > 0
      ? qpmOpt
      : (ns.tempos && ns.tempos[0] && ns.tempos[0].qpm) || DEFAULT_QPM;

  await initAudio();
  if (!contextRunning()) return null;

  const voices = ensureVoices();
  const piano = voices.piano;
  if (!piano) return null;

  const base = Tone.now() + 0.05;
  const srcQpm = (ns.tempos && ns.tempos[0] && ns.tempos[0].qpm) || 120;
  const scale = srcQpm / qpm;

  let scheduled = 0;
  for (const n of ns.notes) {
    if (typeof n.pitch !== 'number') continue;
    const startSec = (typeof n.startTime === 'number' ? n.startTime : 0) * scale;
    const endSec = (typeof n.endTime === 'number' ? n.endTime : (n.startTime || 0) + 0.25) * scale;
    const dur = Math.max(0.08, endSec - startSec);
    const vel = typeof n.velocity === 'number' ? Math.max(0.1, Math.min(1, n.velocity / 127)) : velocity;
    const absTime = base + startSec;
    try {
      piano.synth.triggerAttackRelease(midiToFreq(n.pitch), dur, absTime, vel);
      duckDrone(absTime);
      emitNote({ pitch: n.pitch, velocity: vel, duration: dur, atMs: Date.now() + startSec * 1000 });
      scheduled++;
    } catch (err) {
      debug('note trigger failed', err);
    }
  }
  if (typeof window !== 'undefined') {
    window.__sonoStats = window.__sonoStats || { notes: 0, plays: 0, drones: 0 };
    window.__sonoStats.notes += scheduled;
    window.__sonoStats.plays += 1;
    window.__sonoStats.lastQpm = qpm;
    window.__sonoStats.lastScheduled = scheduled;
    window.__sonoStats.lastAt = Date.now();
  }
  return { notes: scheduled };
}

export function stopAll() {
  if (_voices && _voices.piano && _voices.piano.synth && typeof _voices.piano.synth.releaseAll === 'function') {
    try { _voices.piano.synth.releaseAll(); } catch (_) { /* ignore */ }
  }
}

export function setMuted(muted) {
  Tone.getDestination().mute = Boolean(muted);
}
