// Browser-only. Tone.start() requires a user gesture.

import * as Tone from 'tone';
import { buildAllVoices } from './voices.js';
import { MOODS, setCurrentMood, getCurrentMood } from './moods.js';
import { emitNote } from './events.js';
import { setPadVolume } from './ambient.js';

const DEBUG = false;
const MASTER_LIMITER_THRESHOLD_DB = -3;
const MASTER_GAIN_DB = 0;
const MELODY_GAIN_DB = 0;

let _sourceGain = null;
let _masterGain = null;
let _hpf = null;
let _compressor = null;
let _reverb = null;
let _delay = null;
let _limiter = null;

let _voices = null;
let _melodyGain = null;
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
  // Tape-style feedback echo. Wet is modulated per mood in setMood.
  _delay = new Tone.FeedbackDelay({ delayTime: 0.4, feedback: 0.35 });
  _delay.wet.value = 0.2;
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
  _compressor.connect(_delay);
  _delay.connect(_reverb);
  _reverb.connect(_limiter);
  _limiter.connect(Tone.getDestination());

  return _sourceGain;
}

export function getMelodyBus() {
  ensureVoices();
  return _melodyGain;
}

export function getPadBus() {
  ensureMasterChain();
  return _sourceGain;
}

// Returns a named voice (piano, harp, cello, harmonium, contrabass, guitarNylon, frenchHorn).
// Async callers should await waitForVoicesLoaded first if they need the sampler ready.
export function getVoice(key) {
  const v = ensureVoices();
  return v ? v[key] : null;
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

// iOS silent-buffer unlock; commits ctx resume even when Tone.start() reports running.
function unlockIOSAudio() {
  try {
    const ctx = Tone.getContext().rawContext;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    if (typeof src.start === 'function') src.start(0);
    if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => { /* ignore */ });
    }
  } catch (_) { /* ignore */ }
}

// iOS 17.5+: route Web Audio through media channel so silent slider does not mute. WebKit 237322.
function setIOSAudioSessionPlayback() {
  try {
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
      navigator.audioSession.type = 'playback';
    }
  } catch (_) { /* ignore */ }
}

// 0.5s silent 8kHz mono 8-bit PCM blob. iOS rejects 0-sample WAVs.
function buildSilentWavBlob() {
  const rate = 8000;
  const samples = rate / 2;
  const total = 44 + samples;
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  v.setUint32(0, 0x52494646, false);
  v.setUint32(4, total - 8, true);
  v.setUint32(8, 0x57415645, false);
  v.setUint32(12, 0x666d7420, false);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  v.setUint32(36, 0x64617461, false);
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  return new Blob([buf], { type: 'audio/wav' });
}

// iOS < 17.5 fallback: hidden silent WAV keeps the media route open. swevans/unmute trick.
let _silentAudioEl = null;
function startSilentAudioKeepalive() {
  try {
    if (_silentAudioEl) return;
    if (typeof document === 'undefined') return;
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator) return;
    const blob = buildSilentWavBlob();
    const url = URL.createObjectURL(blob);
    const el = document.createElement('audio');
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.setAttribute('x-webkit-airplay', 'deny');
    el.loop = true;
    el.preload = 'auto';
    el.muted = false;
    el.volume = 1;
    el.src = url;
    el.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
    document.body.appendChild(el);
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ });
    _silentAudioEl = el;
  } catch (_) { /* ignore */ }
}

async function realStart() {
  if (_started && contextRunning()) return;
  // Synchronous calls must run before any await so iOS keeps user-gesture activation.
  setIOSAudioSessionPlayback();
  startSilentAudioKeepalive();
  unlockIOSAudio();
  try {
    const raw = Tone.getContext().rawContext;
    if (raw && raw.state !== 'running' && typeof raw.resume === 'function') {
      raw.resume();
    }
  } catch (_) { /* ignore */ }
  await Tone.start();
  unlockIOSAudio();
  setIOSAudioSessionPlayback();
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
  try { if (m.bpm) transport().bpm.rampTo(m.bpm, 0.5); } catch (_) { /* pre-init */ }
  if (_reverb) {
    try { _reverb.decay = m.reverbDecay; } catch (_) { /* ignore */ }
    try { _reverb.wet.rampTo(m.reverbWet, 0.5); } catch (_) { /* ignore */ }
  }
  if (_delay) {
    try { _delay.delayTime.rampTo(m.delayTime ?? 0.4, 0.8); } catch (_) { /* ignore */ }
    try { _delay.feedback.rampTo(m.delayFeedback ?? 0.3, 0.8); } catch (_) { /* ignore */ }
    try { _delay.wet.rampTo(m.delayWet ?? 0.2, 0.8); } catch (_) { /* ignore */ }
  }
  if (typeof m.padVolumeDb === 'number') {
    try { setPadVolume(m.padVolumeDb); } catch (_) { /* ignore */ }
  }
  return m;
}

function midiToFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

// Per-voice safe pitch ranges. Outside these ranges Tone.Sampler stretches awkwardly.
const VOICE_RANGES = {
  piano: [36, 96],
  harp: [48, 84],
  cello: [36, 72],
  harmonium: [36, 72],
  contrabass: [28, 55],
  guitarNylon: [40, 76],
  frenchHorn: [40, 72],
};

function clampToRange(pitch, key) {
  const r = VOICE_RANGES[key] || [48, 84];
  let p = pitch;
  while (p < r[0]) p += 12;
  while (p > r[1]) p -= 12;
  return p;
}

// Trigger a single note on a named voice (piano, harp, cello, harmonium, etc.). Shared
// entry point for the ambient engine; the mood descriptor picks which voice to call.
export async function triggerVoice(voiceKey, pitch, velocity = 0.5, duration = 2.5, atTime = null) {
  await initAudio();
  if (!contextRunning()) return;
  const voices = ensureVoices();
  const v = voices[voiceKey];
  if (!v) return;
  const p = clampToRange(pitch, voiceKey);
  const when = typeof atTime === 'number' ? atTime : Tone.now() + 0.02;
  try {
    v.synth.triggerAttackRelease(midiToFreq(p), duration, when, velocity);
    emitNote({ pitch: p, velocity, duration, atMs: Date.now() });
    if (typeof window !== 'undefined') {
      window.__sonoStats = window.__sonoStats || { notes: 0, plays: 0, drones: 0 };
      window.__sonoStats.notes += 1;
      window.__sonoStats.lastAt = Date.now();
    }
  } catch (err) {
    debug('triggerVoice failed', err);
  }
}

export function stopAll() {
  if (_voices && _voices.piano && _voices.piano.synth && typeof _voices.piano.synth.releaseAll === 'function') {
    try { _voices.piano.synth.releaseAll(); } catch (_) { /* ignore */ }
  }
}

export function setMuted(muted) {
  Tone.getDestination().mute = Boolean(muted);
}

// Diagnostic snapshot for the on-screen badge. Safe to call at any time.
export function getAudioDiagnostics() {
  const out = {
    toneState: '?',
    rawState: '?',
    sampleRate: 0,
    session: null,
    padConnected: false,
    samplerLoaded: false,
    silentKeepalive: false,
    notes: 0,
    lastNoteAgoMs: null,
  };
  try {
    const ctx = Tone.getContext();
    out.toneState = ctx.state;
    const raw = ctx.rawContext;
    if (raw) {
      out.rawState = raw.state;
      out.sampleRate = raw.sampleRate;
    }
  } catch (_) { /* ignore */ }
  try {
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
      out.session = navigator.audioSession.type || 'unset';
    } else {
      out.session = 'n/a';
    }
  } catch (_) { out.session = 'err'; }
  out.padConnected = Boolean(_sourceGain);
  try {
    const v = _voices && _voices.piano && _voices.piano.synth;
    out.samplerLoaded = Boolean(v && v.loaded);
  } catch (_) { /* ignore */ }
  try {
    out.silentKeepalive = Boolean(_silentAudioEl && !_silentAudioEl.paused);
  } catch (_) { /* ignore */ }
  try {
    if (typeof window !== 'undefined' && window.__sonoStats) {
      out.notes = window.__sonoStats.notes || 0;
      if (window.__sonoStats.lastAt) {
        out.lastNoteAgoMs = Date.now() - window.__sonoStats.lastAt;
      }
    }
  } catch (_) { /* ignore */ }
  return out;
}
