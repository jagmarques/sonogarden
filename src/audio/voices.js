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

// Harp samples cover A2-G5 with gaps; Tone.Sampler interpolates missing pitches.
const HARP_URLS = Object.freeze({
  E1: 'E1.mp3', G1: 'G1.mp3', B1: 'B1.mp3',
  D2: 'D2.mp3', F2: 'F2.mp3', A2: 'A2.mp3',
  C3: 'C3.mp3', E3: 'E3.mp3', G3: 'G3.mp3', B3: 'B3.mp3',
  D4: 'D4.mp3', F4: 'F4.mp3', A4: 'A4.mp3',
  C5: 'C5.mp3', E5: 'E5.mp3', G5: 'G5.mp3', B5: 'B5.mp3',
  A6: 'A6.mp3', B6: 'B6.mp3', D6: 'D6.mp3', F6: 'F6.mp3',
  D7: 'D7.mp3', F7: 'F7.mp3',
});

function createHarpVoice(masterDest) {
  const v = buildSamplerVoice('harp', HARP_URLS, { attack: 0.01, release: 2.8 });
  if (masterDest) v.connect(masterDest);
  return v;
}

export function buildAllVoices(destinationNode) {
  const harp = createHarpVoice(destinationNode);
  return {
    piano: harp,
    harp,
    loaded: harp.loaded,
    dispose() {
      try { harp.dispose(); } catch (_) { /* ignore */ }
    },
  };
}

export function resolveInstrumentKeyForSeed() { return 'harp'; }
export function scaleTranspose() { return 0; }
