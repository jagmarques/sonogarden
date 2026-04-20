// Magenta.js MusicVAE wrapper.
// See .company/ai/magenta-api.md sections 1-9 and .company/ai/evolution.md sections 3-4.
// Browser-only module: do not import from Node runtime.

import * as mm from '@magenta/music/es6';

const CHECKPOINT_URL =
  'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_4bar_small_q2';

const EXPECTED_Z_SIZE = 256;
const LATENT_CLAMP = 3;
const DEFAULT_TEMPERATURE = 0.5;
const DEFAULT_STEPS_PER_QUARTER = 4;

let _model = null;
let _loadPromise = null;
let _verifiedZSize = null;

export function getCheckpointUrl() {
  return CHECKPOINT_URL;
}

export function getModel() {
  return _model;
}

export function initMagenta() {
  if (_model && _model.isInitialized()) {
    return Promise.resolve(_model);
  }
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const model = new mm.MusicVAE(CHECKPOINT_URL);
    await model.initialize();
    if (!model.isInitialized()) {
      throw new Error('MusicVAE failed to initialize');
    }
    _model = model;
    return model;
  })().catch((err) => {
    _loadPromise = null;
    throw err;
  });

  return _loadPromise;
}

function ensureQuantized(noteSequence) {
  const stepsPerQuarter =
    (noteSequence &&
      noteSequence.quantizationInfo &&
      noteSequence.quantizationInfo.stepsPerQuarter) ||
    0;
  if (stepsPerQuarter > 0) return noteSequence;
  return mm.sequences.quantizeNoteSequence(noteSequence, DEFAULT_STEPS_PER_QUARTER);
}

function assertZSize(length) {
  if (_verifiedZSize === null) {
    if (length !== EXPECTED_Z_SIZE) {
      throw new Error(
        `MusicVAE latent size mismatch: expected ${EXPECTED_Z_SIZE}, got ${length}. ` +
          `Pin the correct z_size in src/ai/magenta.js or re-encode all stored seeds.`,
      );
    }
    _verifiedZSize = length;
  } else if (length !== _verifiedZSize) {
    throw new Error(
      `MusicVAE latent size changed mid-session: was ${_verifiedZSize}, got ${length}.`,
    );
  }
}

export async function encodeSeed(noteSequence) {
  const model = await initMagenta();
  const quantized = ensureQuantized(noteSequence);
  const zTensor = await model.encode([quantized]);
  try {
    const arr = await zTensor.array();
    const vec = arr[0];
    assertZSize(vec.length);
    return Array.from(vec);
  } finally {
    zTensor.dispose();
  }
}

export async function decodeLatent(latent, temperature = DEFAULT_TEMPERATURE) {
  if (!Array.isArray(latent) || latent.length === 0) {
    throw new Error('decodeLatent: latent must be a non-empty array');
  }
  const model = await initMagenta();
  assertZSize(latent.length);
  const zT = mm.tf.tensor2d([latent], [1, latent.length]);
  try {
    const seqs = await model.decode(zT, temperature);
    return seqs[0];
  } finally {
    zT.dispose();
  }
}

function boxMullerNormal(rng) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function mutateLatent(latent, stdDev = 0.5, rng = Math.random) {
  if (!Array.isArray(latent)) {
    throw new Error('mutateLatent: latent must be an array');
  }
  const out = new Array(latent.length);
  for (let i = 0; i < latent.length; i++) {
    const n = boxMullerNormal(rng);
    const v = latent[i] + stdDev * n;
    out[i] = v < -LATENT_CLAMP ? -LATENT_CLAMP : v > LATENT_CLAMP ? LATENT_CLAMP : v;
  }
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

// Spherical linear interpolation per White 2016 (arxiv.org/abs/1609.04468).
export function breedLatents(latentA, latentB, t = 0.5) {
  if (!Array.isArray(latentA) || !Array.isArray(latentB)) {
    throw new Error('breedLatents: both latents must be arrays');
  }
  if (latentA.length !== latentB.length) {
    throw new Error('breedLatents: latent length mismatch');
  }
  const nA = norm(latentA);
  const nB = norm(latentB);
  const denom = nA * nB;
  if (denom < 1e-12) {
    // fall back to linear interpolation if either vector is ~zero
    const out = new Array(latentA.length);
    for (let i = 0; i < latentA.length; i++) {
      out[i] = (1 - t) * latentA[i] + t * latentB[i];
    }
    return clampLatent(out);
  }
  let cos = dot(latentA, latentB) / denom;
  if (cos > 1) cos = 1;
  if (cos < -1) cos = -1;
  const omega = Math.acos(cos);
  const so = Math.sin(omega);
  const out = new Array(latentA.length);
  if (so < 1e-6) {
    for (let i = 0; i < latentA.length; i++) {
      out[i] = (1 - t) * latentA[i] + t * latentB[i];
    }
  } else {
    const wa = Math.sin((1 - t) * omega) / so;
    const wb = Math.sin(t * omega) / so;
    for (let i = 0; i < latentA.length; i++) {
      out[i] = wa * latentA[i] + wb * latentB[i];
    }
  }
  return clampLatent(out);
}

export function clampLatent(latent, lo = -LATENT_CLAMP, hi = LATENT_CLAMP) {
  const out = new Array(latent.length);
  for (let i = 0; i < latent.length; i++) {
    const v = latent[i];
    out[i] = v < lo ? lo : v > hi ? hi : v;
  }
  return out;
}

export function latentDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    throw new Error('latentDistance: arrays must be same-length');
  }
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export const __constants = Object.freeze({
  CHECKPOINT_URL,
  EXPECTED_Z_SIZE,
  LATENT_CLAMP,
  DEFAULT_TEMPERATURE,
  DEFAULT_STEPS_PER_QUARTER,
});
