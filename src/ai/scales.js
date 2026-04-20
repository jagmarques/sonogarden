// Pure scale + form tables and the user-input -> NoteSequence builder.
// See .company/ai/seed-dna.md sections 2, 4, 5.

export const SCALES = Object.freeze({
  major:            [0, 2, 4, 5, 7, 9, 11],
  minor:            [0, 2, 3, 5, 7, 8, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  blues:            [0, 3, 5, 6, 7, 10],
});

// Form metadata per seed-dna.md section 4.
// bars: length in bars.
// repeats: structural repetition within the sequence (not playback-loop).
// Cycle 15 orchestra mode: every form lays out so each note holds for a full
// bar. That gives the ensemble sustained chords instead of busy runs, which
// is the Debussy-string-section sound the user asked for. Bar counts grow
// as needed so 4 motif notes become 4 bars of sustain (not 2 bars of half-notes).
export const FORMS = Object.freeze({
  motif:    Object.freeze({ bars: 4, repeats: 0 }),
  riff:     Object.freeze({ bars: 4, repeats: 1 }),
  arpeggio: Object.freeze({ bars: 4, repeats: 0 }),
  ostinato: Object.freeze({ bars: 4, repeats: 1 }),
  round:    Object.freeze({ bars: 4, repeats: 1 }),
});

const STEPS_PER_QUARTER = 4;
const QUARTERS_PER_BAR = 4;
const STEPS_PER_BAR = STEPS_PER_QUARTER * QUARTERS_PER_BAR; // 16
const DEFAULT_QPM = 120;
const DEFAULT_VELOCITY = 80;
const ROUND_TRANSPOSE = 12;

function pitchNameToMidi(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(127, Math.round(value)));
  }
  if (typeof value !== 'string') {
    throw new Error(`unsupported pitch value: ${value}`);
  }
  const m = value.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) throw new Error(`unparseable pitch: ${value}`);
  const letter = m[1].toUpperCase();
  const acc = m[2];
  const octave = parseInt(m[3], 10);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter];
  const accOffset = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
  const midi = (octave + 1) * 12 + base + accOffset;
  return Math.max(0, Math.min(127, midi));
}

function snapToScale(pitch, root, scaleIntervals) {
  let best = pitch;
  let bestDist = Infinity;
  for (let d = -6; d <= 6; d++) {
    const candidate = pitch + d;
    const degree = ((candidate - root) % 12 + 12) % 12;
    if (scaleIntervals.includes(degree) && Math.abs(d) < bestDist) {
      best = candidate;
      bestDist = Math.abs(d);
    }
  }
  return best;
}

function stepsToSeconds(step, qpm) {
  const secondsPerQuarter = 60 / qpm;
  return (step / STEPS_PER_QUARTER) * secondsPerQuarter;
}

function pushNote(notes, pitch, startStep, endStep, qpm) {
  if (endStep <= startStep) return;
  notes.push({
    pitch,
    quantizedStartStep: startStep,
    quantizedEndStep: endStep,
    startTime: stepsToSeconds(startStep, qpm),
    endTime: stepsToSeconds(endStep, qpm),
    velocity: DEFAULT_VELOCITY,
    instrument: 0,
    program: 0,
  });
}

function layoutMotif(pitches, totalSteps, qpm, startStep = 0) {
  const notes = [];
  const n = pitches.length;
  if (n === 0) return notes;
  const step = totalSteps / n;
  for (let i = 0; i < n; i++) {
    const s = startStep + Math.round(i * step);
    const e = startStep + Math.round((i + 1) * step);
    pushNote(notes, pitches[i], s, e, qpm);
  }
  return notes;
}

function layoutArpeggio(pitches, totalSteps, qpm, startStep = 0) {
  // Cycle 15: sustained arpeggio. Each pitch holds for a full bar (16 steps)
  // and the sequence cycles through pitches to fill totalSteps. Removes the
  // old one-step-per-pitch rapid-fire behaviour that read as busy.
  const notes = [];
  const n = pitches.length;
  if (n === 0) return notes;
  const barSteps = STEPS_PER_BAR;
  const bars = Math.max(1, Math.round(totalSteps / barSteps));
  for (let i = 0; i < bars; i++) {
    const pitch = pitches[i % n];
    const s = startStep + i * barSteps;
    const e = s + barSteps;
    pushNote(notes, pitch, s, e, qpm);
  }
  return notes;
}

function layoutOstinato(pitches, qpm, startStep = 0, totalSteps = STEPS_PER_BAR * 4) {
  // Cycle 15: each pitch sustains for 2 bars, then cycles. For the cello
  // D2-A2 starter this gives a rocking D(2 bars) -> A(2 bars) drone that
  // anchors the ensemble. Total length = totalSteps steps.
  const notes = [];
  const n = pitches.length;
  if (n === 0) return notes;
  const holdSteps = STEPS_PER_BAR * 2;
  const count = Math.max(1, Math.round(totalSteps / holdSteps));
  for (let i = 0; i < count; i++) {
    const pitch = pitches[i % n];
    const s = startStep + i * holdSteps;
    const e = s + holdSteps;
    pushNote(notes, pitch, s, e, qpm);
  }
  return notes;
}

function layoutRound(pitches, qpm) {
  // Cycle 15: 4 bars = 64 steps. Voice 1 plays sustained motif over bars 1-2
  // (first 32 steps). Voice 2 plays the same motif transposed +12 semitones
  // over bars 3-4 (steps 32..64). Each voice's notes hold for a full bar so
  // a 3-pitch motif stretches across two bars with the final pitch slightly
  // shorter when pitches do not divide evenly - kept deterministic via
  // layoutMotif's Math.round split.
  const notes = [];
  const voice1 = layoutMotif(pitches, 32, qpm, 0);
  voice1.forEach((n) => notes.push(n));
  const transposed = pitches.map((p) => Math.max(0, Math.min(127, p + ROUND_TRANSPOSE)));
  const voice2 = layoutMotif(transposed, 32, qpm, 32);
  voice2.forEach((n) => notes.push(n));
  return notes;
}

export function buildNoteSequence(notes, scale, form) {
  if (!Array.isArray(notes) || notes.length === 0) {
    throw new Error('buildNoteSequence: notes must be a non-empty array');
  }
  if (!Object.prototype.hasOwnProperty.call(SCALES, scale)) {
    throw new Error(`buildNoteSequence: unknown scale "${scale}"`);
  }
  if (!Object.prototype.hasOwnProperty.call(FORMS, form)) {
    throw new Error(`buildNoteSequence: unknown form "${form}"`);
  }

  const midiInputs = notes.map(pitchNameToMidi);
  const root = Math.min(...midiInputs) % 12;
  const scaleIntervals = SCALES[scale];
  const snapped = midiInputs.map((p) => snapToScale(p, root, scaleIntervals));

  const { bars } = FORMS[form];
  const totalSteps = bars * STEPS_PER_BAR;
  const qpm = DEFAULT_QPM;

  let seqNotes;
  switch (form) {
    case 'motif':
      seqNotes = layoutMotif(snapped, totalSteps, qpm, 0);
      break;
    case 'riff': {
      // Two consecutive motifs each filling one bar.
      const half = totalSteps / 2;
      seqNotes = layoutMotif(snapped, half, qpm, 0).concat(
        layoutMotif(snapped, half, qpm, half),
      );
      break;
    }
    case 'arpeggio':
      seqNotes = layoutArpeggio(snapped, totalSteps, qpm, 0);
      break;
    case 'ostinato':
      seqNotes = layoutOstinato(snapped, qpm, 0, totalSteps);
      break;
    case 'round':
      seqNotes = layoutRound(snapped, qpm);
      break;
    default:
      seqNotes = [];
  }

  const totalTime = stepsToSeconds(totalSteps, qpm);

  return {
    notes: seqNotes,
    totalTime,
    totalQuantizedSteps: totalSteps,
    quantizationInfo: { stepsPerQuarter: STEPS_PER_QUARTER },
    tempos: [{ time: 0, qpm }],
  };
}

/**
 * Snap every pitch in a NoteSequence to the nearest tone of `scaleName`.
 * MusicVAE's latent decoder can produce atonal pitches that clash with the
 * user's chosen scale; this pass quantises the output so mutate/breed
 * children stay inside the mode their parent declared.
 *
 * The scale root defaults to C (midi 60 -> pitch class 0) which matches the
 * convention buildNoteSequence uses when the user picks pitches in that key.
 * Pass a different `tonicMidi` to root the scale elsewhere.
 *
 * Pure: returns a new NoteSequence POJO with cloned notes; input untouched.
 *
 * @param {object} noteSequence Magenta INoteSequence (POJO form).
 * @param {string} scaleName Key of SCALES (e.g. 'major', 'blues').
 * @param {number} [tonicMidi=60] Tonic pitch; only its pitch-class is used.
 * @returns {object} New NoteSequence with snapped pitches.
 */
export function snapSequenceToScale(noteSequence, scaleName, tonicMidi = 60) {
  if (!noteSequence || !Array.isArray(noteSequence.notes)) return noteSequence;
  if (!Object.prototype.hasOwnProperty.call(SCALES, scaleName)) return noteSequence;
  const scaleIntervals = SCALES[scaleName];
  const root = ((tonicMidi % 12) + 12) % 12;
  const snappedNotes = noteSequence.notes.map((n) => {
    if (typeof n?.pitch !== 'number') return n;
    const nextPitch = snapToScale(n.pitch, root, scaleIntervals);
    if (nextPitch === n.pitch) return n;
    return { ...n, pitch: nextPitch };
  });
  return { ...noteSequence, notes: snappedNotes };
}

export const __internal = Object.freeze({
  pitchNameToMidi,
  snapToScale,
  stepsToSeconds,
  STEPS_PER_QUARTER,
  STEPS_PER_BAR,
  DEFAULT_QPM,
});
