# sonogarden

Free, browser-only ambient music app. Three moods, each with its own per-mood instrument set, played over a soft sine-pad bed and pink-noise floor while a live 3D field of glowing orbs and breaking polyhedra reacts to every note.

Live: https://jagmarques.github.io/sonogarden/

## Three moods

- **Focus**: C major, piano phrases over a quiet sine pad with rare harp shimmer. Short reverb tail, frequent phrases.
- **Meditate**: G minor, cello phrases over a harmonium drone with rare harp shimmer. Long reverb, slower chord drift.
- **Sleep**: C minor, soft harp phrases over a near-inaudible sine pad and pink-noise bed. Very sparse, longest gaps.

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
| sleep | harp | none | none |

Phrase shapes are 12 pre-written pentatonic templates with returns and suspensions, not random walks. Velocity follows an arch (soft, louder, soft) so each phrase reads as a musical figure rather than a chime.

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
- **First open**: 3-slide intro overlay, dismissed forever after.

## License

[MIT](LICENSE)
