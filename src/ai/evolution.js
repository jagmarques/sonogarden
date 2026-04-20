// Pure evolution rules per .company/ai/evolution.md.
// Side-effectful decode/encode delegated to src/ai/magenta.js.

import {
  mutateLatent,
  breedLatents,
  decodeLatent,
  latentDistance,
} from './magenta.js';
import { snapSequenceToScale } from './scales.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// 5-minute ticks so returning after lunch feels alive without collapsing narrative pacing.
export const TICK_MS = 5 * MINUTE_MS;
export const MAX_TICKS_PER_OPEN = 72;
export const MUTATIONS_PER_TICK = 1;
export const BREEDINGS_PER_TICK = 1;
// Cycle 6: the cap is an ecological ceiling, not a session-killer. 20 evicted
// accumulated work faster than users could tend. 64 lets a dense, curated
// garden breathe (12 starters + room for many generations of mutations/births
// before eviction kicks in). Paired with the expanded IMMUNITY_MS so fresh
// plantings don't get evicted before they've had a chance to root.
export const MAX_SEEDS = 64;
export const PROX_D = 0.15;
// Cycle 15: orchestra mode. Autoplay no longer gates on energy, but evolution
// still uses decay to pick eviction candidates. Slow the decay way down so a
// garden left open for hours still sounds alive, and zero out the idle bump
// so seeds that haven't been user-tended for a while aren't punished for it.
export const DECAY_PER_TICK = 0.005;
export const IDLE_EXTRA_DECAY = 0;
export const IDLE_THRESHOLD_MS = DAY_MS;
// Fresh seeds immune from eviction for 7 days (was 1). Gives user-planted seeds
// real time to accumulate value before the ecosystem can cull them.
export const IMMUNITY_MS = 7 * DAY_MS;
export const MUTATION_STD = 0.25;
export const BREED_T_CENTER = 0.5;
export const BREED_T_SPREAD = 0.6;
export const PROX_HARMONY_BOOST = 0.03;
export const PROX_TENSION_DECAY = 0.02;

function uuid(rng) {
  // Not cryptographic: RFC-4122 style v4 using the injected RNG so tests stay reproducible.
  if (rng === Math.random && typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = new Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(rng() * 256) & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function posDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function jitterNear(pos, amount, rng) {
  return {
    x: clamp01(pos.x + (rng() - 0.5) * 2 * amount),
    y: clamp01(pos.y + (rng() - 0.5) * 2 * amount),
  };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function weightedPick(items, weightFn, rng) {
  if (!items.length) return null;
  let total = 0;
  const weights = items.map((it) => {
    const w = Math.max(0, weightFn(it));
    total += w;
    return w;
  });
  if (total <= 0) {
    return items[Math.floor(rng() * items.length)];
  }
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function elapsedTicks(lastOpened, now = Date.now(), tickMs = TICK_MS) {
  const ticks = Math.floor((now - lastOpened) / tickMs);
  if (ticks < 0) return 0;
  return ticks > MAX_TICKS_PER_OPEN ? MAX_TICKS_PER_OPEN : ticks;
}

export async function mutate(seed, rng = Math.random, now = Date.now()) {
  const zChild = mutateLatent(seed.latentVector, MUTATION_STD, rng);
  const decoded = await decodeLatent(zChild);
  // Cycle 12: quantise the decoder's output back into the parent's scale.
  // MusicVAE is trained on mixed tonality so its raw decode drifts atonal,
  // which clashes audibly now that every voice is a sampled instrument.
  const childSeq = snapSequenceToScale(decoded, seed.scale);
  return {
    id: uuid(rng),
    createdAt: now,
    lastPlayed: 0,
    lastEvolved: now,
    age: 0,
    notes: seed.notes,
    scale: seed.scale,
    form: seed.form,
    midi: childSeq,
    latentVector: zChild,
    parentIds: [seed.id],
    generation: seed.generation + 1,
    position: jitterNear(seed.position, 0.05, rng),
    energy: 1.0,
  };
}

export async function breed(seedA, seedB, rng = Math.random, now = Date.now()) {
  const t = BREED_T_CENTER + (rng() - 0.5) * BREED_T_SPREAD;
  const zChild = breedLatents(seedA.latentVector, seedB.latentVector, t);
  const decoded = await decodeLatent(zChild);
  const dominant = t < 0.5 ? seedA : seedB;
  // Cycle 12: snap to the dominant parent's scale for the same reason as
  // mutate() - keeps hybrid children in a consistent tonal frame.
  const childSeq = snapSequenceToScale(decoded, dominant.scale);
  return {
    id: uuid(rng),
    createdAt: now,
    lastPlayed: 0,
    lastEvolved: now,
    age: 0,
    notes: dominant.notes,
    scale: dominant.scale,
    form: dominant.form,
    midi: childSeq,
    latentVector: zChild,
    parentIds: [seedA.id, seedB.id],
    generation: Math.max(seedA.generation, seedB.generation) + 1,
    position: midpoint(seedA.position, seedB.position),
    energy: 1.0,
  };
}

export function proximityPairs(seeds, D = PROX_D) {
  const pairs = [];
  for (let i = 0; i < seeds.length; i++) {
    for (let j = i + 1; j < seeds.length; j++) {
      if (posDistance(seeds[i].position, seeds[j].position) < D) {
        pairs.push([seeds[i], seeds[j]]);
      }
    }
  }
  return pairs;
}

export function decayEnergy(
  seed,
  ticks = 1,
  basePerTick = DECAY_PER_TICK,
  idleExtra = IDLE_EXTRA_DECAY,
  now = Date.now(),
) {
  const idle = seed.lastPlayed === 0 || now - seed.lastPlayed > IDLE_THRESHOLD_MS;
  const perTick = basePerTick + (idle ? idleExtra : 0);
  const next = seed.energy - perTick * ticks;
  return { ...seed, energy: next < 0 ? 0 : next > 1 ? 1 : next };
}

function isImmune(seed, now) {
  return seed.generation === 0 && now - seed.createdAt < IMMUNITY_MS;
}

export function enforceCap(seeds, maxSeeds = MAX_SEEDS, now = Date.now()) {
  if (seeds.length <= maxSeeds) return { seeds: seeds.slice(), evicted: null };
  const evictable = seeds.filter((s) => !isImmune(s, now));
  const pool = evictable.length > 0 ? evictable : seeds;
  let evictee = pool[0];
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].energy < evictee.energy) evictee = pool[i];
  }
  return { seeds: seeds.filter((s) => s.id !== evictee.id), evicted: evictee };
}

function applyProximityEffects(seeds) {
  if (seeds.length < 2) return seeds;
  const pairs = proximityPairs(seeds);
  if (!pairs.length) return seeds;
  const deltas = new Map();
  for (const [a, b] of pairs) {
    const harmonize = a.scale === b.scale;
    const delta = harmonize ? PROX_HARMONY_BOOST : -PROX_TENSION_DECAY;
    deltas.set(a.id, (deltas.get(a.id) || 0) + delta);
    deltas.set(b.id, (deltas.get(b.id) || 0) + delta);
  }
  return seeds.map((s) => {
    const d = deltas.get(s.id);
    if (!d) return s;
    const next = s.energy + d;
    return { ...s, energy: next < 0 ? 0 : next > 1 ? 1 : next };
  });
}

function pickBreedingPartner(seeds, primary, rng) {
  const candidates = seeds.filter((s) => s.id !== primary.id);
  if (!candidates.length) return null;
  return weightedPick(
    candidates,
    (s) => s.energy / (1 + posDistance(s.position, primary.position)),
    rng,
  );
}

export async function tick(state, elapsedMs, rng = Math.random, now = Date.now()) {
  const ticks = elapsedTicks(now - elapsedMs, now);
  const births = [];
  const mutations = [];
  const evictions = [];
  if (ticks <= 0) {
    return { ...state, seeds: state.seeds.slice(), lastEvolved: now, births, mutations, evictions };
  }

  let seeds = state.seeds.map((s) => decayEnergy(s, ticks, DECAY_PER_TICK, IDLE_EXTRA_DECAY, now));
  seeds = seeds.map((s) => ({ ...s, age: s.age + ticks }));
  seeds = applyProximityEffects(seeds);

  for (let t = 0; t < ticks; t++) {
    if (seeds.length === 0) break;

    for (let m = 0; m < MUTATIONS_PER_TICK; m++) {
      const parent = weightedPick(seeds, (s) => s.energy, rng);
      if (!parent) break;
      try {
        const child = await mutate(parent, rng, now);
        seeds.push(child);
        mutations.push(child);
        const capped = enforceCap(seeds, MAX_SEEDS, now);
        seeds = capped.seeds;
        if (capped.evicted) evictions.push(capped.evicted);
      } catch (err) {
        return { ...state, seeds, lastEvolved: now, error: err, births, mutations, evictions };
      }
    }

    if (seeds.length >= 2) {
      for (let b = 0; b < BREEDINGS_PER_TICK; b++) {
        const parentA = weightedPick(seeds, (s) => s.energy, rng);
        if (!parentA) break;
        const parentB = pickBreedingPartner(seeds, parentA, rng);
        if (!parentB) break;
        try {
          const child = await breed(parentA, parentB, rng, now);
          seeds.push(child);
          births.push(child);
          const capped = enforceCap(seeds, MAX_SEEDS, now);
          seeds = capped.seeds;
          if (capped.evicted) evictions.push(capped.evicted);
        } catch (err) {
          return { ...state, seeds, lastEvolved: now, error: err, births, mutations, evictions };
        }
      }
    }
  }

  return { ...state, seeds, lastEvolved: now, births, mutations, evictions };
}

export { latentDistance, posDistance, weightedPick };
