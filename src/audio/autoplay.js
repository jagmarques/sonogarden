import { playNoteSequence, startDrone, stopDrone } from './player.js';
import { sampleMelody, transposeNoteSequence } from '../ai/magenta.js';
import { getCurrentMood } from './moods.js';

const DEBUG = false;
// MusicVAE mel_4bar_small_q2 samples in C major by default (MIDI pitch 60 = tonic).
const SAMPLE_DEFAULT_TONIC = 60;

let _running = false;
let _timer = null;
let _inflight = false;
let _onMelody = null;

function debug(...args) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[sonogarden.autoplay]', ...args);
  }
}

function emitMelody(ns) {
  if (typeof _onMelody === 'function') {
    try { _onMelody(ns); } catch (_) { /* ignore */ }
  }
}

async function tick() {
  if (!_running || _inflight) return;
  _inflight = true;
  try {
    const mood = getCurrentMood();
    const tonic = typeof mood.tonic === 'number' ? mood.tonic : SAMPLE_DEFAULT_TONIC;
    // High, wide temperature band for genuinely different phrases every tick.
    const temperature = 1.0 + Math.random() * 0.5;
    const raw = await sampleMelody({ qpm: mood.bpm, temperature });
    // Random diatonic octave/fifth shift on top of the tonic so successive phrases don't hang
    // on exactly the same notes.
    const diatonicOffsets = [0, 0, 0, -12, 12, 7, -5];
    const extra = diatonicOffsets[Math.floor(Math.random() * diatonicOffsets.length)];
    const shifted = transposeNoteSequence(raw, tonic - SAMPLE_DEFAULT_TONIC + extra);
    debug('sampled melody', { notes: shifted.notes?.length, totalTime: shifted.totalTime });
    playNoteSequence(shifted, { qpm: mood.bpm });
    emitMelody(shifted);
  } catch (err) {
    debug('tick failed', err);
    if (typeof window !== 'undefined') {
      window.__sonoStats = window.__sonoStats || { notes: 0, plays: 0, drones: 0 };
      window.__sonoStats.lastError = (err && err.message) || String(err);
    }
  } finally {
    _inflight = false;
  }
}

function scheduleNext() {
  if (!_running) return;
  if (_timer) clearTimeout(_timer);
  const mood = getCurrentMood();
  const intervalMs = Math.max(4, (mood.interval || 16)) * 1000;
  _timer = setTimeout(async () => {
    await tick();
    scheduleNext();
  }, intervalMs);
}

export async function startAutoplay({ onMelody } = {}) {
  if (_running) return;
  _running = true;
  _onMelody = typeof onMelody === 'function' ? onMelody : null;
  const mood = getCurrentMood();
  startDrone(mood);
  await tick();
  scheduleNext();
}

export function stopAutoplay() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  stopDrone();
}

// Tonic / bpm / reverb changed; sample a fresh melody now and rebase interval.
export async function onMoodChange() {
  if (!_running) return;
  const mood = getCurrentMood();
  startDrone(mood);
  await tick();
  scheduleNext();
}

// Replay a stored NoteSequence (saved moment or shared melody) without breaking autoplay cadence.
export function playStoredMelody(ns) {
  if (!ns || !Array.isArray(ns.notes) || ns.notes.length === 0) return;
  const mood = getCurrentMood();
  const qpm = (ns.tempos && ns.tempos[0] && ns.tempos[0].qpm) || mood.bpm;
  playNoteSequence(ns, { qpm });
  emitMelody(ns);
  scheduleNext();
}
