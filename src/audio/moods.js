// Mood table. Every citation is WebFetch-verified from Wikipedia (2026-04-21).
// SOURCE BPM: https://en.wikipedia.org/wiki/Tempo (Adagio 44-66, Andante 56-108, Allegro 120-156)
// SOURCE Gymnopedies: https://en.wikipedia.org/wiki/Gymnop%C3%A9dies ("Lent et grave" A minor, 3/4)
// SOURCE Brain regions: https://en.wikipedia.org/wiki/Neuroscience_of_music
//   Blood & Zatorre 2001: pleasant music -> blood-flow changes in amygdala, orbitofrontal cortex,
//     ventral striatum, midbrain, ventral medial prefrontal cortex.
//   Schmidt & Trainor 2001: joyful music -> left frontal EEG; fearful/sad -> right frontal EEG.
//   Wikipedia: nucleus accumbens is involved in music emotion and rhythmic timing.
// NOTE: these are correlational fMRI/EEG findings, not prescriptive. We do not claim this app
// activates those regions; we cite what is associated in the literature with similar stimuli.
// NOTE: Meta/Facebook has not released a public stimulus-to-brain predictor as of 2026-04-21
// (verified via ai.meta.com/research/ and the brain-AI research blog post). The closest public
// tool is NeuroSynth (neurosynth.org), which performs fMRI meta-analysis from terms.

export const MOODS = {
  focus: {
    label: 'focus',
    bpm: 60,
    tonic: 60,
    scale: 'major',
    reverbDecay: 5.0,
    reverbWet: 0.45,
    accent: { r: 180, g: 220, b: 255 },
    bgTop: '#0B1422',
    bgBot: '#05080E',
    pitchMin: 55,
    pitchMax: 84,
    interval: 16,
    citation: '60 bpm Adagio (Wikipedia Tempo). Pleasant music correlates with ventral medial PFC blood-flow changes (Blood and Zatorre 2001, via Neuroscience of music).',
  },
  study: {
    label: 'study',
    bpm: 72,
    tonic: 60,
    scale: 'major',
    reverbDecay: 4.0,
    reverbWet: 0.4,
    accent: { r: 200, g: 180, b: 255 },
    bgTop: '#1A1B2E',
    bgBot: '#0A0B14',
    pitchMin: 53,
    pitchMax: 86,
    interval: 14,
    citation: '72 bpm Andante (Wikipedia Tempo). Joyful music correlates with left frontal EEG activity (Schmidt and Trainor 2001, via Neuroscience of music).',
  },
  meditate: {
    label: 'meditate',
    bpm: 55,
    tonic: 57,
    scale: 'minor',
    reverbDecay: 8.0,
    reverbWet: 0.5,
    accent: { r: 120, g: 220, b: 200 },
    bgTop: '#0D1A18',
    bgBot: '#04090A',
    pitchMin: 48,
    pitchMax: 78,
    interval: 18,
    citation: 'A minor, slow Adagio (matches Satie Gymnopedie III "Lent et grave" per Wikipedia). Pleasant music correlates with amygdala and orbitofrontal cortex blood-flow changes (Blood and Zatorre 2001).',
  },
  sleep: {
    label: 'sleep',
    bpm: 50,
    tonic: 57,
    scale: 'minor',
    reverbDecay: 10.0,
    reverbWet: 0.55,
    accent: { r: 160, g: 160, b: 220 },
    bgTop: '#090A18',
    bgBot: '#02020A',
    pitchMin: 43,
    pitchMax: 74,
    interval: 20,
    citation: '50 bpm slow Adagio (convention only, no strong BPM-for-sleep study). Slow pleasant music correlates with reduced arousal markers per the music-emotion literature (Wikipedia Neuroscience of music).',
  },
  run: {
    label: 'run',
    bpm: 120,
    tonic: 60,
    scale: 'major',
    reverbDecay: 2.0,
    reverbWet: 0.15,
    accent: { r: 255, g: 150, b: 100 },
    bgTop: '#2A1010',
    bgBot: '#0A0404',
    pitchMin: 55,
    pitchMax: 88,
    interval: 10,
    citation: '120 bpm Allegro (Wikipedia Tempo). Rhythmic timing engages the nucleus accumbens (Wikipedia Neuroscience of music).',
  },
};

export const DEFAULT_MOOD = 'focus';

let _current = MOODS[DEFAULT_MOOD];

export function setCurrentMood(name) {
  if (MOODS[name]) _current = MOODS[name];
}

export function getCurrentMood() {
  return _current;
}

export function listMoodKeys() {
  return Object.keys(MOODS);
}

// Time-of-day mood pick for first open. Conservative: energetic 'run' only if user ignored alarm.
export function moodByHour(hour) {
  if (hour >= 22 || hour < 5) return 'sleep';
  if (hour >= 5 && hour < 8) return 'meditate';
  if (hour >= 8 && hour < 12) return 'focus';
  if (hour >= 12 && hour < 18) return 'study';
  return 'meditate';
}
