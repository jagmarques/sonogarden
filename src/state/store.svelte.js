// Svelte 5 runes-based garden state store.
// See .company/ai/seed-dna.md (Seed schema) and .company/ai/evolution.md (tick pipeline).

import {
  loadAllSeeds,
  saveSeed,
  deleteSeed,
  getGardenState,
  setGardenState,
} from '../persistence/db.js';
import { buildNoteSequence } from '../ai/scales.js';
import { initMagenta, encodeSeed } from '../ai/magenta.js';

const DEBUG = false;
const debugError = (...args) => { if (DEBUG) console.error(...args); };

export const gardenState = $state({
  seeds: [],
  playingIds: new Set(),
  loading: true,
  muted: false,
  liveMelody: [],
  liveMelodyTick: 0,
});

function jitterPosition() {
  // Ring around center so modifiers never spawn on top of the main worm.
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.28 + Math.random() * 0.18;
  return {
    x: Math.max(0.05, Math.min(0.95, 0.5 + Math.cos(angle) * radius)),
    y: Math.max(0.08, Math.min(0.92, 0.5 + Math.sin(angle) * radius * 0.8)),
  };
}

function addSeedToLocalArray(seed) {
  gardenState.seeds = [...gardenState.seeds, seed];
}

function replaceSeedsArray(seeds) {
  gardenState.seeds = seeds;
}

export function addSeedsToState(newSeeds) {
  if (!Array.isArray(newSeeds) || newSeeds.length === 0) return;
  gardenState.seeds = [...gardenState.seeds, ...newSeeds];
}

export async function loadGardenFromDB() {
  gardenState.loading = true;
  const [rawSeeds, state] = await Promise.all([loadAllSeeds(), getGardenState()]);
  // Skip partial seeds whose encode never finished (reload mid-plantSeed).
  const seeds = rawSeeds.filter((s) => s && s.status !== 'pending');
  replaceSeedsArray(seeds);

  const now = Date.now();

  // Cheap revive bump. No Magenta tick on boot (see 19.1 playbook).
  if (seeds.length > 0) {
    const revived = seeds.map((s) => ({
      ...s,
      energy: Math.min(1, (typeof s.energy === 'number' ? s.energy : 0) + 0.15),
    }));
    for (const s of revived) await saveSeed(s);
    replaceSeedsArray(revived);
  }

  gardenState.__lastSummary = { mutations: 0, births: 0, decays: 0 };
  await setGardenState({ lastOpened: now, version: state.version || 'v1' });
  gardenState.loading = false;
  return gardenState.seeds;
}

export async function plantSeed({ notes, scale, form, role = 'modifier', effect = null, label = null }) {
  const raw = buildNoteSequence(notes, scale, form);
  const now = Date.now();
  const id = crypto.randomUUID();
  const position = jitterPosition();
  const resolvedRole = role === 'main' ? 'main' : 'modifier';
  // Stub before slow encode so mid-encode reload does not lose data.
  const stub = {
    id,
    createdAt: now,
    lastPlayed: 0,
    lastEvolved: now,
    age: 0,
    notes: notes.slice(),
    scale,
    form,
    role: resolvedRole,
    midi: raw,
    latentVector: [],
    parentIds: [],
    generation: 0,
    position,
    energy: 1.0,
    effect,
    label,
    status: 'pending',
  };
  await saveSeed(stub);
  await initMagenta();
  const latentVector = await encodeSeed(raw);
  const seed = {
    id,
    createdAt: now,
    lastPlayed: 0,
    lastEvolved: now,
    age: 0,
    notes: notes.slice(),
    scale,
    form,
    role: resolvedRole,
    midi: raw,
    latentVector: Array.from(latentVector),
    parentIds: [],
    generation: 0,
    position,
    energy: 1.0,
    effect,
    label,
  };
  await saveSeed(seed);
  addSeedToLocalArray(seed);
  return seed;
}

export function getMainSeed() {
  return gardenState.seeds.find((s) => s.role === 'main') || null;
}

export async function updateSeedPosition(id, position) {
  const seed = gardenState.seeds.find((s) => s.id === id);
  if (!seed) return;
  const x = Math.max(0, Math.min(1, Number(position?.x) || 0));
  const y = Math.max(0, Math.min(1, Number(position?.y) || 0));
  seed.position = { x, y };
  // Nudge reactivity so $derived recomputes.
  gardenState.seeds = [...gardenState.seeds];
  try {
    await saveSeed(seed);
  } catch (err) {
    debugError('[sonogarden] updateSeedPosition saveSeed failed', err);
  }
}

export function playSeed(id) {
  const seed = gardenState.seeds.find((s) => s.id === id);
  if (!seed) return null;
  const next = new Set(gardenState.playingIds);
  next.add(id);
  gardenState.playingIds = next;
  seed.lastPlayed = Date.now();
  saveSeed(seed).catch((err) => debugError('[sonogarden] saveSeed after play failed', err));
  return seed.midi;
}

export function unplaySeed(id) {
  if (!gardenState.playingIds.has(id)) return;
  const next = new Set(gardenState.playingIds);
  next.delete(id);
  gardenState.playingIds = next;
}

export async function pruneSeed(id) {
  gardenState.seeds = gardenState.seeds.filter((s) => s.id !== id);
  if (gardenState.playingIds.has(id)) {
    const next = new Set(gardenState.playingIds);
    next.delete(id);
    gardenState.playingIds = next;
  }
  await deleteSeed(id);
}

export async function importGiftedSeed(giftPayload) {
  const now = Date.now();
  const notes = giftPayload.notes.slice();
  const scale = giftPayload.scale;
  const form = giftPayload.form;
  const raw = buildNoteSequence(notes, scale, form);
  const seed = {
    id: crypto.randomUUID(),
    createdAt: now,
    lastPlayed: 0,
    lastEvolved: now,
    age: 0,
    notes,
    scale,
    form,
    midi: raw,
    latentVector: Array.isArray(giftPayload.latentVector) ? giftPayload.latentVector.slice() : [],
    parentIds: [],
    generation: 0,
    position: jitterPosition(),
    energy: 1.0,
  };
  await saveSeed(seed);
  addSeedToLocalArray(seed);
  return seed;
}

export function computeSummary(oldSeeds, newSeeds) {
  const oldById = new Map(oldSeeds.map((s) => [s.id, s]));
  const newById = new Map(newSeeds.map((s) => [s.id, s]));
  let mutations = 0;
  let births = 0;
  let decays = 0;
  for (const s of newSeeds) {
    if (!oldById.has(s.id)) {
      if (Array.isArray(s.parentIds) && s.parentIds.length === 2) {
        births += 1;
      } else {
        mutations += 1;
      }
    }
  }
  for (const s of oldSeeds) {
    if (!newById.has(s.id)) {
      decays += 1;
    }
  }
  return { mutations, births, decays };
}
