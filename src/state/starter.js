// Starter garden: 1 main anchor + 7 effect modifiers (pitch/tone/progression).

import { plantSeed } from './store.svelte.js';

const STARTERS = [
  // Main melody anchor.
  { notes: ['C4', 'E4', 'G4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'], scale: 'major', form: 'riff', role: 'main' },
  // Pitch shifters.
  { notes: ['C4'], scale: 'major',  form: 'motif', role: 'modifier', effect: { kind: 'pitch', shift: 5 },  label: 'pitch +5' },
  { notes: ['D4'], scale: 'dorian', form: 'motif', role: 'modifier', effect: { kind: 'pitch', shift: -2 }, label: 'pitch -2' },
  { notes: ['G4'], scale: 'major',  form: 'motif', role: 'modifier', effect: { kind: 'pitch', shift: 7 },  label: 'pitch +7' },
  // Tone changes.
  { notes: ['A4'], scale: 'minor',  form: 'motif', role: 'modifier', effect: { kind: 'tone', softness: 1 },  label: 'softer' },
  { notes: ['E5'], scale: 'major',  form: 'motif', role: 'modifier', effect: { kind: 'tone', softness: -1 }, label: 'brighter' },
  // Progressions.
  { notes: ['C5', 'G4'], scale: 'major', form: 'motif', role: 'modifier', effect: { kind: 'progression', steps: [0, 7, 5, 0] }, label: 'I-V-IV-I' },
  { notes: ['A4', 'E4'], scale: 'minor', form: 'motif', role: 'modifier', effect: { kind: 'progression', steps: [0, 9, 5, 7] }, label: 'I-vi-IV-V' },
];

export const STARTER_COUNT = STARTERS.length;

export async function ensureStarterSeeds(state, onProgress) {
  if (!state || !Array.isArray(state.seeds)) {
    throw new Error('ensureStarterSeeds: state.seeds must be an array');
  }
  if (state.seeds.length > 0) return [];
  let done = 0;
  const planted = [];
  for (const starter of STARTERS) {
    const seed = await plantSeed({
      notes: starter.notes,
      scale: starter.scale,
      form: starter.form,
      role: starter.role,
      effect: starter.effect || null,
      label: starter.label || null,
    });
    planted.push(seed);
    done += 1;
    if (typeof onProgress === 'function') {
      try { onProgress(done); } catch (_) { /* ignore */ }
    }
  }
  return planted;
}
