// IndexedDB persistence layer for sonogarden.
// See .company/ai/seed-dna.md for Seed schema and .company/ai/cycle1.md unresolved item 4.
//
// Storage format decision: JSON.
// Reason: NoteSequence from @magenta/music is already a plain JS object (POJO-shaped
// protobuf); IndexedDB structured clone handles POJOs natively. Protobuf bytes would
// add encode/decode steps on every read/write and complicate export/gift flows that
// need the DNA in human-readable form. If encode(JSON-roundtripped seq) fails in a
// future cycle, switch to protobuf-bytes (.encode(seq).finish() / .decode(bytes)).

import { openDB as idbOpenDB } from 'idb';

const DB_NAME = 'sonogarden_v8';
const DB_VERSION = 1;
const SEEDS_STORE = 'seeds';
const GARDEN_STORE = 'garden';
const GARDEN_KEY = 'state';
const STATE_VERSION = 'v1';

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = idbOpenDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(SEEDS_STORE)) {
        db.createObjectStore(SEEDS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(GARDEN_STORE)) {
        db.createObjectStore(GARDEN_STORE, { keyPath: 'key' });
      }
    },
    blocked() { /* another tab has this DB open */ },
    blocking() { /* we block another tab */ },
  });
  return dbPromise;
}

function toPlainArray(maybeTyped) {
  if (maybeTyped == null) return maybeTyped;
  if (Array.isArray(maybeTyped)) return maybeTyped.slice();
  if (ArrayBuffer.isView(maybeTyped)) return Array.from(maybeTyped);
  return maybeTyped;
}

function serializeSeed(seed) {
  return {
    ...seed,
    latentVector: toPlainArray(seed.latentVector),
    position: seed.position ? { x: seed.position.x, y: seed.position.y } : { x: 0, y: 0 },
  };
}

export async function saveSeed(seed) {
  const db = await openDB();
  return db.put(SEEDS_STORE, serializeSeed(seed));
}

export async function deleteSeed(id) {
  const db = await openDB();
  return db.delete(SEEDS_STORE, id);
}

export async function loadAllSeeds() {
  const db = await openDB();
  return db.getAll(SEEDS_STORE);
}

function defaultGardenRow() {
  return {
    key: GARDEN_KEY,
    lastOpened: Date.now(),
    version: STATE_VERSION,
  };
}

export async function getGardenState() {
  const db = await openDB();
  const existing = await db.get(GARDEN_STORE, GARDEN_KEY);
  if (existing) {
    return { lastOpened: existing.lastOpened, version: existing.version };
  }
  const row = defaultGardenRow();
  await db.put(GARDEN_STORE, row);
  return { lastOpened: row.lastOpened, version: row.version };
}

export async function setGardenState(state) {
  const db = await openDB();
  const row = {
    key: GARDEN_KEY,
    lastOpened: typeof state.lastOpened === 'number' ? state.lastOpened : Date.now(),
    version: state.version || STATE_VERSION,
  };
  await db.put(GARDEN_STORE, row);
  return row;
}

export async function exportAll() {
  const db = await openDB();
  const seeds = await db.getAll(SEEDS_STORE);
  const stateRow = (await db.get(GARDEN_STORE, GARDEN_KEY)) || defaultGardenRow();
  return {
    seeds,
    state: { lastOpened: stateRow.lastOpened, version: stateRow.version },
  };
}

export async function importAll(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('importAll: data must be an object with {seeds, state}');
  }
  const seeds = Array.isArray(data.seeds) ? data.seeds : [];
  const state = data.state || {};
  const db = await openDB();
  const tx = db.transaction([SEEDS_STORE, GARDEN_STORE], 'readwrite');
  const seedStore = tx.objectStore(SEEDS_STORE);
  const gardenStore = tx.objectStore(GARDEN_STORE);
  await seedStore.clear();
  for (const seed of seeds) {
    await seedStore.put(serializeSeed(seed));
  }
  await gardenStore.put({
    key: GARDEN_KEY,
    lastOpened: typeof state.lastOpened === 'number' ? state.lastOpened : Date.now(),
    version: state.version || STATE_VERSION,
  });
  await tx.done;
  return { seedCount: seeds.length };
}
