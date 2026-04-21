<script>
  import * as Tone from 'tone';
  import { onMount } from 'svelte';

  import Bloomfield from './visual/Bloomfield.svelte';
  import MuteButton from './ui/MuteButton.svelte';
  import StartOverlay from './ui/StartOverlay.svelte';
  import DiagnosticBadge from './ui/DiagnosticBadge.svelte';

  import { gardenState, setLiveMelody, loadSavedMoments, persistSavedMoments } from './state/store.svelte.js';
  import { initAudio, setMuted, waitForVoicesLoaded, setMood, stopAll } from './audio/player.js';
  import { MOODS, DEFAULT_MOOD, moodByHour } from './audio/moods.js';
  import { startAutoplay, stopAutoplay, onMoodChange, playStoredMelody } from './audio/autoplay.js';
  import { getCurrentChordLabel } from './audio/ambient.js';

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

  const showDiagnostics = typeof window !== 'undefined'
    && new URL(window.location.href).searchParams.has('debug');

  let activity = $state(DEFAULT_MOOD);
  let shareFlash = $state(false);
  let shareFlashTimer = null;
  let pendingSharedMelody = null;
  let chordLabel = $state('');
  let listenSec = $state(0);
  let listenTimer = null;
  let showIntro = $state(false);
  let introSlide = $state(0);
  let chordPollTimer = null;
  let paused = $state(false);
  let sessionSec = $state(0);
  let sessionTimer = null;

  function fmtTime(total) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startSessionTimer() {
    if (sessionTimer) return;
    sessionTimer = setInterval(() => {
      if (!paused) sessionSec += 1;
    }, 1000);
  }
  function stopSessionTimer() {
    if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
  }

  function togglePause() {
    if (!audioUnlocked) return;
    paused = !paused;
    if (paused) {
      stopAutoplay();
      stopAll();
    } else {
      startAutoplay({ onMelody: handleMelody }).catch((err) => logError('resume autoplay failed', err));
    }
  }

  function restartSession() {
    sessionSec = 0;
    paused = false;
    try {
      stopAutoplay();
      stopAll();
    } catch (_) { /* ignore */ }
    startAutoplay({ onMelody: handleMelody }).catch((err) => logError('restart failed', err));
  }

  const muted = $derived(gardenState.muted);

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

  let _unlockAttempted = false;
  function handleUnlock() {
    if (_unlockAttempted) return;
    _unlockAttempted = true;
    // iOS Safari will only resume an AudioContext when .resume() is called SYNCHRONOUSLY
    // inside the user-gesture frame. No awaits, no promise chains before this call.
    try {
      const raw = Tone.getContext().rawContext;
      if (raw && raw.state !== 'running' && typeof raw.resume === 'function') {
        raw.resume();
      }
    } catch (_) { /* ignore */ }
    audioUnlocked = true;
    tuningInstruments = false;
    samplePercent = 100;
    // Now run the full Tone init chain async. The context is already resuming from above.
    initAudio()
      .then(() => {
        setMood(activity);
        waitForVoicesLoaded().catch((err) => logError('voices load', err));
        maybeStartAutoplay();
      })
      .catch((err) => logError('initAudio failed', err));
    startSessionTimer();
    if (listenTimer) clearInterval(listenTimer);
    listenTimer = setInterval(() => { listenSec += 1; }, 1000);
    if (chordPollTimer) clearInterval(chordPollTimer);
    chordPollTimer = setInterval(() => {
      const lbl = getCurrentChordLabel();
      if (lbl && lbl !== chordLabel) chordLabel = lbl;
    }, 500);
    // Show 3-slide intro once per user.
    try {
      if (!localStorage.getItem('sonogarden.firstOpen')) {
        showIntro = true;
        introSlide = 0;
        localStorage.setItem('sonogarden.firstOpen', '1');
      }
    } catch (_) { /* ignore */ }
  }

  function advanceIntro() {
    if (introSlide < 2) introSlide += 1;
    else showIntro = false;
  }

  function applyMood(name) {
    if (!name || !MOODS[name]) return;
    activity = name;
    setMood(name);
    sessionSec = 0;
    paused = false;
    if (typeof window !== 'undefined') {
      window.__lastMoodApplied = name;
      window.__moodApplyCount = (window.__moodApplyCount || 0) + 1;
    }
    if (audioUnlocked) {
      stopAll();
      onMoodChange().catch((err) => logError('onMoodChange failed', err));
    }
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
    if (listenTimer) { clearInterval(listenTimer); listenTimer = null; }
    if (chordPollTimer) { clearInterval(chordPollTimer); chordPollTimer = null; }
    stopSessionTimer();
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
    loadSavedMoments();
    processShareParam();
    const hadShare = typeof window !== 'undefined' && new URL(location.href).searchParams.has('s');
    if (!hadShare) activity = moodByHour(new Date().getHours());
    setMood(activity);
    booting = false;
    maybeStartAutoplay();
  }

  function reloadPage() {
    try { window.location.reload(); } catch (_) { /* ignore */ }
  }

  onMount(() => {
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

  {#if showDiagnostics && audioUnlocked}
    <DiagnosticBadge />
  {/if}

  {#if audioUnlocked && chordLabel}
    <div class="now-playing" aria-live="polite">
      <span class="np-chord">{chordLabel}</span>
    </div>
  {/if}
  {#if audioUnlocked}
    <div class="transport-bar">
      <span class="timer">{fmtTime(sessionSec)}</span>
      <button type="button" class="transport-btn" onclick={togglePause} aria-label={paused ? 'play' : 'pause'}>
        {#if paused}
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M7 5 L19 12 L7 19 Z" fill="currentColor" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" fill="currentColor" /><rect x="14" y="5" width="4" height="14" fill="currentColor" /></svg>
        {/if}
      </button>
      <button type="button" class="transport-btn" onclick={restartSession} aria-label="restart">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M12 5 A7 7 0 1 1 5 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><path d="M12 2 L12 8 L7 5 Z" fill="currentColor" /></svg>
      </button>
    </div>
  {/if}

  {#if showIntro && audioUnlocked}
    <button type="button" class="intro-overlay" onclick={advanceIntro}>
      <div class="intro-inner">
        {#if introSlide === 0}
          <p class="intro-line">sonogarden.</p>
          <p class="intro-sub">ai composes. you listen.</p>
        {:else if introSlide === 1}
          <p class="intro-line">browser only.</p>
          <p class="intro-sub">no signup. free forever.</p>
        {:else}
          <p class="intro-line">save the moments you like.</p>
          <p class="intro-sub">share them with a URL.</p>
        {/if}
        <p class="intro-hint">{introSlide < 2 ? 'click to continue' : 'click to begin'}</p>
      </div>
    </button>
  {/if}

  <div class="control-bar">
    <div class="mood-row" role="radiogroup" aria-label="mood">
      {#each Object.keys(MOODS) as key}
        <button
          type="button"
          class="mood-pill"
          class:active={activity === key}
          data-mood={key}
          role="radio"
          aria-checked={activity === key}
          onclick={() => applyMood(key)}
        >{MOODS[key].label}</button>
      {/each}
    </div>
    <button type="button" class="spawn-toggle" onclick={handleShare} title="copy a link to this exact moment">copy link</button>
    {#if shareFlash}
      <span class="share-flash" role="status" aria-live="polite">copied</span>
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
  .now-playing {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 45;
    display: flex;
    gap: 10px;
    align-items: center;
    font-family: var(--font);
    font-size: 12px;
    color: color-mix(in srgb, var(--iris) 75%, transparent);
    pointer-events: none;
    letter-spacing: 0.04em;
    text-transform: lowercase;
  }
  .np-mood {
    padding: 4px 10px;
    background: color-mix(in srgb, #14191C 70%, transparent);
    border: 1px solid color-mix(in srgb, #2A3A33 70%, transparent);
    border-radius: 9999px;
    color: color-mix(in srgb, #E8C9A0 90%, transparent);
  }
  .np-chord {
    font-size: 12px;
    color: color-mix(in srgb, var(--iris) 60%, transparent);
  }
  .timer {
    font-family: var(--font);
    font-size: 22px;
    font-weight: 500;
    color: color-mix(in srgb, #E8C9A0 90%, transparent);
    padding: 8px 18px;
    background: color-mix(in srgb, #14191C 75%, transparent);
    border: 1px solid color-mix(in srgb, #2A3A33 75%, transparent);
    border-radius: 9999px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }
  .transport-bar {
    position: fixed;
    bottom: 16px;
    right: 72px;
    display: flex;
    gap: 8px;
    z-index: 50;
    pointer-events: auto;
  }
  .transport-btn {
    pointer-events: auto;
    width: 44px;
    height: 44px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--moss);
    border-radius: 9999px;
    color: var(--petal);
    cursor: pointer;
  }
  .transport-btn:hover, .transport-btn:focus-visible {
    color: var(--iris);
    border-color: var(--iris);
  }
  .intro-overlay {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: color-mix(in srgb, var(--loam) 72%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    cursor: pointer;
    font-family: var(--font);
    color: var(--petal);
    animation: intro-fade 400ms ease-out both;
  }
  @keyframes intro-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .intro-inner {
    max-width: 560px;
    text-align: center;
    padding: 0 32px;
  }
  .intro-line {
    margin: 0 0 10px;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--petal);
  }
  .intro-sub {
    margin: 0;
    font-size: 15px;
    font-weight: 400;
    color: var(--iris);
    letter-spacing: 0;
  }
  .intro-hint {
    margin: 24px 0 0;
    font-size: 11px;
    color: color-mix(in srgb, var(--iris) 55%, transparent);
    letter-spacing: 0.08em;
  }
  .spawn-toggle.glow {
    box-shadow: 0 0 0 1px color-mix(in srgb, #E8C9A0 55%, transparent),
                0 0 16px color-mix(in srgb, #E8C9A0 28%, transparent);
    animation: save-pulse 2600ms ease-in-out infinite;
  }
  @keyframes save-pulse {
    0%, 100% { box-shadow: 0 0 0 1px color-mix(in srgb, #E8C9A0 40%, transparent), 0 0 10px color-mix(in srgb, #E8C9A0 18%, transparent); }
    50%      { box-shadow: 0 0 0 1px color-mix(in srgb, #E8C9A0 70%, transparent), 0 0 22px color-mix(in srgb, #E8C9A0 40%, transparent); }
  }
  .saved-strip {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 52px;
    z-index: 45;
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 8px 2px;
    justify-content: center;
  }
  .saved-card {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 12px;
    background: color-mix(in srgb, #14191C 85%, transparent);
    border: 1px solid color-mix(in srgb, #2A3A33 80%, transparent);
    border-radius: 14px;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .card-title {
    background: transparent;
    border: 0;
    color: #E8C9A0;
    font-family: var(--font);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    padding: 0;
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-title:hover, .card-title:focus-visible { color: var(--iris); }
  .card-mood {
    font-family: var(--font);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: lowercase;
    color: color-mix(in srgb, var(--iris) 75%, transparent);
    padding: 2px 6px;
    border: 1px solid color-mix(in srgb, var(--iris) 35%, transparent);
    border-radius: 9999px;
  }
  .card-del {
    width: 20px;
    height: 20px;
    background: transparent;
    border: 0;
    color: color-mix(in srgb, var(--iris) 65%, transparent);
    cursor: pointer;
    font-size: 14px;
    border-radius: 9999px;
  }
  .card-del:hover, .card-del:focus-visible { color: var(--pollen); }
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
    max-width: 360px;
  }
  .mood-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .mood-pill {
    height: 32px;
    padding: 0 14px;
    background: color-mix(in srgb, #14191C 70%, transparent);
    border: 1px solid color-mix(in srgb, #2A3A33 80%, transparent);
    border-radius: 9999px;
    color: color-mix(in srgb, #E8C9A0 70%, transparent);
    font-family: var(--font);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-transform: lowercase;
    letter-spacing: -0.005em;
    transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
  }
  .mood-pill:hover, .mood-pill:focus-visible {
    color: var(--iris);
    border-color: var(--iris);
  }
  .mood-pill.active {
    color: #0B0F12;
    background: #E8C9A0;
    border-color: #E8C9A0;
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
