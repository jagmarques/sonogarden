<script>
  import * as Tone from 'tone';

  import Garden from './visual/Garden.svelte';
  import Bloomfield from './visual/Bloomfield.svelte';
  import MuteButton from './ui/MuteButton.svelte';
  import StartOverlay from './ui/StartOverlay.svelte';

  import { gardenState, setLiveMelody, loadSavedMoments, persistSavedMoments, registerVisit, loadSessionSec, bumpSessionSec, noteMoodEntered, moodSecondsSoFar } from './state/store.svelte.js';
  import { initMagenta } from './ai/magenta.js';
  import { initAudio, setMuted, waitForVoicesLoaded, setMood, stopAll } from './audio/player.js';
  import { MOODS, DEFAULT_MOOD, moodByHour } from './audio/moods.js';
  import { startAutoplay, stopAutoplay, onMoodChange, playStoredMelody } from './audio/autoplay.js';
  import { emitBloom } from './audio/events.js';

  const DEBUG = false;

  let booting = $state(true);
  let bootError = $state(null);
  let bootPhase = $state('magenta');
  let samplePercent = $state(0);
  let audioUnlocked = $state(false);
  let tuningInstruments = $state(false);
  let bootStuck = $state(false);
  let bootStuckTimer = null;
  let autoplayActive = false;

  let activity = $state(DEFAULT_MOOD);
  let shareFlash = $state(false);
  let shareFlashTimer = null;
  let savedExpanded = $state(false);
  let pendingSharedMelody = null;
  let sessionTimer = null;
  let bloomTimer = null;

  const muted = $derived(gardenState.muted);
  const sessionMin = $derived(Math.floor((gardenState.sessionSec || 0) / 60));
  const moodUnlockSec = $derived(moodSecondsSoFar());

  function logError(context, err) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.error(`[sonogarden] ${context}`, err);
    }
  }

  function handleMelody(ns) {
    setLiveMelody(ns);
  }

  function maybeStartAutoplay() {
    if (autoplayActive || !audioUnlocked || booting) return;
    autoplayActive = true;
    startAutoplay({ onMelody: handleMelody })
      .then(() => {
        if (pendingSharedMelody) {
          playStoredMelody(pendingSharedMelody);
          handleMelody(pendingSharedMelody);
          pendingSharedMelody = null;
        }
      })
      .catch((err) => logError('startAutoplay failed', err));
  }

  async function handleUnlock() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    tuningInstruments = true;
    bootPhase = 'audio';
    try {
      await initAudio();
      setMood(activity);
    } catch (err) {
      logError('initAudio failed', err);
    }
    bootPhase = 'samples';
    samplePercent = 0;
    const sampleStart = performance.now();
    const progTimer = setInterval(() => {
      const elapsed = performance.now() - sampleStart;
      samplePercent = Math.min(95, Math.round((elapsed / 12000) * 100));
    }, 200);
    try {
      await waitForVoicesLoaded();
    } catch (err) {
      logError('waitForVoicesLoaded failed', err);
    } finally {
      clearInterval(progTimer);
      samplePercent = 100;
    }
    tuningInstruments = false;
    maybeStartAutoplay();
  }

  function handleActivityChange(e) {
    activity = e.target.value;
    setMood(activity);
    stopAll();
    noteMoodEntered();
    onMoodChange().catch((err) => logError('onMoodChange failed', err));
  }

  // Variable-ratio reward: 6 to 18 minute window, classic intermittent schedule.
  function scheduleBloomEvent() {
    if (bloomTimer) clearTimeout(bloomTimer);
    const minutes = 6 + Math.random() * 12;
    bloomTimer = setTimeout(() => {
      emitBloom();
      scheduleBloomEvent();
    }, minutes * 60 * 1000);
  }

  function compactMelody(ns) {
    if (!ns || !Array.isArray(ns.notes)) return null;
    return {
      n: ns.notes.map((x) => [x.pitch, x.startTime ?? 0, x.endTime ?? 0, x.velocity ?? 80]),
      t: ns.totalTime ?? 0,
      q: (ns.tempos && ns.tempos[0] && ns.tempos[0].qpm) || 120,
    };
  }

  function expandMelody(c) {
    if (!c || !Array.isArray(c.n)) return null;
    return {
      notes: c.n.map((a) => ({ pitch: a[0], startTime: a[1], endTime: a[2], velocity: a[3] })),
      totalTime: c.t,
      tempos: [{ time: 0, qpm: c.q || 120 }],
    };
  }

  function encodeShareState(mood, ns) {
    const payload = { m: mood, ns: compactMelody(ns) };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }

  function decodeShareState(str) {
    try {
      const json = decodeURIComponent(escape(atob(str)));
      const obj = JSON.parse(json);
      if (!obj || typeof obj !== 'object') return null;
      return { mood: obj.m, ns: expandMelody(obj.ns) };
    } catch (_) {
      return null;
    }
  }

  async function handleShare() {
    const encoded = encodeShareState(activity, gardenState.liveMelody);
    try {
      const url = new URL(location.href);
      url.searchParams.set('s', encoded);
      history.replaceState(null, '', url.toString());
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url.toString());
    } catch (err) {
      logError('share failed', err);
    }
    shareFlash = true;
    if (shareFlashTimer) clearTimeout(shareFlashTimer);
    shareFlashTimer = setTimeout(() => { shareFlash = false; shareFlashTimer = null; }, 2000);
  }

  function handleSaveMoment() {
    if (!gardenState.liveMelody) return;
    const title = (typeof window !== 'undefined' && window.prompt) ? window.prompt('name this moment') : '';
    if (!title || !title.trim()) return;
    const moment = {
      title: title.trim(),
      mood: activity,
      ts: Date.now(),
      liveMelody: compactMelody(gardenState.liveMelody),
    };
    gardenState.savedMoments = [...gardenState.savedMoments, moment];
    persistSavedMoments();
    gardenState.saveFlash = true;
    setTimeout(() => { gardenState.saveFlash = false; }, 1400);
    emitBloom();
  }

  function handleLoadMoment(idx) {
    const m = gardenState.savedMoments[idx];
    if (!m) return;
    activity = m.mood;
    setMood(activity);
    stopAll();
    const ns = expandMelody(m.liveMelody);
    if (ns) {
      playStoredMelody(ns);
      handleMelody(ns);
    } else {
      onMoodChange().catch((err) => logError('load moment mood change failed', err));
    }
  }

  function handleDeleteMoment(idx) {
    gardenState.savedMoments = gardenState.savedMoments.filter((_, i) => i !== idx);
    persistSavedMoments();
  }

  function processShareParam() {
    if (typeof window === 'undefined') return;
    const url = new URL(location.href);
    const encoded = url.searchParams.get('s');
    if (!encoded) return;
    const decoded = decodeShareState(encoded);
    if (!decoded) return;
    if (typeof decoded.mood === 'string' && MOODS[decoded.mood]) {
      activity = decoded.mood;
    }
    if (decoded.ns) pendingSharedMelody = decoded.ns;
  }

  function handleMuteChange(next) {
    gardenState.muted = next;
    setMuted(next);
  }

  function handleBeforeUnload() {
    try { stopAutoplay(); stopAll(); } catch (_) { /* ignore */ }
    if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
    if (bloomTimer) { clearTimeout(bloomTimer); bloomTimer = null; }
  }

  function handleVisibilityChange() {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (!audioUnlocked) return;
    try {
      const ctx = Tone.getContext();
      if (ctx && ctx.state !== 'running') {
        const raw = ctx.rawContext;
        if (raw && typeof raw.resume === 'function') {
          raw.resume().catch((err) => logError('audio context resume failed', err));
        }
      }
    } catch (err) {
      logError('visibilitychange resume failed', err);
    }
  }

  async function boot() {
    bootPhase = 'magenta';
    try {
      await initMagenta();
    } catch (err) {
      logError('initMagenta failed', err);
      bootError = err?.message || 'Audio engine unavailable';
      booting = false;
      return;
    }
    loadSavedMoments();
    processShareParam();
    loadSessionSec();
    registerVisit();
    // First-open time-of-day mood pick, but only if the URL didn't set one via share.
    const hadShare = typeof window !== 'undefined' && new URL(location.href).searchParams.has('s');
    if (!hadShare) activity = moodByHour(new Date().getHours());
    setMood(activity);
    noteMoodEntered();
    booting = false;
    maybeStartAutoplay();
    if (sessionTimer) clearInterval(sessionTimer);
    sessionTimer = setInterval(() => { if (audioUnlocked) bumpSessionSec(5); }, 5000);
    scheduleBloomEvent();
  }

  function reloadPage() {
    try { window.location.reload(); } catch (_) { /* ignore */ }
  }

  $effect(() => {
    boot();
    bootStuckTimer = setTimeout(() => {
      if (booting || tuningInstruments) bootStuck = true;
    }, 25000);
    return () => {
      if (bootStuckTimer) clearTimeout(bootStuckTimer);
      bootStuckTimer = null;
    };
  });

  $effect(() => {
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });
</script>

{#if bootError}
  <div class="error-banner" role="alert">
    <span class="error-text">{bootError}</span>
  </div>
{/if}

{#if booting}
  <div class="loading" role="status" aria-live="polite">
    <span>loading AI model...</span>
    {#if bootStuck}
      <div class="stuck">
        <p>still loading... if stuck, reload the page (cmd+shift+R)</p>
        <button type="button" class="reload-btn" onclick={reloadPage}>Reload</button>
      </div>
    {/if}
  </div>
{:else}
  <Garden />
  <Bloomfield mood={MOODS[activity]} />

  {#if !audioUnlocked || tuningInstruments}
    <StartOverlay
      onunlock={handleUnlock}
      tuning={tuningInstruments}
      phase={bootPhase}
      percent={samplePercent}
      stuck={bootStuck}
      onreload={reloadPage}
    />
  {/if}

  <MuteButton muted={muted} onchange={handleMuteChange} />

  <div class="hud">
    <span class="hud-item">{sessionMin}m</span>
    <span class="hud-item">streak {gardenState.streak}</span>
    <span class="hud-item">moments {gardenState.savedMoments.length}</span>
  </div>

  {#if gardenState.saveFlash}
    <div class="save-flash" role="status" aria-live="polite">moment saved</div>
  {/if}

  <div class="control-bar">
    <select class="activity-select" aria-label="Activity" value={activity} onchange={handleActivityChange} title={MOODS[activity]?.citation ?? ''}>
      {#each Object.keys(MOODS) as key}
        <option value={key}>{MOODS[key].label}</option>
      {/each}
    </select>
    <span class="mood-evidence">{MOODS[activity]?.citation ?? ''}</span>
    <button type="button" class="spawn-toggle" onclick={handleSaveMoment}>save this moment</button>
    <button type="button" class="spawn-toggle" onclick={handleShare}>share</button>
    {#if shareFlash}
      <span class="share-flash" role="status" aria-live="polite">link copied</span>
    {/if}
    {#if gardenState.savedMoments.length > 0}
      <button type="button" class="spawn-toggle" onclick={() => (savedExpanded = !savedExpanded)} aria-expanded={savedExpanded}>
        saved {savedExpanded ? 'hide' : 'show'} ({gardenState.savedMoments.length})
      </button>
    {/if}
    {#if savedExpanded && gardenState.savedMoments.length > 0}
      <ul class="saved-list" aria-label="saved moments">
        {#each gardenState.savedMoments as m, i (m.ts)}
          <li class="saved-item">
            <button type="button" class="saved-title" onclick={() => handleLoadMoment(i)}>{m.title}</button>
            <button type="button" class="saved-del" aria-label="delete" onclick={() => handleDeleteMoment(i)}>×</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .loading {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--petal);
    font-family: var(--font);
    font-weight: 500;
    font-size: 22px;
    letter-spacing: -0.01em;
    background: var(--loam);
    z-index: 60;
  }
  .stuck {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }
  .stuck p {
    margin: 0;
    font-size: 13px;
    color: var(--iris);
    font-weight: 400;
    text-align: center;
  }
  .reload-btn {
    height: 32px;
    padding: 0 14px;
    background: color-mix(in srgb, var(--loam) 86%, transparent);
    border: 1px solid var(--moss);
    color: var(--petal);
    font-family: var(--font);
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
  }
  .reload-btn:hover,
  .reload-btn:focus-visible {
    border-color: var(--iris);
    color: var(--pollen);
  }
  .error-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--loam) 92%, transparent);
    border-bottom: 1px solid var(--moss);
    color: var(--petal);
    font-family: var(--font);
    font-style: italic;
    font-size: 15px;
    text-align: center;
    z-index: 70;
  }
  .error-text { color: var(--pollen); }
  .hud {
    position: fixed;
    left: 16px;
    top: 16px;
    display: flex;
    gap: 12px;
    z-index: 55;
    font-family: var(--font);
    font-size: 12px;
    color: color-mix(in srgb, var(--iris) 70%, transparent);
    pointer-events: none;
  }
  .hud-item {
    padding: 4px 10px;
    background: color-mix(in srgb, #14191C 70%, transparent);
    border: 1px solid color-mix(in srgb, #2A3A33 70%, transparent);
    border-radius: 9999px;
    letter-spacing: 0.02em;
  }
  .save-flash {
    position: fixed;
    left: 50%;
    top: 32%;
    transform: translateX(-50%);
    padding: 10px 18px;
    font-family: var(--font);
    font-size: 14px;
    color: var(--pollen);
    background: color-mix(in srgb, var(--loam) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--iris) 60%, transparent);
    border-radius: 9999px;
    z-index: 60;
    animation: save-pop 1400ms ease-out both;
  }
  @keyframes save-pop {
    0% { opacity: 0; transform: translate(-50%, -4px) scale(0.96); }
    20% { opacity: 1; transform: translate(-50%, 0) scale(1.05); }
    60% { opacity: 1; transform: translate(-50%, 0) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -6px) scale(1); }
  }
  .mood-evidence {
    font-family: var(--font);
    font-size: 10px;
    color: color-mix(in srgb, var(--iris) 55%, transparent);
    text-align: right;
    padding: 0 6px;
    max-width: 260px;
    line-height: 1.3;
    opacity: 0;
    transition: opacity 160ms ease-out;
    pointer-events: none;
  }
  .control-bar:hover .mood-evidence,
  .control-bar:focus-within .mood-evidence {
    opacity: 1;
  }
  .control-bar {
    position: fixed;
    right: 16px;
    top: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 55;
    pointer-events: auto;
    max-width: 280px;
  }
  .control-bar select,
  .control-bar .spawn-toggle {
    height: 32px;
    padding: 0 14px;
    background: #14191C;
    border: 1px solid #2A3A33;
    border-radius: 9999px;
    color: #E8C9A0;
    font-family: var(--font);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-transform: lowercase;
    letter-spacing: -0.005em;
  }
  .control-bar select {
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238AA6C1' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 32px;
    min-width: 160px;
  }
  .control-bar select option { background: var(--loam); color: var(--iris); }
  .control-bar select:hover,
  .control-bar select:focus-visible,
  .control-bar .spawn-toggle:hover,
  .control-bar .spawn-toggle:focus-visible {
    color: var(--iris);
    border-color: var(--iris);
  }
  .share-flash {
    font-family: var(--font);
    font-size: 12px;
    color: var(--pollen);
    text-align: right;
    padding: 0 6px;
  }
  .saved-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 260px;
    max-height: 220px;
    overflow-y: auto;
  }
  .saved-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #14191C;
    border: 1px solid #2A3A33;
    border-radius: 9999px;
    padding: 2px 6px 2px 10px;
  }
  .saved-title {
    flex: 1 1 auto;
    min-width: 0;
    background: transparent;
    border: 0;
    color: #E8C9A0;
    font-family: var(--font);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .saved-title:hover,
  .saved-title:focus-visible { color: var(--iris); }
  .saved-del {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    background: transparent;
    border: 0;
    color: color-mix(in srgb, var(--iris) 70%, transparent);
    font-family: var(--font);
    font-size: 14px;
    cursor: pointer;
    border-radius: 9999px;
  }
  .saved-del:hover,
  .saved-del:focus-visible { color: var(--pollen); }
</style>
