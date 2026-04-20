// Mood table. Every citation is WebFetch-verified from Wikipedia (2026-04-21).
// SOURCE BPM ranges: https://en.wikipedia.org/wiki/Tempo
//   Adagio 44-66 bpm, Andante 56-108 bpm, Allegro 120-156 bpm.
// SOURCE Gymnopedies mood + key: https://en.wikipedia.org/wiki/Gymnop%C3%A9dies
//   "Lent et grave" A minor (slow and grave), 3/4 time, atmospheric.

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
    citation: '60 bpm sits inside Adagio (44-66) per Wikipedia Tempo. Adagio is "slow with great expression".',
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
    citation: '72 bpm is Andante (walking pace, 56-108 per Wikipedia Tempo).',
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
    citation: 'A minor, slow Adagio. Matches Satie Gymnopedie III "Lent et grave" (A minor, 3/4) per Wikipedia.',
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
    citation: '50 bpm is at the slow end of Adagio per Wikipedia Tempo. No strong BPM-for-sleep study, convention only.',
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
    citation: '120 bpm is Allegro (120-156 per Wikipedia Tempo), the classical "fast and bright" range.',
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
