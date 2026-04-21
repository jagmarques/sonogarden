# sonogarden

Free, browser-only ambient music app. Three moods, each with its own per-mood instrument set, played over a soft sine-pad bed and pink-noise floor while a live 3D field of glowing orbs and breaking polyhedra reacts to every note.

Live: https://jagmarques.github.io/sonogarden/

## Three moods

- **focus**. C major, piano phrases over a quiet sine pad with rare harp shimmer. Short reverb tail, frequent phrases.
- **meditate**. G minor, cello phrases over a harmonium drone with rare harp shimmer. Long reverb, slower chord drift.
- **sleep**. C minor, soft piano phrases over a near-inaudible sine pad and pink-noise bed. Very sparse, longest gaps.

Each mood tunes tonic, scale, reverb decay/wet, delay time/feedback, pad volume, phrase cadence, chord change rate, and a distinct accent colour.

## Audio engine

Three independent layers, all floating on their own timers (no beat grid):

- **Pink noise bed** via a lowpass at 800 Hz, around -30 dB. Always on.
- **Sine FM pad** (`Tone.PolySynth`) with long attack/release playing tonic-triad voicings. Chord drifts every 28-58 seconds through key-related chords (I / IV / V / vi for major, i / VII / VI / V for minor).
- **Per-mood phrase scheduler** fires a 4-7 note pentatonic phrase every 4.5-18 seconds (tighter for focus, sparser for sleep) on the mood's `phraseVoice`. Each phrase has a soft 30 percent chance of an answering octave-up note for call-and-response. Optional `shimmerVoice` adds a single high note 10 percent of the time. Optional `droneVoice` (e.g. harmonium for meditate) re-triggers a held bass + fifth every 9-13 seconds.

Master chain: source -> master gain -> HPF -> compressor -> `FeedbackDelay` (per-mood) -> `Reverb` (per-mood) -> limiter -> destination.

Per-mood voices selected from the [nbrosowsky/tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) CDN (sparse 4-6 sample maps, Tone.Sampler interpolates the rest):

| Mood | Phrase | Drone | Shimmer |
|---|---|---|---|
| focus | piano | none | harp |
| meditate | cello | harmonium | harp |
| sleep | piano | none | none |

Phrase shapes are 12 pre-written pentatonic templates with returns and suspensions, not random walks. Velocity follows an arch (soft, louder, soft) so each phrase reads as a musical figure rather than a chime.

## Mobile audio (iOS Safari)

iOS routes Web Audio through the "ambient" channel by default, which the hardware silent slider mutes. Three measures keep audio playing through the silent switch:

1. `navigator.audioSession.type = 'playback'` set in `index.html` before Tone creates its AudioContext (iOS 17.5+).
2. Hidden silent-WAV `<audio playsinline loop>` keepalive started inside the unlock gesture (iOS 17.0-17.4 fallback).
3. `rawContext.resume()` called synchronously in the `onclick` handler of the start overlay. Safari refuses to resume on `pointerdown` or `touchstart` because those events do not grant user activation per the HTML spec.

Visit https://jagmarques.github.io/sonogarden/?debug=1 to see a small bottom-right diagnostic badge showing `Tone.getContext().state`, raw context state, sample rate, audio session type, sampler loaded, silent-keepalive active, note count, and time since last note.

## Visual field

`src/visual/Bloomfield.svelte` renders a single three.js scene:

- **Random convex polyhedra** at the focal point. Every morph builds a fresh shape from 7-14 points on a jittered sphere fed through `ConvexGeometry`. No two morphs repeat.
- **Break and reform** morph via a custom vertex shader. Each edge has its own per-vertex random direction and its own break window, so edges scatter one by one over about 9 seconds. One endpoint of each edge is anchored so the wireframe never fully disconnects.
- **Two wireframe orbit rings** around the centerpiece on tilted axes.
- **Six glowing satellites** orbiting on circular paths with pulsing opacity.
- **About 128 GPU orbs** (`THREE.Points` with a custom shader) spawn on every phrase note. Pitch drives Y, velocity drives size, chord hue rotates per pitch class. Sticky connecting lines (capped at 60, 2.5 second stickiness) fade individually when pairs drift apart.
- **Calm FBM-haze gradient** backdrop with a 120x120 twinkle-star layer. Palette lerps to the current mood accent.

Interactions:

- **Click**: chord burst + 10-orb radial shockwave + trigger next morph.
- **Drag**: orbit the whole scene 360 degrees (yaw + pitch).
- **Scroll / pinch**: camera zoom 6-26 units.

## Controls

- **Top left**: now-playing chord (e.g. "C major").
- **Top right**: the three mood pill buttons.
- **Bottom right**: session timer, play/pause, restart, mute.
- **Bottom left**: `copy link` button. Generates a `?s=base64(mood, melody)` URL you can share.
- **First open**: 3-slide intro overlay, dismissed forever after.

## Differentiators

Closest shipped neighbours: [ambient.garden](https://ambient.garden/) (3D landscape, algorithmic audio) and [generative.fm](https://play.generative.fm) (browser generative music, pay-what-you-want, no visuals).

Sonogarden's wedge:

- Mood-categorical UX (one-tap focus / meditate / sleep) instead of spatial exploration.
- Per-mood instrument selection (piano, cello, harmonium, harp) so each mood actually sounds different, not the same harp tinted by reverb.
- Share-a-moment URL that replays the exact chord state.
- Session timer + pause / restart for meditation sessions.
- Mobile-first bundle (845 KB gzipped, no p5, no magenta).
- Documented iOS hardware-silent-switch handling.
- Abstract geometric forms with break and reform, not a walkable landscape.

## Architecture

```
src/
  App.svelte              boot, mood pills, timer, copy-link UI, debug badge gate
  audio/
    ambient.js            phrase scheduler + sine pad + pink-noise bed + drone loop
    autoplay.js           start/stop/moodChange facade for App.svelte
    events.js             pub-sub for note events consumed by Bloomfield
    moods.js              3 mood presets (tonic, scale, reverb, delay, instrument set, palette)
    player.js             master Tone chain, triggerVoice, iOS audioSession + silent-WAV unlock
    voices.js             7 Tone.Sampler voices loaded from nbrosowsky CDN
  state/store.svelte.js   Svelte rune store: liveMelody, muted, savedMoments
  ui/
    DiagnosticBadge.svelte  500ms-ticking badge gated by ?debug=1
    MuteButton.svelte
    StartOverlay.svelte     gesture-unlock with onclick-only handler
  visual/Bloomfield.svelte  three.js scene
  main.js
index.html                inline boot-error overlay + iOS audioSession routing
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
