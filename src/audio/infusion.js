// Modifiers are musical effects. Absorbing one stacks its effect.

function debugEnabled() {
  return typeof window !== 'undefined' && window.__SONO_DEBUG__ === true;
}

export const infusion = {
  absorbedIds: new Set(),
  effects: {
    pitchShift: 0,
    softness: 0,
    progression: null,
    progressionIdx: 0,
  },
};

/** Record a modifier and route its effect. */
export function absorbModifier(seed) {
  if (!seed || !seed.id) return;
  if (infusion.absorbedIds.has(seed.id)) return;
  infusion.absorbedIds.add(seed.id);
  const eff = seed.effect;
  if (!eff) return;
  if (eff.kind === 'pitch') {
    infusion.effects.pitchShift += eff.shift || 0;
    infusion.effects.pitchShift = Math.max(-12, Math.min(12, infusion.effects.pitchShift));
  } else if (eff.kind === 'tone') {
    infusion.effects.softness += eff.softness || 0;
    infusion.effects.softness = Math.max(-2, Math.min(2, infusion.effects.softness));
  } else if (eff.kind === 'progression') {
    infusion.effects.progression = Array.isArray(eff.steps) ? eff.steps.slice() : null;
    infusion.effects.progressionIdx = 0;
  }
  if (debugEnabled()) {
    // eslint-disable-next-line no-console
    console.log('[sonogarden.infusion] absorbed', { modId: seed.id, eff, effects: infusion.effects });
  }
}

/** Current effects snapshot. */
export function currentEffects() {
  return infusion.effects;
}

/** Step the progression index one phrase forward. */
export function advanceProgression() {
  if (infusion.effects.progression) infusion.effects.progressionIdx++;
}

/** Has a modifier already been absorbed? */
export function isAbsorbed(id) {
  return infusion.absorbedIds.has(id);
}

/** Reset accumulator (new garden / manual reset). */
export function resetAccumulator() {
  infusion.absorbedIds = new Set();
  infusion.effects = { pitchShift: 0, softness: 0, progression: null, progressionIdx: 0 };
}
