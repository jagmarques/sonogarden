# sonogarden

Free ambient focus app. Open URL, hear an AI-composed classical melody over a drone, see the visual garden. No signup, no API keys, no prompts.

Live: https://jagmarques.github.io/sonogarden/

## How it works

Every `interval` seconds sonogarden asks Google's MusicVAE (`mel_4bar_small_q2`) for a fresh 4-bar melody, transposes it to the current mood's tonic, and plays it on a piano sampler over a sustained tonic+fifth drone. Pick a mood (focus, study, meditate, sleep, run) to change tempo, tonic, and reverb. The melody is genuinely model-generated, not rule-based.

Hear something you like? Press "save this moment", give it a title, and the mood plus live melody are stored locally. Click a title to reload it. Press "share" to copy a URL that carries mood and seed to another device.

## Quick start

1. Open the page.
2. Click anywhere to unlock audio.
3. Pick a mood from the dropdown.
4. Save or share whenever a phrase lands right.

No account. Nothing leaves your browser. All state is local.

## Architecture

- `src/App.svelte` boot, mood dropdown, save/share UI, garden mount.
- `src/ai/magenta.js` MusicVAE model load plus `sampleMelody` and transpose helpers.
- `src/audio/autoplay.js` mood-interval ticker that samples a melody and pipes it to the player.
- `src/audio/player.js` master Tone chain, piano triggering, tonic+fifth drone.
- `src/audio/voices.js` piano sampler voice.
- `src/audio/moods.js` mood presets (label, bpm, tonic, scale, reverb, visual colours, pitch range, interval).
- `src/visual/Garden.svelte` p5 canvas.
- `src/state/store.svelte.js` Svelte rune store for live melody, saved moments, mute.
- `src/persistence/db.js` IndexedDB (not currently used by the rebuild; available for future persistence).

## Build

```
npm install
npm run dev     # start local dev server
npm run build   # production build into dist/
```

## License

MIT. See LICENSE.
