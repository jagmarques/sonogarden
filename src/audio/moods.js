// 3 modes: focus, meditate, sleep. Earth-tone palette per Biophilic design refs.

export const MOODS = {
  focus: {
    label: 'focus',
    tonic: 60,
    scale: 'major',
    reverbDecay: 2.2,
    reverbWet: 0.22,
    accent: { r: 130, g: 180, b: 230 },
    bgTop: '#3D4A58',
    bgBot: '#2A333E',
    delayTime: 0.18,
    delayFeedback: 0.15,
    delayWet: 0.08,
    padVolumeDb: -26,
    chimeMs: [4500, 8000],
    chordChangeMs: [28000, 44000],
    style: 0,
    phraseVoice: 'piano',
    shimmerVoice: 'harp',
    droneVoice: null,
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
    chimeMs: [7000, 12000],
    chordChangeMs: [38000, 58000],
    style: 1,
    phraseVoice: 'cello',
    shimmerVoice: 'harp',
    droneVoice: 'harmonium',
  },
  sleep: {
    label: 'sleep',
    tonic: 48,
    scale: 'minor',
    reverbDecay: 7.0,
    reverbWet: 0.35,
    accent: { r: 175, g: 155, b: 225 },
    bgTop: '#36333E',
    bgBot: '#24222C',
    delayTime: 1.05,
    delayFeedback: 0.45,
    delayWet: 0.2,
    padVolumeDb: -30,
    chimeMs: [10000, 18000],
    chordChangeMs: [50000, 80000],
    style: 2,
    phraseVoice: 'harp',
    shimmerVoice: null,
    droneVoice: null,
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
