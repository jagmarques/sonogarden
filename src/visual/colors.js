// Cycle 9 palette: bioluminescent neon greenhouse at night. LEDs, roots that
// glow, saturated petal colors on a near-black sky. The scene is layered
// top-to-bottom (deep sky, aurora, ground) but there is no single background.

export const PALETTE = {
  // Deep near-black sky with faint blue bias.
  bg_deep: { r: 8, g: 12, b: 20 },
  bg_mid:  { r: 14, g: 22, b: 32 },

  // Ground: dark indigo with a teal sheen (wet soil under moonlight).
  ground_top: { r: 18, g: 30, b: 38 },
  ground_bot: { r: 6, g: 14, b: 18 },

  // Aurora streak at the horizon.
  aurora_a: { r: 40, g: 180, b: 190 },
  aurora_b: { r: 120, g: 90, b: 220 },

  // Star field tint (slightly warm white).
  star: { r: 220, g: 230, b: 255 },

  // Saturated neon petal colors keyed by scale.
  major:            { r: 255, g: 214, b: 96 },
  minor:            { r: 170, g: 120, b: 255 },
  dorian:           { r: 80, g: 230, b: 200 },
  pentatonic_major: { r: 255, g: 124, b: 170 },
  blues:            { r: 90, g: 150, b: 255 },

  // Plant structure (glowing greens).
  stem:      { r: 80, g: 180, b: 130 },
  stem_glow: { r: 120, g: 255, b: 170 },
  leaf:      { r: 100, g: 210, b: 150 },

  // Underground root filaments (now glowing).
  root_glow: { r: 180, g: 255, b: 200 },
  root_base: { r: 60, g: 120, b: 90 },

  // Atmosphere.
  firefly:  { r: 255, g: 240, b: 160 },
  spark:    { r: 255, g: 210, b: 120 },
  grass:    { r: 60, g: 120, b: 90 },

  // Tension / harmonize.
  harmonize: { r: 200, g: 255, b: 140 },
  tension:   { r: 255, g: 100, b: 110 },

  // Flower center (pure bright LED core).
  stigma: { r: 255, g: 255, b: 240 },

  // Legacy keys kept so any external import does not explode.
  sky: { r: 8, g: 12, b: 20 },
  horizon: { r: 14, g: 22, b: 32 },
  haze: { r: 40, g: 60, b: 80 },
  meadow_top: { r: 18, g: 30, b: 38 },
  meadow_bottom: { r: 6, g: 14, b: 18 },
  soil: { r: 6, g: 14, b: 18 },
  moon: { r: 230, g: 240, b: 255 },
  root: { r: 60, g: 120, b: 90 },
  tendril_harmonize: { r: 200, g: 255, b: 140 },
  tendril_tension: { r: 255, g: 100, b: 110 },

  // Scale -> color lookup bag (mirror of top-level keys, kept for any legacy caller).
  petals_by_scale: {
    major:            { r: 255, g: 214, b: 96 },
    minor:            { r: 170, g: 120, b: 255 },
    dorian:           { r: 80, g: 230, b: 200 },
    pentatonic_major: { r: 255, g: 124, b: 170 },
    blues:            { r: 90, g: 150, b: 255 },
  },
};

const DEFAULT_PETAL = PALETTE.major;
const MAIN_COLOR_DEFAULT = { r: 255, g: 248, b: 215 };
function moodAccent() {
  try {
    const m = (typeof window !== 'undefined') && window.__sonoMood;
    if (m && m.accent) return m.accent;
  } catch (_) { /* ignore */ }
  return MAIN_COLOR_DEFAULT;
}
const MAIN_COLOR = MAIN_COLOR_DEFAULT;

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(255 * f(0)), g: Math.round(255 * f(8)), b: Math.round(255 * f(4)) };
}

function effectHue(effect) {
  if (!effect) return 0;
  if (effect.kind === 'pitch') {
    const shift = Number(effect.shift) || 0;
    return ((shift + 12) / 24) * 360;
  }
  if (effect.kind === 'tone') {
    return effect.softness > 0 ? 220 : 30;
  }
  if (effect.kind === 'progression') {
    const steps = Array.isArray(effect.steps) ? effect.steps.join(',') : '';
    let h = 0;
    for (let i = 0; i < steps.length; i++) h = (h * 31 + steps.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  return 0;
}

// Main = warm ivory (distinct). Modifiers with an effect get a hue by effect kind + param.
// Otherwise fall back to scale color.
export function colorForKey(seed) {
  if (seed && seed.role === 'main') return moodAccent();
  if (seed && seed.effect) {
    const hue = effectHue(seed.effect);
    return hslToRgb(hue, 0.62, 0.62);
  }
  const scale = (seed && seed.scale) ? String(seed.scale).toLowerCase() : 'major';
  switch (scale) {
    case 'major':
    case 'lydian':
    case 'mixolydian':
      return PALETTE.major;
    case 'minor':
    case 'aeolian':
    case 'phrygian':
    case 'pentatonic_minor':
      return PALETTE.minor;
    case 'dorian':
      return PALETTE.dorian;
    case 'pentatonic_major':
      return PALETTE.pentatonic_major;
    case 'blues':
      return PALETTE.blues;
    default:
      return DEFAULT_PETAL;
  }
}

// Left-to-right bed order across the canvas. Cooler on the left, warmer on
// the right, but everything is saturated so the difference reads as hue not
// brightness.
export const BED_ORDER = ['blues', 'minor', 'dorian', 'major', 'pentatonic_major'];

export function bedIndexForScale(scale) {
  const s = scale ? String(scale).toLowerCase() : 'major';
  switch (s) {
    case 'blues':            return 0;
    case 'minor':
    case 'aeolian':
    case 'phrygian':
    case 'pentatonic_minor': return 1;
    case 'dorian':           return 2;
    case 'major':
    case 'lydian':
    case 'mixolydian':       return 3;
    case 'pentatonic_major': return 4;
    default:                 return 3;
  }
}

// Linear mix of two sRGB colors.
export function mixRgb(a, b, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}
