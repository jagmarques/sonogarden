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

// Sparse 5-sample map so the page is playable on mobile data (fewer HTTP requests).
// Tone.Sampler interpolates across gaps. Sample list WebFetch-verified from the CDN's
// samples/harp/ directory listing (see companion comment at top).
const HARP_URLS = Object.freeze({
  C3: 'C3.mp3',
  G3: 'G3.mp3',
  C5: 'C5.mp3',
  G5: 'G5.mp3',
  D6: 'D6.mp3',
});

function createHarpVoice(masterDest) {
  const v = buildSamplerVoice('harp', HARP_URLS, { attack: 0.01, release: 2.6 });
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
