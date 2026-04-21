// 4 Endel-style modes: focus, relax, sleep, activity.
// SOURCE Endel modes: https://endel.io (verified 2026-04-21).
//
// Palette grounded in TWO verified Wikipedia sources:
//  - Biophilic_design: "Natural colors or 'earth-tones' ... subdued tones of brown, green, and
//    blue." "Brighter colors should only be used sparingly."
//  - Earth_tone: lists #555142 forest floor, #4b6d41 artichoke, #836539 dirt brown,
//    #0e695f evergreen forest as representative earth tones. Described as "warm and muted ...
//    calming hues".
//
// Gradient lightness is lifted to HSL L=22-30% (was 5-16%) so the background reads as
// "a dim lounge" rather than a void, per user feedback 2026-04-21. Saturation kept 10-20% so no
// hue feels branded or energetic (per Biophilic "bright colors used sparingly").

export const MOODS = {
  focus: {
    label: 'focus',
    tonic: 60,
    scale: 'major',
    reverbDecay: 5.0,
    reverbWet: 0.45,
    accent: { r: 185, g: 200, b: 215 },
    bgTop: '#3D4A58',
    bgBot: '#2A333E',
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
    accent: { r: 185, g: 200, b: 175 },
    bgTop: '#3E4A3C',
    bgBot: '#2C352B',
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
    accent: { r: 190, g: 185, b: 205 },
    bgTop: '#36333E',
    bgBot: '#24222C',
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
    accent: { r: 220, g: 195, b: 160 },
    bgTop: '#4A3F33',
    bgBot: '#342C24',
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
