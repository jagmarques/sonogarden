// 4 Endel-style modes: focus, relax, sleep, activity.
// SOURCE Endel modes: https://endel.io (verified 2026-04-21).

export const MOODS = {
  focus: {
    label: 'focus',
    tonic: 60,
    scale: 'major',
    reverbDecay: 5.0,
    reverbWet: 0.45,
    accent: { r: 150, g: 210, b: 255 },
    bgTop: '#08101C',
    bgBot: '#04080E',
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
    accent: { r: 160, g: 230, b: 180 },
    bgTop: '#0A1512',
    bgBot: '#04080A',
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
    accent: { r: 170, g: 160, b: 220 },
    bgTop: '#0A0818',
    bgBot: '#020208',
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
    accent: { r: 255, g: 180, b: 120 },
    bgTop: '#1C1008',
    bgBot: '#0A0604',
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
