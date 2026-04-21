// 4 Endel-style modes: focus, relax, sleep, activity.
// SOURCE Endel modes: https://endel.io (verified 2026-04-21).

export const MOODS = {
  focus: {
    label: 'focus',
    tonic: 60,
    scale: 'major',
    reverbDecay: 5.0,
    reverbWet: 0.45,
    accent: { r: 170, g: 205, b: 225 },
    bgTop: '#1C2633',
    bgBot: '#141C25',
    chimeMs: [2200, 4200],
    chordChangeMs: [22000, 38000],
    style: 0,
  },
  relax: {
    label: 'relax',
    tonic: 62,
    scale: 'major',
    reverbDecay: 7.0,
    reverbWet: 0.55,
    accent: { r: 195, g: 215, b: 185 },
    bgTop: '#1F2A23',
    bgBot: '#17201B',
    chimeMs: [2500, 5000],
    chordChangeMs: [26000, 42000],
    style: 1,
  },
  sleep: {
    label: 'sleep',
    tonic: 57,
    scale: 'minor',
    reverbDecay: 11.0,
    reverbWet: 0.6,
    accent: { r: 200, g: 190, b: 220 },
    bgTop: '#20202E',
    bgBot: '#171724',
    chimeMs: [3500, 6500],
    chordChangeMs: [32000, 50000],
    style: 2,
  },
  activity: {
    label: 'activity',
    tonic: 62,
    scale: 'major',
    reverbDecay: 3.0,
    reverbWet: 0.25,
    accent: { r: 225, g: 205, b: 180 },
    bgTop: '#2B241D',
    bgBot: '#1E1914',
    chimeMs: [1500, 3500],
    chordChangeMs: [18000, 30000],
    style: 3,
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

export function moodByHour(hour) {
  if (hour >= 22 || hour < 5) return 'sleep';
  if (hour >= 5 && hour < 8) return 'relax';
  if (hour >= 8 && hour < 12) return 'focus';
  if (hour >= 12 && hour < 18) return 'focus';
  if (hour >= 18 && hour < 22) return 'relax';
  return 'relax';
}
