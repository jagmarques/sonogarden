// Classical piano engine. Fires a beat-grid left-hand accompaniment under a slow melodic line.
// Aesthetic target: Erik Satie Gymnopedies (3/4 slow piano), Debussy Clair de Lune (impressionist
// 7th/9th chords), Gnossiennes (modal, free). No pad, no noise, no drone. Piano does everything.
// SOURCES: https://en.wikipedia.org/wiki/Gymnopedies, https://en.wikipedia.org/wiki/Clair_de_Lune.

import { triggerVoice } from './player.js';
import { getCurrentMood } from './moods.js';

// Interval voicings. Offsets from the chord root in semitones.
const VOICINGS = {
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  maj9: [0, 4, 11, 14],
  min9: [0, 3, 10, 14],
  sus2: [0, 2, 7, 14],
  sus4: [0, 5, 7, 14],
  add9: [0, 4, 7, 14],
};

// Classical progression per mood. Each chord is { root semitones from tonic, type }.
// Focus leans Satie Gymnopedies (open 7ths, major, 3/4). Meditate leans Debussy (min9, sus, 4/4).
// Sleep leans Gnossiennes (modal minor, long bars). Kept short so the ear learns them.
const PROGRESSIONS = {
  // Gymnopedie No. 1 (Satie): D major, 3/4, 72 BPM, alternates IV maj7 and I maj7.
  // SOURCES: en.wikipedia.org/wiki/Gymnopedies, songbpm.com/@erik-satie/gymnopedie-no-1.
  focus: {
    bpm: 70,
    beatsPerBar: 3,
    barsPerChord: 2,
    chords: [
      { root: 5, type: 'maj7' },
      { root: 0, type: 'maj7' },
    ],
    melodyEveryBars: 2,
  },
  // Clair de Lune (Debussy): Db major, 9/8 andante tres expressif, 62-73 BPM. We stay in 4/4
  // for engine simplicity but use major-mode 7/9 sonorities for the impressionist colour.
  // SOURCES: en.wikipedia.org/wiki/Suite_bergamasque, thomasstone1.wordpress.com.
  meditate: {
    bpm: 60,
    beatsPerBar: 4,
    barsPerChord: 2,
    chords: [
      { root: 0,  type: 'maj9' },
      { root: -2, type: 'maj7' },
      { root: -4, type: 'maj9' },
      { root: -5, type: 'maj7' },
    ],
    melodyEveryBars: 4,
  },
  // Gnossienne No. 1 (Satie): F minor free-time "Lent" (typically transcribed 4/4 at ~70 BPM).
  // We drop BPM to 54 for sleep use-case. Alternates i min7 and V min7 with bIII colour.
  // SOURCES: en.wikipedia.org/wiki/Gnossiennes, imslp.org/wiki/Gnossiennes_(Satie,_Erik).
  sleep: {
    bpm: 54,
    beatsPerBar: 4,
    barsPerChord: 2,
    chords: [
      { root: 0, type: 'min7' },
      { root: 7, type: 'min7' },
      { root: 0, type: 'min7' },
      { root: 3, type: 'maj7' },
    ],
    melodyEveryBars: 4,
  },
};

function progressionFor(mood) {
  return PROGRESSIONS[mood.label] || PROGRESSIONS.focus;
}

const MAJOR_PENT = [0, 2, 4, 7, 9];
const MINOR_PENT = [0, 3, 5, 7, 10];
const PHRASES = [
  [4, 2, 0],
  [0, 2, 4],
  [4, 3, 2, 0],
  [0, 2, 4, 3, 2],
  [2, 4, 2, 0],
  [3, 2, 0],
];

function pentFor(mood) {
  return mood.scale === 'minor' ? MINOR_PENT : MAJOR_PENT;
}

let _running = false;
let _beatTimer = null;
let _bar = 0;
let _beat = 0;
let _chordIdx = 0;
let _currentChord = null;
let _moodLabelAtBeat = null;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Public label for the now-playing UI.
export function getCurrentChordLabel() {
  const mood = getCurrentMood();
  if (!_currentChord) return '';
  const midi = mood.tonic + _currentChord.root;
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const tLabel = _currentChord.type.replace('maj', 'maj ').replace('min', 'min ').trim();
  return `${name} ${tLabel}`;
}

// Compatibility: setMood() in player.js still calls setPadVolume. Keep a harmless stub so
// changing moods does not throw.
export function setPadVolume() { /* piano engine has no sine pad */ }

function playBass(mood, prog, chord, when, vel) {
  const root = mood.tonic + chord.root - 24;
  triggerVoice('piano', root, vel, 2.8, when);
}

function playChord(mood, prog, chord, when, vel) {
  const voicing = VOICINGS[chord.type] || VOICINGS.maj7;
  const base = mood.tonic + chord.root - 12;
  for (const iv of voicing) {
    triggerVoice('piano', base + iv, vel, 1.8, when);
  }
}

// Melody line: a 3-5 note phrase over the current chord's pentatonic, starting on beat 1
// and spread across the next bar. Velocity arch keeps it lyrical.
function playMelody(mood) {
  const pent = pentFor(mood);
  const chord = _currentChord;
  if (!chord) return;
  const tmpl = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const n = tmpl.length;
  const beatMs = 60000 / progressionFor(mood).bpm;
  const stepMs = beatMs * 0.75;
  for (let i = 0; i < n; i++) {
    const idx = Math.max(0, Math.min(pent.length - 1, tmpl[i]));
    const pitch = mood.tonic + chord.root + pent[idx] + 12;
    const arch = Math.sin((i / Math.max(1, n - 1)) * Math.PI);
    const vel = 0.34 + arch * 0.22;
    const delay = i * stepMs + 20;
    setTimeout(() => {
      if (!_running) return;
      triggerVoice('piano', pitch, Math.max(0.18, Math.min(0.6, vel)), 2.2);
    }, delay);
  }
}

function advanceChord(mood) {
  const prog = progressionFor(mood);
  _chordIdx = (_chordIdx + 1) % prog.chords.length;
  _currentChord = prog.chords[_chordIdx];
}

function onBeat() {
  if (!_running) return;
  const mood = getCurrentMood();
  const prog = progressionFor(mood);
  if (!_currentChord || _moodLabelAtBeat !== mood.label) {
    _chordIdx = 0;
    _currentChord = prog.chords[0];
    _bar = 0;
    _beat = 0;
    _moodLabelAtBeat = mood.label;
  }
  const now = 0.02;
  if (_beat === 0) {
    playBass(mood, prog, _currentChord, now, 0.42);
    if (prog.beatsPerBar === 4) {
      playChord(mood, prog, _currentChord, now + 0.01, 0.22);
    }
  } else {
    playChord(mood, prog, _currentChord, now, 0.24);
  }
  const isBarStart = _beat === 0;
  const barsSinceChange = _bar % prog.barsPerChord;
  if (isBarStart && _bar > 0 && barsSinceChange === 0) {
    advanceChord(mood);
  }
  if (isBarStart && _bar > 0 && (_bar % prog.melodyEveryBars) === 0) {
    playMelody(mood);
  }
  _beat += 1;
  if (_beat >= prog.beatsPerBar) {
    _beat = 0;
    _bar += 1;
  }
  const beatMs = 60000 / prog.bpm;
  _beatTimer = setTimeout(onBeat, beatMs);
}

export function startAmbient() {
  if (_running) return;
  _running = true;
  _bar = 0;
  _beat = 0;
  _chordIdx = 0;
  _currentChord = null;
  _moodLabelAtBeat = null;
  onBeat();
}

export function stopAmbient() {
  _running = false;
  if (_beatTimer) { clearTimeout(_beatTimer); _beatTimer = null; }
}

export function onMoodChange() {
  if (!_running) return;
  // Next onBeat will detect label change and reset bar/beat/chord cleanly.
  _bar = 0;
  _beat = 0;
  _chordIdx = 0;
  _currentChord = null;
  _moodLabelAtBeat = null;
}
