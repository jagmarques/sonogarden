// SOURCE: https://github.com/nbrosowsky/tonejs-instruments (sampler CDN)
// SOURCE: https://api.github.com/repos/nbrosowsky/tonejs-instruments/contents/samples/harp (verified 2026-04-21)

import * as Tone from 'tone';

const VOICE_OUT_GAIN = 0.55;
const SAMPLE_BASE = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

function buildSamplerVoice(name, urls, opts = {}) {
  const sampler = new Tone.Sampler({
    urls,
    baseUrl: `${SAMPLE_BASE}${name}/`,
    attack: opts.attack ?? 0,
    release: opts.release ?? 1,
  });

  const out = new Tone.Gain(opts.gain ?? VOICE_OUT_GAIN);
  sampler.connect(out);

  const loaded = new Promise((resolve) => {
    if (sampler.loaded) { resolve(); return; }
    const start = Date.now();
    const poll = () => {
      if (sampler.loaded) { resolve(); return; }
      if (Date.now() - start > 20000) { resolve(); return; }
      setTimeout(poll, 100);
    };
    poll();
  });

  return {
    synth: sampler,
    output: out,
    loaded,
    connect(dest) { out.connect(dest); },
    dispose() {
      try { sampler.releaseAll(); } catch (_) { /* ignore */ }
      try { sampler.dispose(); } catch (_) { /* ignore */ }
      try { out.dispose(); } catch (_) { /* ignore */ }
    },
  };
}

// Sparse sample maps keep mobile data footprint small. Tone.Sampler interpolates across gaps.
// Pitch inventory verified from github.com/nbrosowsky/tonejs-instruments samples directory.
const HARP_URLS = Object.freeze({ C3: 'C3.mp3', G3: 'G3.mp3', C5: 'C5.mp3', G5: 'G5.mp3', D6: 'D6.mp3' });
const PIANO_URLS = Object.freeze({ C3: 'C3.mp3', G3: 'G3.mp3', C4: 'C4.mp3', G4: 'G4.mp3', C5: 'C5.mp3' });
const CELLO_URLS = Object.freeze({ C2: 'C2.mp3', G2: 'G2.mp3', C3: 'C3.mp3', G3: 'G3.mp3', C4: 'C4.mp3' });
const HARMONIUM_URLS = Object.freeze({ C2: 'C2.mp3', C3: 'C3.mp3', G3: 'G3.mp3', C4: 'C4.mp3' });
const CONTRABASS_URLS = Object.freeze({ G1: 'G1.mp3', C2: 'C2.mp3', E2: 'E2.mp3', A2: 'A2.mp3', E3: 'E3.mp3' });
const GUITAR_NYLON_URLS = Object.freeze({ E2: 'E2.mp3', A2: 'A2.mp3', D3: 'D3.mp3', G3: 'G3.mp3', B3: 'B3.mp3', E4: 'E4.mp3' });
const FRENCH_HORN_URLS = Object.freeze({ C2: 'C2.mp3', D3: 'D3.mp3', F3: 'F3.mp3', A3: 'A3.mp3', C4: 'C4.mp3' });

function make(name, urls, opts, dest) {
  const v = buildSamplerVoice(name, urls, opts);
  if (dest) v.connect(dest);
  return v;
}

export function buildAllVoices(destinationNode) {
  const harp = make('harp', HARP_URLS, { attack: 0.01, release: 2.6, gain: 0.55 }, destinationNode);
  // Felt-piano emulation: soft attack + long release approximates Nils Frahm felt-muted piano.
  const piano = make('piano', PIANO_URLS, { attack: 0.06, release: 3.5, gain: 0.5 }, destinationNode);
  const cello = make('cello', CELLO_URLS, { attack: 0.25, release: 3.0, gain: 0.42 }, destinationNode);
  const harmonium = make('harmonium', HARMONIUM_URLS, { attack: 0.25, release: 2.2, gain: 0.22 }, destinationNode);
  const contrabass = make('contrabass', CONTRABASS_URLS, { attack: 0.2, release: 2.4, gain: 0.4 }, destinationNode);
  const guitarNylon = make('guitar-nylon', GUITAR_NYLON_URLS, { attack: 0.005, release: 2.0, gain: 0.5 }, destinationNode);
  const frenchHorn = make('french-horn', FRENCH_HORN_URLS, { attack: 0.3, release: 2.6, gain: 0.3 }, destinationNode);

  const all = [harp, piano, cello, harmonium, contrabass, guitarNylon, frenchHorn];
  const loaded = Promise.all(all.map((v) => v.loaded)).then(() => undefined);

  return {
    harp,
    piano,
    cello,
    harmonium,
    contrabass,
    guitarNylon,
    frenchHorn,
    loaded,
    dispose() {
      for (const v of all) { try { v.dispose(); } catch (_) { /* ignore */ } }
    },
  };
}

export function resolveInstrumentKeyForSeed() { return 'harp'; }
export function scaleTranspose() { return 0; }
