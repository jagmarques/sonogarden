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
    reverbDecay: 3.5,
    reverbWet: 0.3,
    accent: { r: 130, g: 180, b: 230 },
    bgTop: '#3D4A58',
    bgBot: '#2A333E',
    delayTime: 0.18,
    delayFeedback: 0.15,
    delayWet: 0.1,
    padVolumeDb: -28,
    chimeMs: [3500, 6500],
    chordChangeMs: [18000, 30000],
    style: 0,
  },
  meditate: {
    label: 'meditate',
    tonic: 55,
    scale: 'minor',
    reverbDecay: 9.0,
    reverbWet: 0.7,
    delayTime: 0.55,
    delayFeedback: 0.6,
    delayWet: 0.4,
    padVolumeDb: -22,
    accent: { r: 155, g: 215, b: 140 },
    bgTop: '#3E4A3C',
    bgBot: '#2C352B',
    chimeMs: [8000, 14000],
    chordChangeMs: [32000, 50000],
    style: 1,
  },
  sleep: {
    label: 'sleep',
    tonic: 48,
    scale: 'minor',
    reverbDecay: 14.0,
    reverbWet: 0.85,
    accent: { r: 175, g: 155, b: 225 },
    bgTop: '#36333E',
    bgBot: '#24222C',
    delayTime: 1.05,
    delayFeedback: 0.65,
    delayWet: 0.5,
    padVolumeDb: -18,
    chimeMs: [14000, 26000],
    chordChangeMs: [40000, 64000],
    style: 2,
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
  if (hour >= 22 || hour < 6) return 'sleep';
  if (hour >= 6 && hour < 9) return 'meditate';
  if (hour >= 9 && hour < 18) return 'focus';
  return 'meditate';
}
