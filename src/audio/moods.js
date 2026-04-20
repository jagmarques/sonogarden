// Activity-adaptive mood presets. Harp only. Each mood defines audio + visual.
// See .company/research/cycle32-refs.md for citations behind each parameter.

// Scale intervals (semitones from tonic) used by the composer for each mood.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];

// Chord progressions as scale-degree roots (0 = tonic, 3 = IV, 4 = V, 5 = vi).
// Voicing is built by the composer; here we only name the root motion.
const PROG_FOCUS    = [0, 3, 0, 4];       // I - IV - I - V
const PROG_STUDY    = [0, 5, 3, 4];       // I - vi - IV - V
const PROG_MEDITATE = [0, 0, 0, 0];       // tonic pedal; tintinnabuli on top
const PROG_SLEEP    = [0, 3, 0];          // i - iv - i Aeolian
const PROG_RUN      = [0, 4, 5, 3];       // I - V - vi - IV

// Cadence weights (plagal, authentic, half, deceptive) sum to 1.0 per mood.
// Plagal = IV->I, authentic = V->I, half ends on V, deceptive V->vi.
const CAD_FOCUS    = { plagal: 0.45, authentic: 0.20, half: 0.25, deceptive: 0.10 };
const CAD_STUDY    = { plagal: 0.25, authentic: 0.35, half: 0.25, deceptive: 0.15 };
const CAD_MEDITATE = { plagal: 0.75, authentic: 0.00, half: 0.20, deceptive: 0.05 };
const CAD_SLEEP    = { plagal: 0.80, authentic: 0.00, half: 0.15, deceptive: 0.05 };
const CAD_RUN      = { plagal: 0.15, authentic: 0.45, half: 0.15, deceptive: 0.25 };

// Contour weights (rising, falling, arch, invArch, static) sum to 1.0.
const CONT_FOCUS    = { rising: 0.15, falling: 0.20, arch: 0.35, invArch: 0.15, static: 0.15 };
const CONT_STUDY    = { rising: 0.25, falling: 0.20, arch: 0.30, invArch: 0.15, static: 0.10 };
const CONT_MEDITATE = { rising: 0.10, falling: 0.20, arch: 0.15, invArch: 0.10, static: 0.45 };
const CONT_SLEEP    = { rising: 0.05, falling: 0.50, arch: 0.10, invArch: 0.05, static: 0.30 };
const CONT_RUN      = { rising: 0.30, falling: 0.15, arch: 0.25, invArch: 0.20, static: 0.10 };

// Phrase-length weights in seconds. Total 1.0 per mood.
const LEN_FOCUS    = { 6: 0.15, 9: 0.45, 12: 0.30, 18: 0.10 };
const LEN_STUDY    = { 6: 0.25, 9: 0.45, 12: 0.20, 18: 0.10 };
const LEN_MEDITATE = { 6: 0.05, 9: 0.20, 12: 0.40, 18: 0.35 };
const LEN_SLEEP    = { 6: 0.05, 9: 0.15, 12: 0.35, 18: 0.45 };
const LEN_RUN      = { 6: 0.55, 9: 0.35, 12: 0.10, 18: 0.00 };

// Bass modes: pedal (root long), rootFifth, rootOctave, walking (4 steps).
const BASS_FOCUS    = ['rootFifth', 'pedal', 'rootOctave'];
const BASS_STUDY    = ['rootFifth', 'walking', 'rootOctave'];
const BASS_MEDITATE = ['pedal', 'rootFifth'];
const BASS_SLEEP    = ['pedal', 'rootOctave'];
const BASS_RUN      = ['walking', 'rootFifth', 'rootOctave'];

export const MOODS = {
  focus:    {
    label: 'focus', symbol: '◎', bpm: 60, interval: '10s', bloomCount: 2,
    pitchMin: 55, pitchMax: 84, pitchShiftCap: 3, velBase: 42,
    reverbDecay: 5.0, reverbWet: 0.45,
    bgTop: '#0B1422', bgBot: '#05080E', accent: { r: 180, g: 220, b: 255 },
    scale: MAJOR, progression: PROG_FOCUS,
    cadenceWeights: CAD_FOCUS, contourWeights: CONT_FOCUS,
    phraseLenWeights: LEN_FOCUS, bassModes: BASS_FOCUS,
    restEveryMin: 7, restEveryMax: 12, ornamentRate: 0.35,
    style: 'tonal',
    evidence: 'Mindlab/Cooper 60 bpm convention; plagal emphasis from hymnody',
  },
  study:    {
    label: 'study', symbol: '✦', bpm: 70, interval: '9s', bloomCount: 3,
    pitchMin: 53, pitchMax: 86, pitchShiftCap: 3, velBase: 44,
    reverbDecay: 4.0, reverbWet: 0.4,
    bgTop: '#1A1B2E', bgBot: '#0A0B14', accent: { r: 200, g: 180, b: 255 },
    scale: MIXOLYDIAN, progression: PROG_STUDY,
    cadenceWeights: CAD_STUDY, contourWeights: CONT_STUDY,
    phraseLenWeights: LEN_STUDY, bassModes: BASS_STUDY,
    restEveryMin: 8, restEveryMax: 12, ornamentRate: 0.40,
    style: 'tonal',
    evidence: 'Salimpoor 2011 anticipation-release; Thoma 2013 recovery',
  },
  meditate: {
    label: 'meditate', symbol: '☯', bpm: 55, interval: '12s', bloomCount: 1,
    pitchMin: 48, pitchMax: 78, pitchShiftCap: 2, velBase: 36,
    reverbDecay: 8.0, reverbWet: 0.6,
    bgTop: '#0D1A18', bgBot: '#04090A', accent: { r: 120, g: 220, b: 200 },
    scale: DORIAN, progression: PROG_MEDITATE,
    cadenceWeights: CAD_MEDITATE, contourWeights: CONT_MEDITATE,
    phraseLenWeights: LEN_MEDITATE, bassModes: BASS_MEDITATE,
    restEveryMin: 6, restEveryMax: 9, ornamentRate: 0.15,
    style: 'tintinnabuli',
    evidence: 'Part tintinnabuli (Wikipedia); planing (Debussy)',
  },
  sleep:    {
    label: 'sleep', symbol: '☾', bpm: 50, interval: '14s', bloomCount: 1,
    pitchMin: 43, pitchMax: 74, pitchShiftCap: 2, velBase: 32,
    reverbDecay: 10.0, reverbWet: 0.65,
    bgTop: '#090A18', bgBot: '#02020A', accent: { r: 160, g: 160, b: 220 },
    scale: AEOLIAN, progression: PROG_SLEEP,
    cadenceWeights: CAD_SLEEP, contourWeights: CONT_SLEEP,
    phraseLenWeights: LEN_SLEEP, bassModes: BASS_SLEEP,
    restEveryMin: 5, restEveryMax: 8, ornamentRate: 0.10,
    style: 'tonal',
    evidence: 'Thoma 2013 recovery; plagal-only to avoid strong cadential pull',
  },
  run:      {
    label: 'run', symbol: '➤', bpm: 120, interval: '4s', bloomCount: 5,
    pitchMin: 55, pitchMax: 88, pitchShiftCap: 4, velBase: 56,
    reverbDecay: 2.0, reverbWet: 0.15,
    bgTop: '#2A1010', bgBot: '#0A0404', accent: { r: 255, g: 150, b: 100 },
    scale: MAJOR, progression: PROG_RUN,
    cadenceWeights: CAD_RUN, contourWeights: CONT_RUN,
    phraseLenWeights: LEN_RUN, bassModes: BASS_RUN,
    restEveryMin: 10, restEveryMax: 16, ornamentRate: 0.20,
    style: 'tonal',
    evidence: '120 bpm cadence convention; Salimpoor anticipation-release',
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

export const __scales = Object.freeze({ MAJOR, AEOLIAN, DORIAN, MIXOLYDIAN });
