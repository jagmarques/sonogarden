// Browser-only: @magenta/music/es6 depends on window/tf.

import * as mm from '@magenta/music/es6';

// SOURCE: https://github.com/magenta/magenta-js/blob/master/music/checkpoints/README.md
// mel_2bar_small: 2-bar melody model. Shorter phrases + higher entropy per draw -> more variety.
const CHECKPOINT_URL =
  'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_2bar_small';

const DEFAULT_TEMPERATURE = 1.2;
const DEFAULT_STEPS_PER_QUARTER = 4;

let _model = null;
let _loadPromise = null;

export function getCheckpointUrl() {
  return CHECKPOINT_URL;
}

export function initMagenta() {
  if (_model && _model.isInitialized()) return Promise.resolve(_model);
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const model = new mm.MusicVAE(CHECKPOINT_URL);
    await model.initialize();
    if (!model.isInitialized()) throw new Error('MusicVAE failed to initialize');
    _model = model;
    return model;
  })().catch((err) => {
    _loadPromise = null;
    throw err;
  });

  return _loadPromise;
}

// MusicVAE.sample returns a QUANTIZED NoteSequence. We leave sample at the default qpm and let
// unquantizeSequence rewrite to our desired qpm in one step so tempo markers stay consistent.
export async function sampleMelody({ temperature = DEFAULT_TEMPERATURE, qpm = 80 } = {}) {
  const model = await initMagenta();
  const seqs = await model.sample(1, temperature, undefined, DEFAULT_STEPS_PER_QUARTER);
  return mm.sequences.unquantizeSequence(seqs[0], qpm);
}

// Diatonic transpose in semitones. Added to every note pitch.
export function transposeNoteSequence(ns, semitones) {
  if (!ns || !Array.isArray(ns.notes) || semitones === 0) return ns;
  const next = { ...ns, notes: ns.notes.map((n) => ({ ...n, pitch: n.pitch + semitones })) };
  return next;
}
