export const gardenState = $state({
  liveMelody: null,
  savedMoments: [],
  muted: false,
  sessionSec: 0,
  streak: 0,
  moodEnteredAt: 0,
  saveFlash: false,
});

// Retained as a no-op so Garden.svelte's legacy drag handlers do not throw.
export function updateSeedPosition() { /* no seeds in the MusicVAE rebuild */ }

export function setLiveMelody(ns) {
  gardenState.liveMelody = ns;
}

export function loadSavedMoments() {
  try {
    const raw = localStorage.getItem('sonogarden.moments');
    gardenState.savedMoments = raw ? JSON.parse(raw) : [];
  } catch (_) {
    gardenState.savedMoments = [];
  }
}

export function persistSavedMoments() {
  try { localStorage.setItem('sonogarden.moments', JSON.stringify(gardenState.savedMoments)); } catch (_) { /* ignore */ }
}

// Local-date key YYYY-MM-DD, avoids UTC off-by-one that would break streaks.
function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayDiff(a, b) {
  const ta = Date.parse(a + 'T00:00:00');
  const tb = Date.parse(b + 'T00:00:00');
  return Math.round((tb - ta) / 86400000);
}

// Advances streak: same day keeps streak; +1 day bumps; gap resets to 1.
export function registerVisit() {
  try {
    const prevDate = localStorage.getItem('sonogarden.lastOpenDate') || '';
    const prevStreak = parseInt(localStorage.getItem('sonogarden.streak') || '0', 10) || 0;
    const t = today();
    let next = 1;
    if (prevDate === t) next = Math.max(1, prevStreak);
    else if (prevDate && dayDiff(prevDate, t) === 1) next = prevStreak + 1;
    else if (prevDate && dayDiff(prevDate, t) > 1) next = 1;
    localStorage.setItem('sonogarden.lastOpenDate', t);
    localStorage.setItem('sonogarden.streak', String(next));
    gardenState.streak = next;
  } catch (_) {
    gardenState.streak = 1;
  }
}

export function loadSessionSec() {
  try {
    gardenState.sessionSec = parseInt(localStorage.getItem('sonogarden.sessionSec') || '0', 10) || 0;
  } catch (_) { gardenState.sessionSec = 0; }
}

export function bumpSessionSec(deltaSec) {
  gardenState.sessionSec = (gardenState.sessionSec || 0) + deltaSec;
  try { localStorage.setItem('sonogarden.sessionSec', String(gardenState.sessionSec)); } catch (_) { /* ignore */ }
}

export function noteMoodEntered() {
  gardenState.moodEnteredAt = Date.now();
}

export function moodSecondsSoFar() {
  if (!gardenState.moodEnteredAt) return 0;
  return Math.floor((Date.now() - gardenState.moodEnteredAt) / 1000);
}
