# sonogarden

Live: https://jagmarques.github.io/sonogarden/

A browser music garden. Pick a mood, the garden composes real classical-style piano in real time. Modifier worms drift around the main one; absorb one to bend pitch, soften tone, or add a progression.

Free. Open source. Runs in the browser. No account. No server.

## What it does

- 5 moods: focus, study, meditate, sleep, run. Each has its own tempo, scale, progression, left-hand accompaniment pattern, and cadence style.
- Rule-based composer. Every phrase is generated live from classical composition rules: stepwise voice-leading, chord-tone anchoring on strong beats, slow harmonic rhythm, one motif per piece.
- Motifs are transformed across phrases (transposition, inversion, suspension, turn, Chopin-style sigh, Satie open-fifth, Schenkerian descent).
- The "DNA" panel on the main seed shows the live currently-playing melody notes, updated each phrase.
- Modifier seeds drift and collide. On contact, their effect (pitch shift, tone softness, progression) is absorbed into the main composer.

## Mood style summary

| mood | bpm | meter | scale | progression | lh | bars per chord |
|------|-----|-------|-------|-------------|----|----|
| focus | 60 | 4/4 | major | I-IV-I-V | arpeggio or broken | 1 |
| study | 70 | 4/4 | mixolydian | I-vi-IV-V | alberti or arpeggio | 1 |
| meditate | 55 | 3/4 | dorian | IV-I (tintinnabuli) | block or waltz | 2 |
| sleep | 50 | 4/4 | aeolian | i-iv-i | block or arpeggio | 2 |
| run | 120 | 4/4 | major | I-V-vi-IV | alberti or broken octave | 1 |

All parameters are grounded in cited sources (Gymnopedies, Fur Alina, voice-leading rules, Counterpoint, Schenkerian analysis, GTTM). See `src/audio/composer.js` header for citations.

## Stack

- Svelte 5 + Vite - UI, runes reactivity
- Tone.js 15 - audio playback, Transport, sampler
- p5.js 2 - 2D organic garden rendering
- IndexedDB (via idb) - local persistence of seeds and absorbed modifiers
- MusicVAE (Magenta.js) - kept for latent-space encoding on seed creation
- GitHub Pages - hosting

No server. No account. Google Fonts (Fraunces, Inter) are the only external runtime dependency.

## Run locally

```
npm install
npm run dev
```

## Build

```
npm run build
```

Output in `dist/`. The GitHub Actions workflow at `.github/workflows/deploy.yml` deploys every push to `main`.

## Architecture

```
src/
  audio/
    composer.js      rule-based phrase composer (motif + LH pattern per piece)
    improvise.js     thin wrapper delegating to composer
    moods.js         mood presets (tempo, scale, progression, cadence, etc.)
    voices.js        Tone.js sampler wiring
    player.js        master chain (limiter, reverb, compressor)
    autoplay.js      Tone.Loop driving generatePhrase per tick
    infusion.js      absorbed-modifier effects accumulator
  state/
    store.svelte.js  garden state (seeds, playingIds, liveMelody, muted)
  ui/
    TendCard.svelte  seed DNA + actions (play, prune, gift)
  visual/
    Garden.svelte    p5.js render + pointer drag + collision + absorb flash
  persistence/
    db.js            IndexedDB via idb
```

## License

MIT. See LICENSE.
