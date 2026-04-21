# sonogarden

Free, browser-only ambient focus app. Open URL, pick a mood, hear a generative harp soundscape over a pink-noise bed, and drag around a live 3D field of glowing orbs and breaking polyhedra.

Live: https://jagmarques.github.io/sonogarden/

## Three moods

- **focus** — C4 major, dry, short delay, frequent harp chimes.
- **meditate** — G3 minor, long reverb, half-second echo, slower chord drift.
- **sleep** — C3 minor, 14 s reverb tail, 1 s feedback delay, very sparse chimes.

Each mood tunes tonic, scale, reverb decay/wet, delay time/feedback, pad volume, chime cadence, chord change rate, and a distinct accent colour.

## Audio engine

Three independent layers, all floating on their own timers (no beat grid):

- **Pink-noise bed** via a lowpass at 800 Hz, -30 dB. Never stops.
- **Sine FM pad** (`Tone.PolySynth`) with long attack/release playing tonic-triad voicings. Refreshes every 9-14 s; chord drifts every 22-50 s through key-related chords (I / IV / V / vi for major, i / VII / VI / V for minor).
- **Harp sampler** plays a pentatonic arpeggio or simultaneous triad chord per chime, 25 % chance of a high shimmer follow-up. Sparse 5-sample harp set (`C3, G3, C5, G5, D6`) interpolated by Tone.Sampler to keep mobile data loads tiny.

Master chain: source -> master gain -> HPF -> compressor -> `FeedbackDelay` (per-mood) -> `Reverb` (per-mood) -> limiter -> destination.

Engine grounded in two WebFetch-verified Wikipedia sources:
- `Tintinnabuli` — T-voice arpeggiates the tonic triad, M-voice moves diatonically in stepwise motion (Pärt).
- `Pentatonic_scale` — omitting the 4th and 7th avoids dissonant combinations.

## Visual field

`src/visual/Bloomfield.svelte` renders a single three.js scene:

- **Random convex polyhedra** at the focal point. Every morph builds a fresh shape from 7-14 points on a jittered sphere fed through `ConvexGeometry` — no two morphs repeat.
- **Break-and-reform** morph via a custom vertex shader: each edge has its own per-vertex random direction (`aRand`) and its own break window (`aPhase`), so edges scatter one-by-one over ~9 s. One endpoint of each edge is anchored so the wireframe never fully disconnects.
- **Two wireframe orbit rings** around the centerpiece on tilted axes.
- **Six glowing satellites** orbiting on circular paths with pulsing opacity.
- **~128 GPU orbs** (`THREE.Points` with a custom shader) spawn on every harp note; pitch drives Y, velocity drives size, chord hue rotates per pitch class. Sticky connecting lines (capped at 60, 2.5 s stickiness) fade individually when pairs drift apart.
- **Calm FBM-haze gradient** backdrop with a 120x120 twinkle-star layer; palette lerps to the current mood accent.

Interactions:
- **Click** = chord burst + 10-orb radial shockwave + trigger next morph.
- **Drag** = orbits the whole scene 360° (yaw + pitch).
- **Scroll / pinch** = camera zoom 6-26 units.

## Controls

- **Top left**: now-playing chord (e.g. "C major").
- **Top right**: the three mood pill buttons.
- **Bottom right**: session timer, play/pause, restart, mute.
- **Bottom left**: `copy link` button — generates a `?s=base64(mood, melody)` URL you can share.
- **First open**: 3-slide intro overlay, dismissed forever after.

## Differentiators

Closest shipped neighbours: [ambient.garden](https://ambient.garden/) (3D landscape, algorithmic audio) and [generative.fm](https://play.generative.fm) (browser generative music, pay-what-you-want, no visuals).

Sonogarden's wedge:
- Mood-categorical UX (one-tap focus/meditate/sleep) instead of spatial exploration.
- Share-a-moment URL that replays the exact chord state.
- Session timer + pause / restart for meditation sessions.
- Mobile-first bundle (833 KB gzipped after dropping p5 + magenta).
- Abstract geometric forms with break-and-reform, not a walkable landscape.

## Architecture

```
src/
  App.svelte              boot, mood pills, timer, copy-link UI
  audio/
    ambient.js            3 always-on layers: noise bed, pad, harp chimes
    autoplay.js           start/stop/moodChange facade
    events.js             pub-sub for note events consumed by Bloomfield
    moods.js              3 mood presets (tonic, scale, reverb, delay, chime cadence, palette)
    player.js             master Tone chain, triggerHarp, FeedbackDelay + Reverb
    voices.js             sparse 5-sample harp sampler
  state/store.svelte.js   Svelte rune store: liveMelody, muted
  ui/
    MuteButton.svelte
    StartOverlay.svelte   gesture-unlock with iOS silent-buffer trick
  visual/Bloomfield.svelte three.js scene
  main.js
index.html                inline boot-error overlay (shows real errors on mobile)
```

## Build

```bash
npm install
npm run dev     # local dev server
npm run build   # production build into dist/
```

Auto-deploys to GitHub Pages on push to `main` via `.github/workflows/deploy.yml`.

## License

MIT. See LICENSE.
