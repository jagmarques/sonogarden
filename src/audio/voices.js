// Sampled-instrument voices (harp, piano, violin). Served from the
// nbrosowsky/tonejs-instruments CDN. The Sampler repitches for missing notes.

import * as Tone from 'tone';

// Gain cushion for master chain head-room before the limiter clamps.
const VOICE_OUT_GAIN = 0.65;

const SAMPLE_BASE = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

// Harp sample set verified on CDN. Sparse but the Sampler repitches smoothly.
const HARP_URLS = Object.freeze({
  E1: 'E1.mp3', G1: 'G1.mp3', B1: 'B1.mp3',
  D2: 'D2.mp3', F2: 'F2.mp3', A2: 'A2.mp3',
  C3: 'C3.mp3', E3: 'E3.mp3', G3: 'G3.mp3', B3: 'B3.mp3',
  A4: 'A4.mp3',
  C5: 'C5.mp3', E5: 'E5.mp3', G5: 'G5.mp3', B5: 'B5.mp3',
  D6: 'D6.mp3', F6: 'F6.mp3',
  A6: 'A6.mp3', B6: 'B6.mp3',
});

function buildSamplerVoice(name, urls, opts = {}) {
  const sampler = new Tone.Sampler({
    urls,
    baseUrl: `${SAMPLE_BASE}${name}/`,
    attack: opts.attack ?? 0,
    release: opts.release ?? 1,
  });

  const out = new Tone.Gain(VOICE_OUT_GAIN);
  sampler.connect(out);

  // Poll-based loaded promise so callers can await regardless of state.
  const loaded = new Promise((resolve) => {
    if (sampler.loaded) {
      resolve();
      return;
    }
    const start = Date.now();
    const poll = () => {
      if (sampler.loaded) {
        resolve();
        return;
      }
      if (Date.now() - start > 20000) {
        resolve();
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });

  return {
    synth: sampler,
    output: out,
    loaded,
    connect(dest) {
      out.connect(dest);
    },
    dispose() {
      try { sampler.releaseAll(); } catch (_) { /* ignore */ }
      try { sampler.dispose(); } catch (_) { /* ignore */ }
      try { out.dispose(); } catch (_) { /* ignore */ }
    },
  };
}

/**
 * Build the harp voice. 1.2s release lets the pluck bloom into the reverb.
 * @param {Tone.ToneAudioNode|AudioNode} masterDest
 */
export function createHarpVoice(masterDest) {
  const v = buildSamplerVoice('harp', HARP_URLS, { attack: 0.01, release: 1.2 });
  if (masterDest) v.connect(masterDest);
  return v;
}

/** Scale-to-voice routing fallback (mood override usually wins). */
export function resolveInstrumentKey(_scale) {
  return 'harp';
}

/** Seed-to-voice fallback (mood override usually wins). */
export function resolveInstrumentKeyForSeed(_scale, _lowestMidi) {
  return 'harp';
}

/**
 * No per-scale transpose. Harp sounds good in its native register.
 * @param {string} _scale
 * @returns {number}
 */
export function scaleTranspose(_scale) {
  return 0;
}

// Piano samples (sparse, sampler repitches for missing pitches).
const PIANO_URLS = Object.freeze({
  A1: 'A1.mp3', C2: 'C2.mp3', D2: 'D2.mp3', E2: 'E2.mp3', G2: 'G2.mp3',
  A2: 'A2.mp3', C3: 'C3.mp3', D3: 'D3.mp3', E3: 'E3.mp3', G3: 'G3.mp3',
  A3: 'A3.mp3', C4: 'C4.mp3', D4: 'D4.mp3', E4: 'E4.mp3', G4: 'G4.mp3',
  A4: 'A4.mp3', C5: 'C5.mp3', D5: 'D5.mp3', E5: 'E5.mp3', G5: 'G5.mp3',
  A5: 'A5.mp3', C6: 'C6.mp3',
});

// Violin samples.
const VIOLIN_URLS = Object.freeze({
  A3: 'A3.mp3', C4: 'C4.mp3', E4: 'E4.mp3', G4: 'G4.mp3',
  A4: 'A4.mp3', C5: 'C5.mp3', E5: 'E5.mp3', G5: 'G5.mp3',
  A5: 'A5.mp3', C6: 'C6.mp3', E6: 'E6.mp3', G6: 'G6.mp3',
});

export function createPianoVoice(masterDest) {
  const v = buildSamplerVoice('piano', PIANO_URLS, { attack: 0.005, release: 2.0 });
  if (masterDest) v.connect(masterDest);
  return v;
}

export function createViolinVoice(masterDest) {
  const v = buildSamplerVoice('violin', VIOLIN_URLS, { attack: 0.08, release: 2.0 });
  if (masterDest) v.connect(masterDest);
  return v;
}

export const AVAILABLE_VOICES = ['harp'];

export function buildAllVoices(destinationNode) {
  const harp = createHarpVoice(destinationNode);
  return {
    harp,
    piano: harp,
    violin: harp,
    loaded: harp.loaded,
    dispose() { try { harp.dispose(); } catch (_) { /* ignore */ } },
  };
}

/**
 * Form-specific velocity curve so each form has a touch-signature.
 * @param {string} form
 * @param {number} noteIndex 0-based
 * @param {number} totalNotes
 * @param {number} baseVel 0..1
 * @returns {number} velocity 0..1
 */
export function formVelocity(form, noteIndex, totalNotes, baseVel) {
  const n = Math.max(1, totalNotes);
  const i = Math.max(0, Math.min(n - 1, noteIndex));
  let v;
  switch (form) {
    case 'motif': {
      v = baseVel * (1 - 0.05 * i);
      break;
    }
    case 'riff': {
      const barLen = Math.max(1, Math.floor(n / 2));
      const downbeat = i % barLen === 0;
      v = baseVel * (downbeat ? 1 : 0.9);
      break;
    }
    case 'arpeggio': {
      v = baseVel * (1 + 0.05 * i);
      break;
    }
    case 'ostinato': {
      v = baseVel;
      break;
    }
    case 'round': {
      const half = Math.max(1, Math.floor(n / 2));
      v = baseVel * (i < half ? 1 : 0.8);
      break;
    }
    default:
      v = baseVel;
  }
  return v < 0.05 ? 0.05 : v > 1 ? 1 : v;
}

export const __constants = Object.freeze({
  VOICE_OUT_GAIN,
  SAMPLE_BASE,
});
