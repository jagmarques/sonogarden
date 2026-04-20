// Generative classical piano composer for sonogarden Cycle 33.
// Two or three voice texture only: low bass root + LH chord pattern + RH melody.
// RH stays above the LH top note; voice-leading is stepwise-dominant; after a
// leap the line steps back; no parallel fifths or octaves between outer voices.
// One piece = one motif template + one LH pattern, reused across all phrases.
//
// Primary sources (fetched and verified in .company/research/cycle33-refs.md):
//   Gymnopedies 3/4 meter, IV-I alternation, mild dissonance:
//     https://en.wikipedia.org/wiki/Gymnop%C3%A9dies
//   Fur Alina tintinnabuli, two-voice texture, triad under melody:
//     https://en.wikipedia.org/wiki/F%C3%BCr_Alina
//   Einaudi minimalist arpeggios and four-note cells:
//     https://en.wikipedia.org/wiki/Ludovico_Einaudi
//   Voice leading stepwise motion, parallel 5th/8ve ban, leap then step:
//     https://en.wikipedia.org/wiki/Voice_leading
//   Counterpoint species (Fux): step after leap, no outlined 7th, start/end tonic:
//     https://en.wikipedia.org/wiki/Counterpoint
//   Cadence taxonomy (authentic, plagal, half, deceptive):
//     https://en.wikipedia.org/wiki/Cadence
//   Schenkerian background descent 3-2-1 / 5-4-3-2-1:
//     https://en.wikipedia.org/wiki/Schenkerian_analysis
//   GTTM grouping, metre, tension/release hierarchy:
//     https://en.wikipedia.org/wiki/Generative_theory_of_tonal_music

import { getCurrentMood } from './moods.js';
import { currentEffects } from './infusion.js';

// Middle C as default tonic anchor.
const TONIC_MIDI = 60;
// Maximum permitted melodic leap in semitones. SOURCE: https://en.wikipedia.org/wiki/Counterpoint
const MAX_LEAP = 7;
// Piece-level key rotation: tonic, subdominant, relative lower, dominant.
// Gentle large-scale motion across pieces (prolongation).
// SOURCE: https://en.wikipedia.org/wiki/Schenkerian_analysis
const PIECE_KEY_STEPS = [0, 5, -3, 7];

// Piece-scope composer state: one continuous piece across successive phrases.
let _phraseIdx = 0;
let _pieceKeyIdx = 0;
let _phrasesInPiece = 0;
let _pieceLength = 0;
let _piece = null;
let _nextRestAt = null;
let _lastRHPitch = null;
let _lastLHTop = null;

// Live-notes publishing: last phrase's RH melody as MIDI pitches and a monotonic
// version counter so UIs can subscribe without diffing the note array.
let _liveMelody = [];
let _liveMelodyVersion = 0;

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function weightedPick(map, rng) {
  const entries = Object.entries(map);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Fold a pitch into the [lo, hi] register by octave displacement.
function clampOctave(p, lo, hi) {
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return p;
}

// Pick the octave transposition of target that is closest to prev and inside
// [lo, hi]. Used to enforce stepwise voice-leading on every RH note.
// SOURCE: https://en.wikipedia.org/wiki/Voice_leading (law of the shortest way)
function closestOctave(target, prev, lo, hi) {
  let best = clampOctave(target, lo, hi);
  let bestDist = Math.abs(best - prev);
  for (let o = -3; o <= 3; o++) {
    const p = target + o * 12;
    if (p < lo || p > hi) continue;
    if (Math.abs(p - prev) < bestDist) { best = p; bestDist = Math.abs(p - prev); }
  }
  return best;
}

// Absolute MIDI pitch for a diatonic scale degree counted from tonic.
function degreePitch(tonic, scale, degree) {
  const len = scale.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return tonic + scale[idx] + oct * 12;
}

// Build a triad (root, third, fifth) above a given scale-degree root.
function triadAt(tonic, scale, rootDeg) {
  return [
    degreePitch(tonic, scale, rootDeg),
    degreePitch(tonic, scale, rootDeg + 2),
    degreePitch(tonic, scale, rootDeg + 4),
  ];
}

// Cosine swell: natural crescendo-decrescendo across a phrase. Keeps dynamics
// human rather than flat. SOURCE: https://en.wikipedia.org/wiki/Generative_theory_of_tonal_music (tension/release)
function swell(x, base) {
  const shape = 0.75 + 0.4 * Math.sin(Math.PI * x);
  return clamp(Math.round(base * shape), 20, 110);
}

// Per-mood style: LH patterns, meter, harmonic rhythm (bars per chord), piece length.
// Harmonic rhythm: meditate + sleep = 1 chord per 2 bars (calm);
// focus + study + run = 1 chord per bar (active).
// SOURCE: https://en.wikipedia.org/wiki/Ludovico_Einaudi (slow harmonic rhythm)
// SOURCE: https://en.wikipedia.org/wiki/Gymnop%C3%A9dies (slow IV-I alternation)
const STYLE = {
  focus:    { lhPatterns: ['arpeggio', 'broken'],      meter: 4, barsPerChord: 1, pieceLen: [6, 10] },
  study:    { lhPatterns: ['alberti', 'arpeggio'],     meter: 4, barsPerChord: 1, pieceLen: [6, 10] },
  meditate: { lhPatterns: ['block', 'waltzBlock'],     meter: 3, barsPerChord: 2, pieceLen: [6, 10] },
  sleep:    { lhPatterns: ['block', 'arpeggio'],       meter: 4, barsPerChord: 2, pieceLen: [8, 14] },
  run:      { lhPatterns: ['alberti', 'brokenOctave'], meter: 4, barsPerChord: 1, pieceLen: [4, 8] },
};
function styleFor(mood) { return STYLE[mood.label] || STYLE.focus; }

// Chord-relative scale-degree motif cells.
// 0 = chord root, 2 = third, 4 = fifth, 1/3 = passing, -1 = lower neighbour.
// Each template has both cells and rhythm arrays. The rhythm sums to the mood's
// meter (4 for 4/4, 3 for 3/4), which is applied via a scaling factor at render.
// SOURCE: https://en.wikipedia.org/wiki/Ludovico_Einaudi (four-note melodic cells)
// SOURCE: https://en.wikipedia.org/wiki/Schenkerian_analysis (structural tones + passing notes)
const MOTIFS = [
  // Upward arpeggio across the triad then settle on the third.
  { name: 'chord-up',       cells: [0, 2, 4, 2],      rhythm: [1, 1, 1, 1] },
  // Stepwise ascent using passing tone 1 and 3, landing on the fifth.
  { name: 'scalar-asc',     cells: [0, 1, 2, 4],      rhythm: [0.5, 0.5, 1, 2] },
  // Downward arpeggio from the fifth to the root.
  { name: 'chord-down',     cells: [4, 2, 0, -1],     rhythm: [1, 1, 1, 1] },
  // Arch: up to the peak then fall stepwise back to root.
  { name: 'arch',           cells: [0, 2, 4, 2, 0],   rhythm: [0.5, 0.5, 1, 1, 1] },
  // Chopin-style sigh: long appoggiatura 4 resolves down by step to 2, then 0.
  // SOURCE: https://en.wikipedia.org/wiki/Voice_leading (stepwise descent from tendency tone)
  { name: 'chopin-sigh',    cells: [4, 3, 2, 0],      rhythm: [2, 0.5, 0.5, 1] },
  // Satie fifth: root, fifth, third, root. Mirrors Gymnopedie IV-I outline.
  // SOURCE: https://en.wikipedia.org/wiki/Gymnop%C3%A9dies
  { name: 'satie-5th',      cells: [0, 4, 2, 0],      rhythm: [1, 1, 1, 1] },
  // Leap up then return by step: enforces the Fux rule (leap then step back).
  // SOURCE: https://en.wikipedia.org/wiki/Counterpoint
  { name: 'leap-return',    cells: [0, 4, 3, 2],      rhythm: [1, 1, 1, 1] },
  // Suspension: 4 held over, resolves down to 3 and 2, then 0.
  // SOURCE: https://en.wikipedia.org/wiki/Counterpoint (suspension species)
  { name: 'suspension',     cells: [4, 3, 2, 0],      rhythm: [1.5, 0.5, 1, 1] },
  // Classical turn: neighbour figure around the third, ending on the root.
  { name: 'turn',           cells: [2, 3, 2, 1, 0],   rhythm: [0.5, 0.5, 0.5, 0.5, 2] },
  // Descending-4th line: 5-4-3-2-1 urlinie miniature in one bar.
  // SOURCE: https://en.wikipedia.org/wiki/Schenkerian_analysis (Urlinie descent)
  { name: 'descending-4th', cells: [4, 3, 2, 1, 0],   rhythm: [0.5, 0.5, 0.5, 0.5, 2] },
];

// Left-hand patterns. Each fills one chord-span with a chord-tone pattern.
// SOURCE: https://en.wikipedia.org/wiki/Ludovico_Einaudi (broken-chord arpeggios)

// Simple arpeggio: root, third, fifth, third.
function lhArpeggio(chord, startT, dur, vel) {
  const notes = [chord[0], chord[1], chord[2], chord[1]];
  const step = dur / notes.length;
  return notes.map((p, i) => ({
    pitch: p, velocity: vel,
    startTime: startT + i * step, endTime: startT + (i + 1) * step - 0.03,
  }));
}

// Broken chord: root, fifth, third, fifth. More open sound than alberti.
function lhBroken(chord, startT, dur, vel) {
  const notes = [chord[0], chord[2], chord[1], chord[2]];
  const step = dur / notes.length;
  return notes.map((p, i) => ({
    pitch: p, velocity: vel,
    startTime: startT + i * step, endTime: startT + (i + 1) * step - 0.03,
  }));
}

// Alberti bass: root, fifth, third, fifth repeated. Classical-era accompaniment.
function lhAlberti(chord, startT, dur, vel) {
  const notes = [chord[0], chord[2], chord[1], chord[2], chord[0], chord[2], chord[1], chord[2]];
  const step = dur / notes.length;
  return notes.map((p, i) => ({
    pitch: p, velocity: vel,
    startTime: startT + i * step, endTime: startT + (i + 1) * step - 0.02,
  }));
}

// Block chord: all triad tones struck together and sustained (Gymnopedie LH).
// SOURCE: https://en.wikipedia.org/wiki/Gymnop%C3%A9dies (sustained LH support)
function lhBlock(chord, startT, dur, vel) {
  return chord.map((p, i) => ({
    pitch: p, velocity: Math.max(18, vel - i * 2),
    startTime: startT + i * 0.02, endTime: startT + dur - 0.2,
  }));
}

// Waltz block: bass on beat 1, upper-triad block on beats 2-3 (3/4 accompaniment).
// SOURCE: https://en.wikipedia.org/wiki/Gymnop%C3%A9dies (3/4 meter)
function lhWaltzBlock(chord, startT, dur, vel) {
  const beat = dur / 3;
  return [
    { pitch: chord[0], velocity: vel, startTime: startT, endTime: startT + beat - 0.06 },
    ...chord.slice(1).map((p, i) => ({
      pitch: p, velocity: Math.max(18, vel - 4),
      startTime: startT + beat + i * 0.02, endTime: startT + 3 * beat - 0.1,
    })),
  ];
}

// Broken octave: root doubled an octave apart, alternating low-high. Drives running tempo.
function lhBrokenOctave(chord, startT, dur, vel) {
  const seq = [chord[0], chord[0] + 12, chord[0], chord[0] + 12];
  const step = dur / seq.length;
  return seq.map((p, i) => ({
    pitch: p, velocity: vel,
    startTime: startT + i * step, endTime: startT + (i + 1) * step - 0.02,
  }));
}

const LH = {
  arpeggio: lhArpeggio, broken: lhBroken, alberti: lhAlberti,
  block: lhBlock, waltzBlock: lhWaltzBlock, brokenOctave: lhBrokenOctave,
};

// Voice a triad inside [lhLo, lhHi] keeping voices close together.
// SOURCE: https://en.wikipedia.org/wiki/Voice_leading (move each voice the shortest distance)
function voiceChord(tonic, scale, chordRootDeg, lhLo, lhHi) {
  const triad = triadAt(tonic, scale, chordRootDeg);
  const root = clampOctave(triad[0], lhLo, lhHi);
  const third = closestOctave(triad[1], root, lhLo, lhHi);
  const fifth = closestOctave(triad[2], root, lhLo, lhHi);
  return [root, third, fifth].sort((a, b) => a - b);
}

// Is `deg` a chord tone (root / 3rd / 5th) of the given chord?
function isChordTone(absDeg, chordRootDeg, scaleLen) {
  const rel = ((absDeg - chordRootDeg) % scaleLen + scaleLen) % scaleLen;
  return rel === 0 || rel === 2 || rel === 4;
}

// Snap a non-chord-tone scale degree to the nearest chord tone (root/3rd/5th).
// Used on strong beats so the skeleton outlines the harmony.
// SOURCE: https://en.wikipedia.org/wiki/Schenkerian_analysis (structural tones > embellishments)
function snapToChordTone(absDeg, chordRootDeg, scaleLen) {
  const rel = ((absDeg - chordRootDeg) % scaleLen + scaleLen) % scaleLen;
  const candidates = [0, 2, 4];
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    let d = c - rel;
    if (d > scaleLen / 2) d -= scaleLen;
    if (d < -scaleLen / 2) d += scaleLen;
    if (Math.abs(d) < bestDist) { best = rel + d; bestDist = Math.abs(d); }
  }
  return chordRootDeg + best;
}

// Detect parallel perfect 5th / 8ve between outer voices (RH and LH top).
// SOURCE: https://en.wikipedia.org/wiki/Voice_leading (avoid parallel fifths and octaves)
function isParallelPerfect(prevRH, prevLHTop, curRH, curLHTop) {
  if (prevRH === null || prevLHTop === null) return false;
  const prevInt = Math.abs(prevRH - prevLHTop) % 12;
  const curInt = Math.abs(curRH - curLHTop) % 12;
  const perfect = (prevInt === curInt) && (prevInt === 7 || prevInt === 0);
  if (!perfect) return false;
  const rhDir = Math.sign(curRH - prevRH);
  const lhDir = Math.sign(curLHTop - prevLHTop);
  return rhDir !== 0 && rhDir === lhDir;
}

// Compose one bar's RH melody from a motif on the current chord.
// Enforces: strong-beat chord tone, phrase-level voice-crossing floor,
// 7-semitone leap cap (applied AFTER any octave lift), and no parallel
// perfect 5ths/8ves against the LH top note.
function composeBarMelody(motif, chordRootDeg, scale, tonic, rhLo, rhHi, prevPitch, beatLen, barStart, meter, prevLHTop, curLHTop, lhPhraseTop) {
  const beatsTotal = motif.rhythm.reduce((s, x) => s + x, 0);
  const scaleFactor = meter / beatsTotal;
  const out = [];
  let t = 0;
  let prev = prevPitch;
  let prevOuterRH = prevPitch;
  // RH floor is the phrase-level LH top; RH must sit strictly above it.
  const rhFloor = Math.max(rhLo, lhPhraseTop + 1);
  for (let i = 0; i < motif.cells.length; i++) {
    let absDeg = chordRootDeg + motif.cells[i];
    const beats = motif.rhythm[i] * scaleFactor;
    // Strong beat = beat 1 of the bar OR a note lasting at least 1 beat.
    // On strong beats the skeleton must be a chord tone (root/3rd/5th).
    // SOURCE: https://en.wikipedia.org/wiki/Generative_theory_of_tonal_music (TSR head on strong beats)
    const strongBeat = t < 1e-6 || motif.rhythm[i] >= 1;
    if (strongBeat && !isChordTone(absDeg, chordRootDeg, scale.length)) {
      absDeg = snapToChordTone(absDeg, chordRootDeg, scale.length);
    }
    const raw = degreePitch(tonic, scale, absDeg);
    let p = closestOctave(raw, prev, rhFloor, rhHi);
    // Voice crossing: RH must sit strictly above the phrase-level LH top.
    // SOURCE: https://en.wikipedia.org/wiki/Voice_leading (avoid voice crossing)
    while (p <= lhPhraseTop) p += 12;
    while (p > rhHi) p -= 12;
    if (p <= lhPhraseTop) p = clamp(lhPhraseTop + 1, rhFloor, rhHi);
    // Parallel 5th / 8ve guard between RH and LH top voice.
    // SOURCE: https://en.wikipedia.org/wiki/Voice_leading (no parallel perfects)
    if (isParallelPerfect(prevOuterRH, prevLHTop, p, curLHTop)) {
      const shifted = p + (p > prev ? -1 : 1);
      const safe = closestOctave(shifted, prev, rhFloor, rhHi);
      if (safe > lhPhraseTop && !isParallelPerfect(prevOuterRH, prevLHTop, safe, curLHTop)) p = safe;
    }
    const start = barStart + t * beatLen;
    const end = start + beats * beatLen * 0.92;
    out.push({ pitch: p, startTime: start, endTime: end });
    prevOuterRH = p;
    prev = p;
    t += beats;
  }
  // Final pass: enforce 7-semitone leap cap AFTER octave adjustments. For each
  // note, pick the octave transposition of its pitch class that sits closest
  // to the running previous note. If no octave of that pitch class lands
  // within MAX_LEAP of running (edge-of-range case), substitute a chord tone
  // of the current chord that DOES fit within MAX_LEAP, preserving stepwise
  // voice leading over strict motif pitch class.
  // SOURCE: https://en.wikipedia.org/wiki/Counterpoint (after a skip, step in opposite direction)
  const chordTonePCs = [0, 2, 4].map((d) => degreePitch(tonic, scale, chordRootDeg + d) % 12);
  let running = prevPitch;
  for (let i = 0; i < out.length; i++) {
    const target = out[i].pitch;
    let best = target;
    let bestDist = Math.abs(target - running);
    for (let o = -4; o <= 4; o++) {
      const q = target + o * 12;
      if (q < rhFloor || q > rhHi) continue;
      const d = Math.abs(q - running);
      if (d < bestDist) { best = q; bestDist = d; }
    }
    if (bestDist > MAX_LEAP) {
      for (const pc of chordTonePCs) {
        for (let cand = rhFloor; cand <= rhHi; cand++) {
          if (cand % 12 !== pc) continue;
          const d = Math.abs(cand - running);
          if (d <= MAX_LEAP && d < bestDist) { best = cand; bestDist = d; }
        }
      }
    }
    out[i].pitch = best;
    running = best;
  }
  return { notes: out, lastPitch: running };
}

// Produce one phrase as a note sequence. One motif, one LH pattern, consistent
// across all phrases of a piece; only the chord roots and a small motif shift move.
function composePhraseImpl(mood, tonic, rng) {
  const style = styleFor(mood);
  const meter = style.meter;
  const bars = 4;
  const beatLen = 60 / Math.max(1, mood.bpm);
  const barDur = beatLen * meter;
  const totalTime = barDur * bars;

  // Register split: LH and RH occupy non-overlapping bands so voice crossing
  // is structurally impossible. LH spans one octave from pitchMin (enough room
  // for any triad inversion); RH starts one semitone above the LH top and runs
  // to pitchMax, giving a wide enough RH range for the 7-semitone leap cap.
  // SOURCE: https://en.wikipedia.org/wiki/Voice_leading (keep voices in separate registers)
  const lhLo = mood.pitchMin;
  const lhHi = mood.pitchMin + 12;
  const rhLo = mood.pitchMin + 13;
  const rhHi = mood.pitchMax;

  const softness = currentEffects().softness || 0;
  const soft = (v) => clamp(v - softness * 5, 18, 110);
  const velBase = mood.velBase ?? 44;
  const lhVel = Math.round(velBase * 0.62);
  const rhVelBase = velBase + 6;
  const bassVel = Math.max(18, Math.round(velBase * 0.5));

  const notes = [];

  // Progression: each chord spans barsPerChord bars; chords cycle from piece offset.
  // SOURCE: https://en.wikipedia.org/wiki/Ludovico_Einaudi (repetitive melodic patterns)
  const progression = mood.progression || [0, 3, 0, 4];
  const chordsThisPhrase = Math.ceil(bars / style.barsPerChord);
  const chordRoots = [];
  for (let i = 0; i < chordsThisPhrase; i++) {
    chordRoots.push(progression[(_piece.progOffset + i) % progression.length]);
  }
  _piece.progOffset = (_piece.progOffset + chordsThisPhrase) % progression.length;

  // Cadence applies only to the last phrase of a piece. Types and resolutions:
  // authentic V-I, plagal IV-I, half ends on V, deceptive V-vi.
  // SOURCE: https://en.wikipedia.org/wiki/Cadence
  const isLastPhrase = _phrasesInPiece === _pieceLength - 1;
  const cadence = isLastPhrase
    ? weightedPick(mood.cadenceWeights || { plagal: 1 }, rng)
    : 'flow';
  if (isLastPhrase) {
    const lastIdx = chordRoots.length - 1;
    if (cadence === 'authentic')      { if (lastIdx >= 1) chordRoots[lastIdx - 1] = 4; chordRoots[lastIdx] = 0; }
    else if (cadence === 'plagal')    { if (lastIdx >= 1) chordRoots[lastIdx - 1] = 3; chordRoots[lastIdx] = 0; }
    else if (cadence === 'half')      { chordRoots[lastIdx] = 4; }
    else if (cadence === 'deceptive') { if (lastIdx >= 1) chordRoots[lastIdx - 1] = 4; chordRoots[lastIdx] = 5; }
  }

  // Piece motif transposed by -1/0/+1 scale steps based on phrase position.
  // Keeps the motif recognisable while allowing gentle variation.
  // SOURCE: https://en.wikipedia.org/wiki/Generative_theory_of_tonal_music (grouping variation)
  const motifShifts = [0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1, 0, 1];
  const shift = motifShifts[_phrasesInPiece % motifShifts.length];
  const baseMotif = _piece.motif;
  const motif = {
    name: baseMotif.name,
    cells: baseMotif.cells.map((c) => c + shift),
    rhythm: baseMotif.rhythm.slice(),
  };

  // Expand bar-to-chord mapping so each bar knows its chord root.
  const barToChord = [];
  for (let b = 0; b < bars; b++) {
    barToChord.push(chordRoots[Math.min(Math.floor(b / style.barsPerChord), chordRoots.length - 1)]);
  }

  // Pre-compute LH voicings AND realize actual LH pattern notes across ALL bars
  // first. The phrase-level LH top is the max pitch of every LH note (including
  // octave doublings inside patterns like brokenOctave). RH uses this as a
  // strict phrase-scope floor. SOURCE: https://en.wikipedia.org/wiki/Voice_leading (avoid voice crossing)
  const barChords = [];
  const lhFnPre = LH[_piece.lhPattern] || lhArpeggio;
  const sustainsPre = _piece.lhPattern === 'block' || _piece.lhPattern === 'waltzBlock';
  const preLHNotes = [];
  let lhPhraseTop = -Infinity;
  for (let b = 0; b < bars; b++) {
    const chord = voiceChord(tonic, mood.scale, barToChord[b], lhLo, lhHi);
    barChords.push(chord);
    const isChordStartPre = (b % style.barsPerChord) === 0;
    if (!sustainsPre || isChordStartPre) {
      const lhDur = sustainsPre ? barDur * Math.min(style.barsPerChord, bars - b) : barDur;
      const lhNotes = lhFnPre(chord, b * barDur, lhDur, soft(lhVel));
      for (const n of lhNotes) {
        preLHNotes.push({ bar: b, note: n });
        if (n.pitch > lhPhraseTop) lhPhraseTop = n.pitch;
      }
    }
  }

  // RH starting pitch: carry over from previous phrase (continuity) or start
  // one octave above tonic. Must also sit strictly above phrase LH top.
  // SOURCE: https://en.wikipedia.org/wiki/Counterpoint (begin on tonic)
  const rhFloor = Math.max(rhLo, lhPhraseTop + 1);
  let prevRH = _lastRHPitch !== null && _lastRHPitch >= rhFloor && _lastRHPitch <= rhHi
    ? _lastRHPitch
    : clampOctave(tonic + 12, rhFloor, rhHi);

  let prevLHTop = _lastLHTop;
  const melodyPitches = [];

  for (let b = 0; b < bars; b++) {
    const barStart = b * barDur;
    const chordRoot = barToChord[b];
    const chord = barChords[b];
    const lhTop = chord[chord.length - 1];

    // Low bass root: one sustained note per chord-span, below the LH pattern.
    // Two-voice minimum texture (Fur Alina). SOURCE: https://en.wikipedia.org/wiki/F%C3%BCr_Alina
    const isChordStart = (b % style.barsPerChord) === 0;
    if (isChordStart) {
      const bassRoot = clampOctave(chord[0] - 12, Math.max(24, lhLo - 12), lhLo);
      const spanBars = Math.min(style.barsPerChord, bars - b);
      notes.push({
        pitch: bassRoot, velocity: soft(bassVel),
        startTime: barStart, endTime: barStart + barDur * spanBars - 0.12,
        instrument: 0, program: 0,
      });
    }

    // LH chord pattern. Already pre-built before the bar loop so the phrase-
    // level LH top is known; here we flush the notes that belong to this bar.
    // SOURCE: https://en.wikipedia.org/wiki/Ludovico_Einaudi (repeating arpeggios)
    for (const entry of preLHNotes) {
      if (entry.bar === b) notes.push({ ...entry.note, instrument: 0, program: 0 });
    }

    // RH melody on top of chord.
    const { notes: rhNotes, lastPitch } = composeBarMelody(
      motif, chordRoot, mood.scale, tonic, rhLo, rhHi,
      prevRH, beatLen, barStart, meter, prevLHTop, lhTop, lhPhraseTop
    );
    // Velocity shaping per bar within the phrase arch.
    const melVelPhase = (b + 0.5) / bars;
    const melVelScale = 0.9 + 0.2 * Math.sin(melVelPhase * Math.PI);
    const baseVel = Math.round(rhVelBase * melVelScale);
    for (const m of rhNotes) {
      const x = m.startTime / totalTime;
      const v = swell(x, baseVel);
      notes.push({
        pitch: m.pitch, velocity: soft(v),
        startTime: m.startTime, endTime: m.endTime,
        instrument: 0, program: 0,
      });
      melodyPitches.push(m.pitch);
    }
    prevRH = lastPitch;
    prevLHTop = lhTop;
  }

  // Authentic / plagal cadence: land final melody note on tonic via stepwise approach.
  // SOURCE: https://en.wikipedia.org/wiki/Cadence (perfect authentic: tonic in top voice)
  // SOURCE: https://en.wikipedia.org/wiki/Counterpoint (final note approached by step)
  if (isLastPhrase && (cadence === 'plagal' || cadence === 'authentic')) {
    const rhFloorCad = Math.max(rhLo, lhPhraseTop + 1);
    let tonicPitch = closestOctave(tonic + 12, prevRH, rhFloorCad, rhHi);
    // Ensure the cadential tonic honors both the phrase-level floor and the leap cap.
    // SOURCE: https://en.wikipedia.org/wiki/Counterpoint (final note approached by step)
    while (tonicPitch <= lhPhraseTop && tonicPitch + 12 <= rhHi) tonicPitch += 12;
    if (Math.abs(tonicPitch - prevRH) > MAX_LEAP) {
      // Fallback: pick the closest chord tone of the tonic triad within MAX_LEAP.
      const cadenceChord = [0, 2, 4].map((d) => degreePitch(tonic, mood.scale, d) % 12);
      let best = tonicPitch;
      let bestDist = Math.abs(tonicPitch - prevRH);
      for (const pc of cadenceChord) {
        for (let cand = rhFloorCad; cand <= rhHi; cand++) {
          if (cand % 12 !== pc) continue;
          const d = Math.abs(cand - prevRH);
          if (d <= MAX_LEAP && d < bestDist) { best = cand; bestDist = d; }
        }
      }
      tonicPitch = best;
    }
    const lastT = totalTime - beatLen * 0.8;
    notes.push({
      pitch: tonicPitch, velocity: soft(rhVelBase - 6),
      startTime: lastT, endTime: totalTime - 0.12,
      instrument: 0, program: 0,
    });
    melodyPitches.push(tonicPitch);
    prevRH = tonicPitch;
  }

  _lastRHPitch = prevRH;
  _lastLHTop = prevLHTop;

  // Publish this phrase's RH melody for the live notes stream.
  _liveMelody = melodyPitches.slice();
  _liveMelodyVersion++;

  return { notes, totalTime };
}

// Rest phrase: sparse low root + one mid-register chime. Provides audible space
// between pieces. SOURCE: https://en.wikipedia.org/wiki/Generative_theory_of_tonal_music (grouping boundaries)
function composeRestPhrase(mood, tonic) {
  const lo = mood.pitchMin;
  const hi = mood.pitchMax;
  const softness = currentEffects().softness || 0;
  const soft = (v) => clamp(v - softness * 5, 18, 110);
  const beatLen = 60 / Math.max(1, mood.bpm);
  const totalTime = beatLen * 8;
  const notes = [];
  const bassRoot = clampOctave(tonic - 12, lo, hi);
  notes.push({
    pitch: bassRoot, velocity: soft(24),
    startTime: 0, endTime: totalTime - 0.2,
    instrument: 0, program: 0,
  });
  const chime = clampOctave(tonic, lo, hi);
  notes.push({
    pitch: chime, velocity: soft(26),
    startTime: totalTime * 0.35, endTime: totalTime * 0.35 + beatLen * 2,
    instrument: 0, program: 0,
  });
  _liveMelody = [chime];
  _liveMelodyVersion++;
  return { notes, totalTime };
}

// Start a new piece: pick a motif, LH pattern, piece length, key step.
// SOURCE: https://en.wikipedia.org/wiki/Generative_theory_of_tonal_music (one piece = one group)
function startNewPiece(mood, rng) {
  const style = styleFor(mood);
  const [minLen, maxLen] = style.pieceLen;
  _pieceLength = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  _phrasesInPiece = 0;
  _piece = {
    motif: pick(MOTIFS, rng),
    lhPattern: pick(style.lhPatterns, rng),
    progOffset: 0,
  };
  _pieceKeyIdx = (_pieceKeyIdx + 1) % PIECE_KEY_STEPS.length;
  _lastRHPitch = null;
  _lastLHTop = null;
}

function scheduleNextRest(mood, rng) {
  const min = mood.restEveryMin || 8;
  const max = mood.restEveryMax || 14;
  _nextRestAt = _phraseIdx + min + Math.floor(rng() * (max - min + 1));
}

export function composePhrase(rng = Math.random) {
  const mood = getCurrentMood() || {};
  const eff = currentEffects();
  const shiftCap = mood.pitchShiftCap ?? 3;
  const shift = clamp(eff.pitchShift || 0, -shiftCap, shiftCap);

  if (_piece === null) startNewPiece(mood, rng);
  if (_phrasesInPiece >= _pieceLength) startNewPiece(mood, rng);

  const keyStep = PIECE_KEY_STEPS[_pieceKeyIdx];
  const tonic = TONIC_MIDI + shift + keyStep;

  if (_nextRestAt === null) scheduleNextRest(mood, rng);

  if (_phraseIdx >= _nextRestAt) {
    scheduleNextRest(mood, rng);
    const { notes, totalTime } = composeRestPhrase(mood, tonic);
    _phraseIdx++;
    return {
      notes, totalTime, ticksPerQuarter: 220,
      tempos: [{ time: 0, qpm: mood.bpm }],
      quantizationInfo: { stepsPerQuarter: 4 },
    };
  }

  const { notes, totalTime } = composePhraseImpl(mood, tonic, rng);
  _phraseIdx++;
  _phrasesInPiece++;
  return {
    notes, totalTime, ticksPerQuarter: 220,
    tempos: [{ time: 0, qpm: mood.bpm }],
    quantizationInfo: { stepsPerQuarter: 4 },
  };
}

export function resetComposer() {
  _phraseIdx = 0;
  _pieceKeyIdx = 0;
  _phrasesInPiece = 0;
  _pieceLength = 0;
  _piece = null;
  _nextRestAt = null;
  _lastRHPitch = null;
  _lastLHTop = null;
  _liveMelody = [];
  _liveMelodyVersion = 0;
}

export function composerState() {
  return {
    phraseIdx: _phraseIdx,
    phrasesInPiece: _phrasesInPiece,
    pieceLength: _pieceLength,
    keyStep: PIECE_KEY_STEPS[_pieceKeyIdx],
    piece: _piece ? { motif: _piece.motif.name, lhPattern: _piece.lhPattern } : null,
  };
}

// Live-notes publishing. Returns an ordered array of MIDI pitches for the last
// phrase's RH melody (bass voice excluded). liveMelodyVersion is monotonic.
export function getLiveMelody() {
  return _liveMelody.slice();
}

export function liveMelodyVersion() {
  return _liveMelodyVersion;
}

export const __internals = Object.freeze({
  PIECE_KEY_STEPS, MOTIFS, LH, STYLE,
  degreePitch, triadAt, voiceChord, composeBarMelody,
  isChordTone, snapToChordTone, isParallelPerfect,
  closestOctave, clampOctave,
});
